/**
 * 立项与变更平台服务门面。
 *
 * 在只增事件存储之上提供完整决策链操作：
 *   命题 → 研究素材登记/许可 → 学术审读 → 交互原型（证据下钻）→ 组件复用披露
 *   → 预算里程碑 → 无障碍评估 → 雷同提示（人工裁定）→ 特殊核对（海外/原址/AIGC）
 *   → 评审门禁 → 上线版本；变更只局部重审，学术意见显式沿用；
 *   开放互动仅限改进体验，不得成为史实。
 */

import { randomUUID } from "node:crypto";

import { EventStore, ConstraintError } from "./store/event-store.js";
import { GATE_ORDER } from "./contracts.js";
import { projectProposal } from "./projector.js";
import { canDecideGate, canRelease } from "./workflow/gates.js";
import { findSimilarProposals, buildSimilarityFlag } from "./policies/similarity.js";
import { planChangeReview, carryForwardAcademicReviews } from "./policies/change-policy.js";
import { checkSpecialClearance } from "./policies/special-review.js";
import { checkInteractionCaptured, reviewInteractionUse, buildViolationEvent } from "./policies/interaction.js";

export { ConstraintError };

export class Platform {
  /**
   * @param {object} [opts]
   * @param {string|null} [opts.file] JSONL 持久化路径；null 为内存存储。
   * @param {() => string} [opts.now] 可注入时钟（确定性测试）。
   */
  constructor({ file = null, now = () => new Date().toISOString(), store } = {}) {
    this.store = store ?? new EventStore({ file });
    this.now = now;
  }

  /** 构造事件信封并按聚合实例分配下一版本号。 */
  _envelope({ eventType, aggregateType, aggregateId, summary, payload, actor, supersedes }) {
    const version = this.store.versionOf(aggregateType, aggregateId) + 1;
    return {
      event_id: `evt-${randomUUID()}`,
      event_type: eventType,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      occurred_at: this.now(),
      version,
      summary,
      payload,
      ...(actor ? { actor } : {}),
      ...(supersedes ? { supersedes_event_id: supersedes } : {}),
    };
  }

  _append(partial) {
    return this.store.append(this._envelope(partial));
  }

  // ---- 1. 策展命题 ----

  submitThesis({ proposal_id, title, proposition, core_questions = [], keywords = [], proposer, actor }) {
    if (!proposition || String(proposition).trim() === "") {
      throw new ConstraintError("方案必须先提出独有的文化命题", {
        details: ["缺少 proposition：纯设备采购式方案不得立项"],
      });
    }
    return this._append({
      eventType: "THESIS_SUBMITTED",
      aggregateType: "curatorial_thesis",
      aggregateId: proposal_id,
      summary: `提交策展命题：${title}`,
      payload: { proposal_id, title, proposition, core_questions, keywords, ...(proposer ? { proposer } : {}) },
      actor,
    });
  }

  reviseThesis({ proposal_id, revision_of_event_id, proposition, change_note, actor }) {
    return this._append({
      eventType: "THESIS_REVISED",
      aggregateType: "curatorial_thesis",
      aggregateId: proposal_id,
      summary: `修订策展命题（${proposal_id}）`,
      payload: { proposal_id, revision_of_event_id, proposition, change_note },
      actor,
    });
  }

  createProposal({ proposal_id, title, thesis_event_id, flags = {}, actor }) {
    return this._append({
      eventType: "PROPOSAL_CREATED",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `建立展项方案：${title}`,
      payload: {
        proposal_id,
        thesis_event_id,
        title,
        involves_overseas_tour: Boolean(flags.overseas_tour),
        involves_site_superposition: Boolean(flags.site_superposition),
        involves_ai_generated: Boolean(flags.ai_generated),
      },
      actor,
    });
  }

  // ---- 2. 研究素材与许可（考古测绘 / 建筑图档 / 声音采集 / 学术资料） ----

  registerAsset({ asset_id, proposal_id, asset_kind, title, custodian, content_hash, provenance_note, bib_ref, actor }) {
    return this._append({
      eventType: "SOURCE_REGISTERED",
      aggregateType: "research_asset",
      aggregateId: asset_id,
      summary: `登记研究素材：${title}（${asset_kind}）`,
      payload: {
        proposal_id, asset_kind, title, custodian, content_hash,
        ...(provenance_note ? { provenance_note } : {}),
        ...(bib_ref ? { bib_ref } : {}),
      },
      actor,
    });
  }

  clearAsset({ asset_id, proposal_id, license_scope, scope_territories = [], scope_venues = [],
    ai_generated = false, human_reviewed = false, human_reviewer_ids = [], clearance_valid_until, terms_summary, actor }) {
    return this._append({
      eventType: "SOURCE_CLEARED",
      aggregateType: "research_asset",
      aggregateId: asset_id,
      summary: `记录素材许可：${asset_id} 使用范围 ${license_scope}`,
      payload: {
        proposal_id, license_scope, scope_territories, scope_venues,
        ai_generated, human_reviewed, human_reviewer_ids,
        ...(clearance_valid_until ? { clearance_valid_until } : {}),
        terms_summary,
      },
      actor,
    });
  }

  // ---- 3. 学术审读 ----

  recordAcademicReview({ proposal_id, target_kind, target_ref, reviewer, verdict, conditions = [], claims_reviewed = [], notes, actor }) {
    return this._append({
      eventType: "ACADEMIC_REVIEW_RECORDED",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `学术审读（${target_kind}:${target_ref}）：${verdict}`,
      payload: { proposal_id, target_kind, target_ref, reviewer, verdict, conditions, claims_reviewed, notes },
      actor,
    });
  }

  // ---- 4. 交互原型与证据链 ----

  submitPrototype({ proposal_id, prototype_id, demo_ref, claims, actor }) {
    return this._append({
      eventType: "PROTOTYPE_SUBMITTED",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `提交交互原型：${prototype_id}`,
      payload: { proposal_id, prototype_id, demo_ref, claims },
      actor,
    });
  }

  // ---- 5. 供应商组件：成熟可复用，但须披露来源与修改 ----

  registerComponent({ component_id, name, maturity, origin_ref, origin_license, supplier, actor }) {
    return this._append({
      eventType: "COMPONENT_REGISTERED",
      aggregateType: "reused_component",
      aggregateId: component_id,
      summary: `登记组件：${name}（${maturity === "mature" ? "成熟可复用" : "新研发"}）`,
      payload: {
        component_id, name, maturity, origin_ref,
        ...(origin_license ? { origin_license } : {}),
        ...(supplier ? { supplier } : {}),
      },
      actor,
    });
  }

  declareComponent({ proposal_id, component_id, reuse, modified, modifications = [], origin_disclosure, supplier_quote, actor }) {
    return this._append({
      eventType: "COMPONENT_DECLARED",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `申报组件复用披露：${component_id}`,
      payload: {
        proposal_id, component_id, reuse, modified, modifications, origin_disclosure,
        ...(supplier_quote ? { supplier_quote } : {}),
      },
      actor,
    });
  }

  // ---- 6. 预算里程碑 ----

  setBudget({ proposal_id, currency, milestones, total_amount, actor }) {
    return this._append({
      eventType: "BUDGET_MILESTONE_SET",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `设定预算与 ${milestones.length} 个里程碑`,
      payload: { proposal_id, currency, milestones, total_amount },
      actor,
    });
  }

  // ---- 7. 无障碍评估 ----

  assessAccessibility({ proposal_id, standard, result, findings = [], remediations = [], reassessment_required = false, actor }) {
    return this._append({
      eventType: "ACCESSIBILITY_ASSESSED",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `无障碍评估：${result}`,
      payload: { proposal_id, standard, result, findings, remediations, reassessment_required },
      actor,
    });
  }

  // ---- 8. 雷同提示（只提示，绝不自动判抄袭） ----

  /**
   * 扫描与其他方案的雷同信号。命中阈值只追加 SIMILARITY_FLAGGED 提示，
   * 是否抄袭须由人工在 decideGate('similarity', ...) 中以 adjudicates_event_id 裁定。
   */
  runSimilarityCheck(proposalId, { threshold = 0.55 } = {}) {
    const projection = this.getProposal(proposalId);
    const target = projection.thesis.current;
    if (!target) throw new ConstraintError("尚未提交命题，无法做雷同比对", { details: [] });

    const otherTheses = this._latestThesisPerProposal().filter(
      (t) => t.payload.proposal_id !== proposalId,
    );
    const candidates = findSimilarProposals(target, otherTheses, { threshold });
    if (candidates.length === 0) return { flagged: false, candidates: [] };

    const partial = buildSimilarityFlag(target, candidates, threshold);
    const event = this._append({
      eventType: partial.event_type,
      aggregateType: partial.aggregate_type,
      aggregateId: proposalId,
      summary: partial.summary,
      payload: partial.payload,
    });
    return { flagged: true, flag: event, candidates };
  }

  _latestThesisPerProposal() {
    const latest = new Map();
    for (const e of this.store.stream("curatorial_thesis")) {
      latest.set(e.payload.proposal_id, e); // 流按追加顺序，后者覆盖
    }
    return [...latest.values()];
  }

  // ---- 9. 特殊核对：海外巡展 / 原址叠加 / AI 生成内容 ----

  recordSpecialClearance({ proposal_id, review_kind, human_reviewer, usage_scope, verdict, conditions = [], scopeCtx = {}, actor }) {
    const draft = {
      event_id: "draft", event_type: "SPECIAL_REVIEW_CLEARED", aggregate_type: "experience_proposal",
      aggregate_id: proposal_id, occurred_at: this.now(), version: 1, summary: "draft",
      payload: { proposal_id, review_kind, human_reviewed: true, human_reviewer, usage_scope, verdict, conditions },
    };
    // 只核对本次特殊用途实际使用到的素材（scopeCtx.asset_ids）；未指定则不做逐素材范围比对。
    // 传入的是素材许可事件（携带 license_scope / ai_generated / human_reviewed）。
    const assetMap = this.getProposal(proposal_id).assets;
    const ids = scopeCtx.asset_ids ?? [];
    const assets = ids
      .map((id) => assetMap.get(id)?.clearance)
      .filter(Boolean);
    const problems = checkSpecialClearance(draft, { scope: scopeCtx, assets });
    if (problems.length > 0) {
      throw new ConstraintError("特殊核对范围与素材许可不一致", { code: "special_review", details: problems });
    }
    return this._append({
      eventType: "SPECIAL_REVIEW_CLEARED",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `特殊核对（${review_kind}）：${verdict}`,
      payload: { proposal_id, review_kind, human_reviewed: true, human_reviewer, usage_scope, verdict, conditions },
      actor,
    });
  }

  // ---- 10. 评审门禁（人工结论） ----

  requestReview({ proposal_id, gate, reason, actor }) {
    return this._append({
      eventType: "REVIEW_REQUESTED",
      aggregateType: "approval_decision",
      aggregateId: proposal_id,
      summary: `提请门禁评审：${gate}`,
      payload: { proposal_id, gate, reason },
      actor,
    });
  }

  decideGate({ proposal_id, gate, verdict, reviewer_ids, conditions = [], note, adjudicates_event_id, actor }) {
    if (!GATE_ORDER.includes(gate)) throw new ConstraintError(`未知门禁：${gate}`, { details: [] });
    const projection = this.getProposal(proposal_id);
    const guard = canDecideGate(gate, verdict, projection, {
      adjudicatesEventId: adjudicates_event_id,
    });
    if (!guard.allowed) {
      throw new ConstraintError(`门禁「${gate}」不能给出「${verdict}」结论`, {
        code: "gate_blocked",
        details: guard.reasons,
      });
    }
    return this._append({
      eventType: "REVIEW_DECIDED",
      aggregateType: "approval_decision",
      aggregateId: proposal_id,
      summary: `门禁「${gate}」结论：${verdict}`,
      payload: {
        proposal_id, gate, verdict, reviewer_ids, conditions, note,
        ...(adjudicates_event_id ? { adjudicates_event_id } : {}),
      },
      actor,
    });
  }

  // ---- 11. 变更：只重开受影响部分，学术意见不悬空 ----

  requestChange({ proposal_id, change_class, affected_sections = [], reason, details = {}, actor }) {
    const plan = planChangeReview(change_class, affected_sections);
    const seq = this.store.stream("change_request").filter((e) =>
      e.payload?.proposal_id === proposal_id).length + 1;
    const change_request_id = `${proposal_id}-CR${String(seq).padStart(2, "0")}`;

    const event = this._append({
      eventType: "CHANGE_REQUESTED",
      aggregateType: "change_request",
      aggregateId: change_request_id,
      summary: `变更申请：${plan.baseline.label}（重开 ${plan.reopenedGates.join("、") || "无门禁"}）`,
      payload: { proposal_id, change_class, affected_sections, reason, details: { ...details, planned_reopened_gates: plan.reopenedGates } },
      actor,
    });
    return { event, change_request_id, plan };
  }

  reviewChange({ change_request_id, decision, reviewer_ids, note, conditions = [], actor }) {
    const request = this.store.stream("change_request").find(
      (e) => e.aggregate_id === change_request_id && e.event_type === "CHANGE_REQUESTED",
    );
    if (!request) throw new ConstraintError(`变更申请不存在：${change_request_id}`, { details: [] });

    const { proposal_id, change_class, affected_sections } = request.payload;
    const plan = planChangeReview(change_class, affected_sections);
    const projection = this.getProposal(proposal_id);

    // 批准前，受影响且重开的门禁当前若仍有阻塞，不允许批准变更闭环；驳回则直接留痕。
    if (decision === "approved") {
      const openBlockers = plan.reopenedGates
        .map((g) => projection.gates.get(g))
        .filter((g) => g && g.blockers.length > 0)
        .map((g) => `${g.gate}：${g.blockers.join("；")}`);
      if (openBlockers.length > 0) {
        throw new ConstraintError("变更涉及部分尚未补齐重审材料", {
          code: "change_blocked",
          details: openBlockers,
        });
      }
    }

    // 学术意见不悬空：自动汇总未受影响的既有审读，强制显式沿用。
    // target_ref→门禁 用默认映射（命题/素材/原型/章节）；当素材或原型按 section 标注时，
    // 可在此结合 affected_sections 进一步精确裁剪。
    const carried = carryForwardAcademicReviews(
      projection.academicReviews,
      plan.reopenedGates,
      this._reviewTargetGateIndex(affected_sections),
    );

    return this._append({
      eventType: "CHANGE_REVIEWED",
      aggregateType: "change_request",
      aggregateId: change_request_id,
      summary: `变更评审：${plan.baseline.label} → ${decision}；沿用 ${carried.length} 条学术意见`,
      payload: {
        change_request_id, proposal_id, decision,
        reopened_gates: decision === "approved" ? plan.reopenedGates : [],
        carried_reviews: decision === "approved" ? carried : [],
        conditions, reviewer_ids, note,
      },
      actor,
    });
  }

  _reviewTargetGateIndex(affectedSections) {
    // 预留：当素材登记/原型按展项 section 标注时，据此把受影响部分映射到
    // 具体 target_ref，精确裁剪学术意见沿用范围。当前按 target_kind 默认门禁沿用。
    return new Map();
  }

  // ---- 12. 上线版本 ----

  releaseVersion({ proposal_id, version_tag, release_note, actor }) {
    const projection = this.getProposal(proposal_id);
    const guard = canRelease(projection);
    if (!guard.allowed) {
      throw new ConstraintError("方案尚未满足上线条件", { code: "release_blocked", details: guard.reasons });
    }
    const gate_snapshot = {};
    for (const gate of GATE_ORDER) {
      const g = projection.gates.get(gate);
      gate_snapshot[gate] = { state: g.state, decision_event_id: g.decision?.event_id ?? null };
    }
    return this._append({
      eventType: "VERSION_RELEASED",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `上线发布版本：${version_tag}`,
      payload: { proposal_id, version_tag, gate_snapshot, release_note },
      actor,
    });
  }

  withdrawVersion({ proposal_id, version_tag, reason, actor }) {
    return this._append({
      eventType: "VERSION_WITHDRAWN",
      aggregateType: "experience_proposal",
      aggregateId: proposal_id,
      summary: `撤下版本：${version_tag}`,
      payload: { proposal_id, version_tag, reason },
      actor,
    });
  }

  // ---- 13. 开放后匿名互动：仅用于改进体验 ----

  captureInteraction({ proposal_id, version_tag, kind, pseudonymous_session_ref, payload_summary, actor }) {
    const event = this._envelope({
      eventType: "INTERACTION_CAPTURED",
      aggregateType: "interaction_record",
      aggregateId: `interaction-${proposal_id}`,
      summary: `采集匿名互动（${kind}）`,
      payload: {
        proposal_id, version_tag, anonymous: true, kind,
        usage_purpose: "experience_improvement_only",
        ...(pseudonymous_session_ref ? { pseudonymous_session_ref } : {}),
        ...(payload_summary ? { payload_summary } : {}),
      },
      actor,
    });
    const problems = checkInteractionCaptured(event);
    if (problems.length) throw new ConstraintError("互动记录不符合匿名/用途要求", { details: problems });
    return this.store.append(event);
  }

  /**
   * 请求把互动数据用于某用途。越界用途（写成史实/再识别）一律拒绝，
   * 并追加 INTERACTION_PURPOSE_VIOLATION_DETECTED 留痕。
   */
  requestInteractionUse(proposal_id, attempted) {
    const review = reviewInteractionUse(attempted);
    if (review.allowed) return { allowed: true, review };

    const partial = buildViolationEvent(proposal_id, review);
    const violation = this._append({
      eventType: partial.event_type,
      aggregateType: "interaction_record",
      aggregateId: `interaction-violation-${proposal_id}`,
      summary: partial.summary,
      payload: partial.payload,
    });
    return { allowed: false, review, violation_event_id: violation.event_id };
  }

  // ---- 读模型 / 下钻 ----

  getProposal(proposalId) {
    const events = this.store.streamForProposal(proposalId);
    return projectProposal(proposalId, events, { components: this.store.stream("reused_component") });
  }

  listProposals() {
    const ids = new Set();
    for (const e of this.store.all()) {
      if (typeof e.payload?.proposal_id === "string") ids.add(e.payload.proposal_id);
    }
    return [...ids].map((id) => {
      const p = this.getProposal(id);
      return {
        proposal_id: id,
        title: p.thesis.current?.payload?.title ?? p.proposal?.payload?.title ?? null,
        gates: Object.fromEntries([...p.gates].map(([k, g]) => [k, g.state])),
        release_ready: p.releaseReady.ready,
        released_versions: p.activeReleases.map((r) => r.payload.version_tag),
      };
    });
  }

  /** 评审人员由演示下钻到论证与数据出处。 */
  drilldown(proposalId) {
    return this.getProposal(proposalId).drilldown;
  }

  /** 项目组视角：哪种变更必须重新审批、重开哪几关、哪些学术意见沿用。 */
  previewChangeImpact(proposal_id, change_class, affected_sections = []) {
    const plan = planChangeReview(change_class, affected_sections);
    const projection = this.getProposal(proposal_id);
    const carried = carryForwardAcademicReviews(projection.academicReviews, plan.reopenedGates, new Map());
    return {
      change_class,
      label: plan.baseline.label,
      reapproval_needed: plan.reapprovalNeeded,
      reopened_gates: plan.reopenedGates,
      requires_special: plan.requiresSpecial,
      carried_reviews: carried,
    };
  }
}
