/**
 * 事件流投影：把只追加事件链重建成"方案决策链"读模型。
 *
 * 读模型只是事件的派生物，任何时候都能从全量事件重新计算；
 * 决策事实以事件为准，投影中不保存任何不可重放的状态。
 */

import { sceneScopeAffected, opinionTouched } from "./change-scope.js";

const STAGES = ["acceptance", "pre_release", "go_live"];

export function createState() {
  return {
    theses: new Map(), // aggregateId -> thesis 读模型
    proposals: new Map(), // proposal_id -> proposal 读模型
    assets: new Map(), // aggregateId -> asset 读模型
    reports: new Map(), // similarity_report aggregateId -> 报告（含裁定）
    changes: new Map(), // change_id -> 变更请求（含重审决定）
    releases: new Map(), // release_id -> 上线版本
    signals: [], // 匿名观众信号（仅用于改进体验）
    corrections: new Map(), // predecessorEventId -> [更正事件]
    events: [],
  };
}

function proposalOf(state, proposalId) {
  let p = state.proposals.get(proposalId);
  if (!p) {
    p = {
      proposal_id: proposalId,
      thesis_id: null,
      title: null,
      channels: [],
      venues: [],
      lead_org: null,
      created_at: null,
      prototypes: [],
      components: [],
      budgets: [],
      accessibility_reviews: [],
      scholar_reviews: [],
      channel_checks: new Map(), // channel -> 最新核对
      stage_decisions: new Map(), // stage -> 最新决定
      change_ids: [],
      release_ids: [],
      similarity_report_ids: [],
    };
    state.proposals.set(proposalId, p);
  }
  return p;
}

export function applyEvent(state, event) {
  state.events.push(event);
  const { event_type: type, aggregate_id: aggId, payload: p, occurred_at: at, event_id: eventId, seq } = event;

  switch (type) {
    case "THESIS_SUBMITTED": {
      state.theses.set(aggId, {
        thesis_aggregate_id: aggId,
        title: p.title,
        cultural_claim: p.cultural_claim,
        research_questions: p.research_questions ?? [],
        keywords: p.keywords ?? [],
        submitter_id: p.submitter_id ?? null,
        submitted_at: at,
        withdrawn: null,
      });
      break;
    }
    case "THESIS_WITHDRAWN": {
      const t = state.theses.get(aggId);
      if (t) t.withdrawn = { reason: p.reason, at, event_id: eventId };
      break;
    }
    case "PROPOSAL_CREATED": {
      const proposal = proposalOf(state, p.proposal_id);
      Object.assign(proposal, {
        thesis_id: p.thesis_id,
        title: p.title,
        channels: p.channels,
        venues: p.venues ?? [],
        lead_org: p.lead_org ?? null,
        created_at: at,
      });
      break;
    }
    case "ASSET_REGISTERED": {
      state.assets.set(aggId, {
        asset_aggregate_id: aggId,
        asset_id: p.asset_id,
        kind: p.kind,
        title: p.title,
        citation: p.citation,
        holding_institution: p.holding_institution ?? null,
        custodian_contact: p.custodian_contact ?? null,
        provenance_note: p.provenance_note ?? null,
        acquired_at: p.acquired_at ?? null,
        clearances: [],
      });
      break;
    }
    case "SOURCE_CLEARED": {
      const asset = state.assets.get(aggId);
      if (asset) {
        asset.clearances.push({
          event_id: eventId,
          proposal_id: p.proposal_id ?? null,
          scope: p.scope ?? {},
          cleared: p.cleared,
          license_document_ref: p.license_document_ref ?? null,
          limitations: p.limitations ?? [],
          reviewer_id: p.reviewer_id ?? null,
          at,
          seq,
        });
      }
      break;
    }
    case "PROTOTYPE_SUBMITTED": {
      const proposal = proposalOf(state, p.proposal_id);
      proposal.prototypes.push({
        event_id: eventId,
        version: p.prototype_version,
        artifact_ref: p.artifact_ref ?? null,
        scenes: p.demo_scenes,
        at,
        seq,
      });
      break;
    }
    case "COMPONENT_DECLARED": {
      const proposal = proposalOf(state, p.proposal_id);
      proposal.components.push({
        event_id: eventId,
        component_id: p.component_id ?? aggId,
        name: p.name,
        supplier_id: p.supplier_id ?? null,
        is_reuse: p.is_reuse,
        origin: p.origin ?? null,
        modifications: p.modifications ?? null,
        qualification_evidence_ref: p.qualification_evidence_ref ?? null,
        at,
        seq,
      });
      break;
    }
    case "BUDGET_MILESTONE_SET": {
      proposalOf(state, p.proposal_id).budgets.push({
        event_id: eventId,
        currency: p.currency,
        total_amount: p.total_amount,
        milestones: p.milestones,
        at,
        seq,
      });
      break;
    }
    case "ACCESSIBILITY_REVIEWED": {
      const reviewId = p.review_id ?? aggId;
      proposalOf(state, p.proposal_id).accessibility_reviews.push({
        event_id: eventId,
        review_id: reviewId,
        standard: p.standard ?? null,
        result: p.result,
        scope_sections: p.scope_sections,
        findings: p.findings ?? [],
        conditions: p.conditions ?? [],
        reviewer_org: p.reviewer_org ?? null,
        reviewed_prototype_version: p.reviewed_prototype_version ?? null,
        at,
        seq,
      });
      break;
    }
    case "SCHOLAR_REVIEW_RECORDED": {
      proposalOf(state, p.proposal_id).scholar_reviews.push({
        event_id: eventId,
        review_id: p.review_id,
        verdict: p.verdict,
        opinion: p.opinion,
        scope_sections: p.scope_sections,
        reviewed_prototype_version: p.reviewed_prototype_version ?? null,
        conditions: p.conditions ?? [],
        reviewer_id: p.reviewer_id ?? null,
        reviewer_display_name: p.reviewer_display_name ?? null,
        reviewer_org: p.reviewer_org ?? null,
        at,
        seq,
      });
      break;
    }
    case "CHANNEL_SCOPE_CHECKED": {
      proposalOf(state, p.proposal_id).channel_checks.set(p.channel, {
        event_id: eventId,
        channel: p.channel,
        status: p.status,
        scope: p.scope ?? null,
        human_reviewed: p.human_reviewed ?? false,
        human_reviewer_id: p.human_reviewer_id ?? null,
        review_note: p.review_note ?? null,
        ai_output_disclosure: p.ai_output_disclosure ?? null,
        conditions: p.conditions ?? [],
        at,
        seq,
      });
      break;
    }
    case "SIMILARITY_FLAGGED": {
      const reportId = aggId;
      const report = {
        report_id: reportId,
        proposal_id: p.proposal_id,
        compared_proposal_ids: p.compared_proposal_ids,
        score: p.score,
        matched_segments: p.matched_segments ?? [],
        advisory_only: true,
        flagged_at: at,
        flag_event_id: eventId,
        adjudication: null,
      };
      state.reports.set(reportId, report);
      proposalOf(state, p.proposal_id).similarity_report_ids.push(reportId);
      break;
    }
    case "SIMILARITY_ADJUDICATED": {
      const report = state.reports.get(aggId);
      if (report) {
        report.adjudication = {
          disposition: p.disposition,
          rationale: p.rationale,
          adjudicator_id: p.adjudicator_id ?? null,
          at,
          seq,
          event_id: eventId,
        };
      }
      break;
    }
    case "CHANGE_REQUESTED": {
      state.changes.set(p.change_id, {
        change_id: p.change_id,
        proposal_id: p.proposal_id,
        change_kind: p.change_kind,
        affected_sections: p.affected_sections,
        justification: p.justification,
        requested_by: p.requested_by ?? null,
        at,
        seq,
        event_id: eventId,
        decision: null,
      });
      proposalOf(state, p.proposal_id).change_ids.push(p.change_id);
      break;
    }
    case "CHANGE_REVIEWED": {
      const change = state.changes.get(p.change_id);
      if (change) {
        change.decision = {
          decision: p.decision,
          rereview_scope: p.rereview_scope,
          carried_review_ids: p.carried_review_ids,
          invalidated_review_ids: p.invalidated_review_ids ?? [],
          conditions: p.conditions ?? [],
          note: p.note ?? null,
          reviewer_id: p.reviewer_id ?? null,
          at,
          seq,
          event_id: eventId,
        };
      }
      break;
    }
    case "STAGE_APPROVED": {
      proposalOf(state, p.proposal_id).stage_decisions.set(p.stage, {
        stage: p.stage,
        decision: p.decision,
        conditions: p.conditions ?? [],
        board_id: p.board_id ?? null,
        note: p.note ?? null,
        at,
        seq,
        event_id: eventId,
      });
      break;
    }
    case "VERSION_RELEASED": {
      const release = {
        release_id: p.release_id,
        proposal_id: p.proposal_id,
        version: p.version,
        artifact_ref: p.artifact_ref,
        based_on_change_ids: p.based_on_change_ids ?? [],
        prototype_version: p.prototype_version ?? null,
        release_notes: p.release_notes ?? null,
        approver_id: p.approver_id ?? null,
        at,
        seq,
        event_id: eventId,
      };
      state.releases.set(p.release_id, release);
      proposalOf(state, p.proposal_id).release_ids.push(p.release_id);
      break;
    }
    case "VISITOR_SIGNAL_RECORDED": {
      state.signals.push({
        signal_aggregate_id: aggId,
        release_id: p.release_id,
        signal_kind: p.signal_kind,
        permitted_use: "experience_improvement",
        anonymous: true,
        summary_text: p.summary_text ?? null,
        at,
        seq,
        event_id: eventId,
      });
      break;
    }
    case "CORRECTION_RECORDED": {
      const list = state.corrections.get(p.predecessor_event_id) ?? [];
      list.push({ event_id: eventId, reason: p.reason, correction: p.correction ?? null, at, seq });
      state.corrections.set(p.predecessor_event_id, list);
      break;
    }
    default:
      break;
  }
  return state;
}

export function buildProjection(events) {
  const state = createState();
  for (const event of events) applyEvent(state, event);
  return state;
}

/** 订阅存储，返回随事件实时更新的投影状态。 */
export function liveProjection(store) {
  const state = createState();
  store.subscribe((event) => applyEvent(state, event));
  return state;
}

// ---- 读模型上的便捷派生 ----

export function latestPrototype(proposal) {
  return proposal.prototypes.reduce((acc, pr) => (!acc || pr.version > acc.version ? pr : acc), null);
}

export function latestBudget(proposal) {
  return proposal.budgets.length ? proposal.budgets.at(-1) : null;
}

export function channelCheck(proposal, channel) {
  return proposal.channel_checks.get(channel) ?? null;
}

export function stageDecision(proposal, stage) {
  return proposal.stage_decisions.get(stage) ?? null;
}

export function changesOf(proposal, state) {
  return proposal.change_ids.map((id) => state.changes.get(id)).filter(Boolean);
}

export function releasesOf(proposal, state) {
  return proposal.release_ids.map((id) => state.releases.get(id)).filter(Boolean);
}

/**
 * 计算学术/无障碍意见在历次已批准变更后的存活状态。
 * 返回 Map<review_id, {kind, alive, orphaned_by, state}>：
 * - alive：当前仍可作为门禁依据
 * - orphaned：某次变更既未把它列入承继、也未列入失效——学术意见悬空（平台拒绝这种决定，此处用于兜底展示）
 */
export function reviewLifecycle(proposal, state) {
  const result = new Map();
  for (const r of proposal.scholar_reviews) {
    result.set(r.review_id, { kind: "scholarly_content", review: r, alive: true, orphaned_by: null });
  }
  for (const r of proposal.accessibility_reviews) {
    result.set(r.review_id, { kind: "accessibility", review: r, alive: true, orphaned_by: null });
  }

  for (const change of changesOf(proposal, state)) {
    const d = change.decision;
    if (!d || d.decision === "rejected") continue;

    for (const [id, info] of result) {
      // 变更之后才产生的意见不受此次变更影响（按日志序号判定先后）。
      if (info.review.seq > d.seq) continue;
      // 片段级判定：只有意见覆盖的片段确实落入受影响范围才算触动。
      const affectedSet = sceneScopeAffected(change, d.rereview_scope, info.kind);
      const touched = opinionTouched(info.review.scope_sections, affectedSet);
      if (touched) {
        if (d.invalidated_review_ids.includes(id)) {
          info.alive = false;
        } else if (!d.carried_review_ids.includes(id)) {
          // 重审范围内却没有显式失效，也没有承继 → 悬空。
          info.orphaned_by = change.change_id;
        }
      } else if (!d.carried_review_ids.includes(id)) {
        // 不受影响却没有显式承继 → 悬空。
        info.orphaned_by = change.change_id;
      }
    }
  }
  return result;
}

export { STAGES };
