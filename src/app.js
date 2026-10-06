/**
 * 应用服务：把外部命令翻译成不可变事件，并执行跨聚合的业务不变量。
 * 所有写操作的唯一落点都是 store.append；本层不保存任何私有状态。
 */
import { EventStore, ValidationError } from "./store.js";
import { liveProjection, buildProjection } from "./projections.js";
import {
  evaluateProposal,
  evaluateRelease,
  evaluateStage,
  requiredRereviewScope,
  validateChangeDecision,
} from "./policies.js";
import { compareProposal } from "./similarity.js";

export class GateError extends Error {
  constructor(blockers) {
    super(`门禁未通过：\n- ${blockers.join("\n- ")}`);
    this.name = "GateError";
    this.blockers = blockers;
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
  }
}

let counter = 0;
const genId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

export class GovernancePlatform {
  /** @param {ConstructorParameters<typeof EventStore>[0]} [storeOpts] */
  constructor(storeOpts = {}) {
    this.store = storeOpts instanceof EventStore ? storeOpts : new EventStore(storeOpts);
    this.state = liveProjection(this.store);
  }

  // -- 内部工具 -------------------------------------------------------------

  _append({ event_type, aggregate_type, aggregate_id, summary, payload, actor, predecessor_event_id }, opts) {
    return this.store.append(
      { event_type, aggregate_type, aggregate_id, summary, payload, actor, predecessor_event_id },
      opts,
    );
  }

  _requireProposal(proposalId) {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) throw new ConflictError(`方案不存在：${proposalId}`);
    return proposal;
  }

  _requireThesis(thesisId) {
    const thesis = this.state.theses.get(thesisId);
    if (!thesis) throw new ConflictError(`策展命题不存在：${thesisId}`);
    return thesis;
  }

  // -- 策展命题 -------------------------------------------------------------

  /** 首要问题：每个方案必须先提出"独有的文化命题"。 */
  submitThesis({ thesis_id = genId("thesis"), title, cultural_claim, research_questions, keywords, submitter_id, actor }, opts) {
    return this._append({
      event_type: "THESIS_SUBMITTED",
      aggregate_type: "curatorial_thesis",
      aggregate_id: thesis_id,
      summary: `提交策展命题：${title}`,
      payload: { title, cultural_claim, research_questions, keywords, submitter_id },
      actor,
    }, opts);
  }

  withdrawThesis(thesisId, { reason, actor }, opts) {
    this._requireThesis(thesisId);
    return this._append({
      event_type: "THESIS_WITHDRAWN",
      aggregate_type: "curatorial_thesis",
      aggregate_id: thesisId,
      summary: `撤回策展命题：${reason}`,
      payload: { reason },
      actor,
    }, opts);
  }

  // -- 方案 -----------------------------------------------------------------

  createProposal({ proposal_id = genId("proposal"), thesis_id, title, channels, venues, lead_org, actor }, opts) {
    const thesis = this._requireThesis(thesis_id);
    if (thesis.withdrawn) throw new ConflictError(`策展命题已撤回，不能用于新方案：${thesis_id}`);
    if (this.state.proposals.has(proposal_id)) throw new ConflictError(`方案已存在：${proposal_id}`);
    return this._append({
      event_type: "PROPOSAL_CREATED",
      aggregate_type: "experience_proposal",
      aggregate_id: proposal_id,
      summary: `立项申报：${title}`,
      payload: { proposal_id, thesis_id, title, channels, venues, lead_org },
      actor,
    }, opts);
  }

  // -- 研究素材与许可 -------------------------------------------------------

  registerAsset(input, opts) {
    const { asset_id = genId("asset"), kind, title, citation, holding_institution, custodian_contact, provenance_note, acquired_at, actor } = input;
    if ([...this.state.assets.values()].some((a) => a.asset_id === asset_id)) {
      throw new ConflictError(`素材已登记：${asset_id}`);
    }
    return this._append({
      event_type: "ASSET_REGISTERED",
      aggregate_type: "research_asset",
      aggregate_id: `asset:${asset_id}`,
      summary: `登记研究素材：${title}（${kind}）`,
      payload: { asset_id, kind, title, citation, holding_institution, custodian_contact, provenance_note, acquired_at },
      actor,
    }, opts);
  }

  /**
   * 素材许可：记录授权范围（地域/渠道/用途/到期）。
   * 不替申报方判断"能不能用海外/AI"，只留可核对的范围事实；覆盖判断在门禁里做。
   */
  clearSource(input, opts) {
    const { asset_id, proposal_id, scope, cleared, license_document_ref, limitations, reviewer_id, actor } = input;
    const asset = [...this.state.assets.values()].find((a) => a.asset_id === asset_id);
    if (!asset) throw new ConflictError(`素材未登记：${asset_id}（先 ASSET_REGISTERED）`);
    if (proposal_id) this._requireProposal(proposal_id);
    return this._append({
      event_type: "SOURCE_CLEARED",
      aggregate_type: "research_asset",
      aggregate_id: `asset:${asset_id}`,
      summary: `素材《${asset.title}》许可核对：${cleared ? "通过" : "未通过"}`,
      payload: { asset_id, proposal_id, scope, cleared, license_document_ref, limitations, reviewer_id },
      actor,
    }, opts);
  }

  // -- 交互原型（演示可下钻到出处） -----------------------------------------

  submitPrototype(input, opts) {
    const { proposal_id, prototype_version, artifact_ref, demo_scenes, actor, similarity_threshold } = input;
    const proposal = this._requireProposal(proposal_id);
    const versions = new Set(proposal.prototypes.map((x) => x.version));
    if (versions.has(prototype_version)) {
      throw new ConflictError(`原型版本 ${prototype_version} 已存在；修订请提交新版本，不得覆盖旧版本`);
    }
    // 每个引用必须指向已登记素材。
    for (const scene of demo_scenes) {
      for (const c of scene.asset_citations) {
        if (![...this.state.assets.values()].some((a) => a.asset_id === c.asset_id)) {
          throw new ConflictError(`演示片段「${scene.title}」引用了未登记素材：${c.asset_id}`);
        }
      }
    }
    const event = this._append({
      event_type: "PROTOTYPE_SUBMITTED",
      aggregate_type: "prototype",
      aggregate_id: `prototype:${proposal_id}`,
      summary: `提交交互原型 v${prototype_version}（${demo_scenes.length} 个演示片段）`,
      payload: { proposal_id, prototype_version, artifact_ref, demo_scenes },
      actor,
    }, opts);

    // 雷同检查只是系统提示；追加的报告 advisory_only 恒为 true，是否成立由人裁定。
    const advisory = this.runSimilarityCheck(proposal_id, { actor, threshold: similarity_threshold, silent: true });
    return { event, similarity: advisory };
  }

  // -- 供应商组件（复用披露） -----------------------------------------------

  declareComponent(input, opts) {
    const { proposal_id, component_id = genId("component"), name, supplier_id, is_reuse, origin, modifications, qualification_evidence_ref, actor } = input;
    this._requireProposal(proposal_id);
    return this._append({
      event_type: "COMPONENT_DECLARED",
      aggregate_type: "supplier_component",
      aggregate_id: `component:${component_id}`,
      summary: `${is_reuse ? "披露复用组件" : "登记新研组件"}：${name}`,
      payload: { proposal_id, component_id, name, supplier_id, is_reuse, origin, modifications, qualification_evidence_ref },
      actor,
    }, opts);
  }

  // -- 预算里程碑 -----------------------------------------------------------

  setBudget(input, opts) {
    const { proposal_id, currency, total_amount, milestones, actor } = input;
    this._requireProposal(proposal_id);
    return this._append({
      event_type: "BUDGET_MILESTONE_SET",
      aggregate_type: "budget",
      aggregate_id: `budget:${proposal_id}`,
      summary: `登记预算 ${currency} ${total_amount}，${milestones.length} 个里程碑`,
      payload: { proposal_id, currency, total_amount, milestones },
      actor,
    }, opts);
  }

  // -- 无障碍评估 -----------------------------------------------------------

  reviewAccessibility(input, opts) {
    const { proposal_id, review_id = genId("a11y"), standard, result, scope_sections, findings, conditions, reviewer_org, actor } = input;
    this._requireProposal(proposal_id);
    return this._append({
      event_type: "ACCESSIBILITY_REVIEWED",
      aggregate_type: "accessibility_review",
      aggregate_id: `accessibility:${review_id}`,
      summary: `无障碍评估：${result}（覆盖 ${scope_sections.join("、")}）`,
      payload: { proposal_id, review_id, standard, result, scope_sections, findings, conditions, reviewer_org },
      actor,
    }, opts);
  }

  // -- 学术审读 -------------------------------------------------------------

  recordScholarReview(input, opts) {
    const { proposal_id, review_id = genId("review"), verdict, opinion, scope_sections, reviewed_prototype_version,
      conditions, reviewer_id, reviewer_display_name, reviewer_org, actor } = input;
    this._requireProposal(proposal_id);
    return this._append({
      event_type: "SCHOLAR_REVIEW_RECORDED",
      aggregate_type: "scholarly_review",
      aggregate_id: `scholar:${review_id}`,
      summary: `学术审读意见：${verdict}（${review_id}）`,
      payload: {
        proposal_id, review_id, verdict, opinion, scope_sections, reviewed_prototype_version,
        conditions, reviewer_id, reviewer_display_name, reviewer_org,
      },
      actor,
    }, opts);
  }

  // -- 渠道使用范围（海外巡展 / 原址叠加 / AI 分别核对） --------------------

  checkChannel(input, opts) {
    const { proposal_id, channel, status, scope, human_reviewed, human_reviewer_id, review_note, ai_output_disclosure, conditions, actor } = input;
    const proposal = this._requireProposal(proposal_id);
    if (!proposal.channels.includes(channel)) {
      throw new ConflictError(`渠道 ${channel} 不在方案申报范围内（${proposal.channels.join("、")}）；扩展范围请走变更流程`);
    }
    // 原址叠加与 AI 内容不允许"系统自动放行"：只能登记为 pending 或带人工复核。
    if ((channel === "on_site_overlay" || channel === "ai_generated") && status === "cleared" && human_reviewed !== true) {
      throw new ConflictError(`${channel} 必须经过人工复核：请先以 pending_human_review 登记，复核通过后再登记 cleared + human_reviewed`);
    }
    return this._append({
      event_type: "CHANNEL_SCOPE_CHECKED",
      aggregate_type: "channel_clearance",
      aggregate_id: `channel:${proposal_id}:${channel}`,
      summary: `渠道核对 ${channel}：${status}`,
      payload: { proposal_id, channel, status, scope, human_reviewed, human_reviewer_id, review_note, ai_output_disclosure, conditions },
      actor,
    }, opts);
  }

  // -- 雷同提示（系统只提示）与人工裁定 -------------------------------------

  /**
   * 计算雷同度并追加 SIMILARITY_FLAGGED（advisory_only=true）。
   * @returns {{flagged: boolean, report?: object, score?: number}}
   */
  runSimilarityCheck(proposalId, { actor = { id: "similarity-bot", role: "system" }, threshold, silent = false } = {}) {
    const proposal = this._requireProposal(proposalId);
    const hit = compareProposal(this.state, proposal, threshold ? { threshold } : {});
    if (!hit) return { flagged: false };
    // 同一对照方案、相似度没有超过既有提示时不重复发报；
    // 修改后变得更像，则再次提示（仍只提示、由人裁定）。
    const priorReport = proposal.similarity_report_ids
      .map((id) => this.state.reports.get(id))
      .find((r) =>
        r.compared_proposal_ids.join("|") === hit.compared_proposal_ids.join("|") && r.score >= hit.score);
    if (priorReport) return { flagged: false, deduplicated_of: priorReport.report_id };
    const report_id = genId("sim");
    const event = this._append({
      event_type: "SIMILARITY_FLAGGED",
      aggregate_type: "similarity_report",
      aggregate_id: report_id,
      summary: `雷同提示：与 ${hit.compared_proposal_ids.join("、")} 相似度 ${hit.score}（仅提示，不判定抄袭）`,
      payload: {
        proposal_id: proposalId,
        compared_proposal_ids: hit.compared_proposal_ids,
        score: hit.score,
        matched_segments: hit.matched_segments,
        advisory_only: true,
      },
      actor,
    });
    return { flagged: true, report: event, score: hit.score, silent };
  }

  adjudicateSimilarity(input, opts) {
    const { report_id, disposition, rationale, adjudicator_id, actor } = input;
    const report = this.state.reports.get(report_id);
    if (!report) throw new ConflictError(`雷同提示报告不存在：${report_id}`);
    if (report.adjudication) throw new ConflictError("该报告已人工裁定；裁定不可改写，如有异议请追加新的说明性事件");
    return this._append({
      event_type: "SIMILARITY_ADJUDICATED",
      aggregate_type: "similarity_report",
      aggregate_id: report_id,
      summary: `雷同提示人工裁定：${disposition}`,
      payload: { report_id, proposal_id: report.proposal_id, disposition, rationale, adjudicator_id },
      actor,
    }, opts);
  }

  // -- 变更：只重审受影响部分，既有意见必须显式承继 -------------------------

  requestChange(input, opts) {
    const { proposal_id, change_id = genId("change"), change_kind, affected_sections, justification, requested_by, actor } = input;
    this._requireProposal(proposal_id);
    if (this.state.changes.has(change_id)) throw new ConflictError(`变更已存在：${change_id}`);
    // 给申报方即时反馈：这类变更至少要重审哪些部分。
    const proposal = this.state.proposals.get(proposal_id);
    const required_scope = requiredRereviewScope({ change_kind, affected_sections }, proposal);
    const event = this._append({
      event_type: "CHANGE_REQUESTED",
      aggregate_type: "change_request",
      aggregate_id: `change:${change_id}`,
      summary: `变更申请 ${change_id}：${change_kind}`,
      payload: { proposal_id, change_id, change_kind, affected_sections, justification, requested_by },
      actor,
    }, opts);
    return { event, required_rereview_scope: required_scope };
  }

  reviewChange(input, opts) {
    const { change_id, decision, rereview_scope, carried_review_ids, invalidated_review_ids = [], conditions, note, reviewer_id, actor } = input;
    const change = this.state.changes.get(change_id);
    if (!change) throw new ConflictError(`变更不存在：${change_id}`);
    if (change.decision) throw new ConflictError(`变更 ${change_id} 已经过审批；决定不可原地改写`);
    const proposal = this._requireProposal(change.proposal_id);

    const candidate = { decision, rereview_scope, carried_review_ids, invalidated_review_ids, conditions };
    const errors = validateChangeDecision(change, proposal, this.state, candidate);
    if (errors.length) throw new ValidationError(errors);

    return this._append({
      event_type: "CHANGE_REVIEWED",
      aggregate_type: "approval_decision",
      aggregate_id: `decision:${change_id}`,
      summary: `变更审批 ${change_id}：${decision}，重审 ${rereview_scope.length ? rereview_scope.join("、") : "（无）"}，承继意见 ${carried_review_ids.length} 条`,
      payload: {
        change_id, proposal_id: change.proposal_id, decision, rereview_scope,
        carried_review_ids, invalidated_review_ids, conditions, note, reviewer_id,
      },
      actor,
    }, opts);
  }

  // -- 阶段批准与上线 -------------------------------------------------------

  approveStage(input, opts) {
    const { proposal_id, stage, decision, conditions, board_id, note, actor } = input;
    this._requireProposal(proposal_id);
    if (decision === "approved") {
      const { blockers } = evaluateStage(this.state, proposal_id, stage);
      if (blockers.length) throw new GateError(blockers);
    }
    return this._append({
      event_type: "STAGE_APPROVED",
      aggregate_type: "approval_decision",
      aggregate_id: `stage:${proposal_id}:${stage}`,
      summary: `${stage} 阶段评审：${decision}`,
      payload: { proposal_id, stage, decision, conditions, board_id, note },
      actor,
    }, opts);
  }

  releaseVersion(input, opts) {
    const { proposal_id, release_id = genId("rel"), version, artifact_ref, based_on_change_ids, prototype_version, release_notes, approver_id, actor } = input;
    const proposal = this._requireProposal(proposal_id);
    const { blockers } = evaluateRelease(this.state, proposal_id);
    if (blockers.length) throw new GateError(blockers);
    const goLive = proposal.stage_decisions.get("go_live");
    if (prototype_version !== undefined && !proposal.prototypes.some((p) => p.version === prototype_version)) {
      throw new ConflictError(`原型版本 v${prototype_version} 不存在`);
    }
    if ([...this.state.releases.values()].some((r) => r.proposal_id === proposal_id && r.version === version)) {
      throw new ConflictError(`版本号 ${version} 已发布；版本不可覆盖`);
    }
    return this._append({
      event_type: "VERSION_RELEASED",
      aggregate_type: "release",
      aggregate_id: `release:${release_id}`,
      summary: `上线发布：${proposal.title} ${version}`,
      payload: { proposal_id, release_id, version, artifact_ref, based_on_change_ids, prototype_version, release_notes, approver_id },
      actor,
    }, opts);
  }

  // -- 开放后的匿名互动（只能用于改进体验） ---------------------------------

  recordVisitorSignal({ release_id, signal_kind, summary_text }, opts) {
    const release = this.state.releases.get(release_id);
    if (!release) throw new ConflictError(`上线版本不存在：${release_id}`);
    const signal_id = genId("signal");
    return this._append({
      event_type: "VISITOR_SIGNAL_RECORDED",
      aggregate_type: "visitor_signal",
      aggregate_id: `signal:${signal_id}`,
      summary: `匿名观众反馈（${signal_kind}），仅限改进体验`,
      // permitted_use / anonymous 由服务端强制写入，调用方无法改成其他用途。
      payload: { release_id, signal_kind, permitted_use: "experience_improvement", anonymous: true, summary_text },
      actor: { id: "anonymous-visitor", role: "anonymous" },
    }, opts);
  }

  // -- 更正（后继记录，原事件不动） -----------------------------------------

  recordCorrection({ predecessor_event_id, reason, correction, actor }, opts) {
    const predecessor = this.store.get(predecessor_event_id);
    if (!predecessor) throw new ConflictError(`被更正事件不存在：${predecessor_event_id}`);
    return this._append({
      event_type: "CORRECTION_RECORDED",
      aggregate_type: predecessor.aggregate_type,
      aggregate_id: predecessor.aggregate_id,
      summary: `更正事件 ${predecessor_event_id}：${reason}`,
      payload: { predecessor_event_id, reason, correction },
      actor,
      predecessor_event_id,
    }, opts);
  }

  // -- 只读查询 -------------------------------------------------------------

  gateReport(proposalId, opts = {}) {
    this._requireProposal(proposalId);
    return evaluateProposal(this.state, proposalId, opts);
  }

  /** 从事件重建投影的静态便捷方法（离线审计用）。 */
  static replay(events) {
    return buildProjection(events);
  }
}
