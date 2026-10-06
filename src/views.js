/**
 * 只读视图与脱敏。
 *
 * 可见性原则（README：个人、机构及商业敏感信息仅向履行职责所需的调用方开放）：
 * - board（市级项目办公室）：全量；
 * - reviewer（评审人员）：论证链全量（出处、许可、审读、渠道核对），看不到预算金额与馆藏联系人；
 * - applicant（申报方）：仅本申报机构的方案可见商业与联系人字段；
 * - public（开放数据/观众侧）：只看到已上线版本的公开论证、素材文献引注，看不到个人、机构、金额、供应商。
 *
 * 匿名观众信号永远以聚合形式出现，且不进入任何论证/证据视图。
 */
import { evaluateProposal } from "./policies.js";
import { latestPrototype, latestBudget, reviewLifecycle } from "./projections.js";

export const ROLES = ["board", "reviewer", "applicant", "public"];
const COMMERCIAL_ROLES = (owner) => (owner ? new Set(["board", "applicant"]) : new Set(["board"]));

function canSee(role, allowed) {
  return allowed.includes(role);
}

function redactAsset(asset, { role, owner }) {
  const view = {
    asset_id: asset.asset_id,
    kind: asset.kind,
    title: asset.title,
    citation: asset.citation,
  };
  if (canSee(role, ["board", "reviewer", "applicant"])) {
    view.provenance_note = asset.provenance_note;
  }
  if (role === "board" || role === "reviewer" || (role === "applicant" && owner)) {
    view.holding_institution = asset.holding_institution;
  }
  if (canSee(role, ["board"])) {
    view.custodian_contact = asset.custodian_contact;
  }
  view.clearances = asset.clearances.map((c) => {
    const base = {
      event_id: c.event_id,
      proposal_id: c.proposal_id,
      cleared: c.cleared,
      scope: c.scope,
      limitations: c.limitations,
    };
    if (canSee(role, ["board", "reviewer", "applicant"])) {
      base.license_document_ref = c.license_document_ref;
      base.reviewer_id = c.reviewer_id;
    }
    return base;
  });
  return view;
}

function redactScholarReview(review, { role }) {
  const base = {
    event_id: review.event_id,
    review_id: review.review_id,
    verdict: review.verdict,
    opinion: review.opinion,
    scope_sections: review.scope_sections,
    reviewed_prototype_version: review.reviewed_prototype_version,
    conditions: review.conditions,
    at: review.at,
  };
  // 评审人员的姓名/单位属于个人与机构信息：只对办公室与评审圈开放。
  if (canSee(role, ["board", "reviewer"])) {
    base.reviewer_display_name = review.reviewer_display_name;
    base.reviewer_org = review.reviewer_org;
    base.reviewer_id = review.reviewer_id;
  }
  return base;
}

function redactAccessibilityReview(review, { role, owner }) {
  return {
    event_id: review.event_id,
    review_id: review.review_id,
    standard: review.standard,
    result: review.result,
    scope_sections: review.scope_sections,
    findings: review.findings,
    conditions: review.conditions,
    reviewed_prototype_version: review.reviewed_prototype_version,
    at: review.at,
    ...(role === "board" || (role === "applicant" && owner) ? { reviewer_org: review.reviewer_org } : {}),
  };
}

function redactComponent(component, { role, owner }) {
  const base = {
    event_id: component.event_id,
    name: component.name,
    is_reuse: component.is_reuse,
    origin: component.origin,
    modifications: component.modifications,
  };
  if (COMMERCIAL_ROLES(owner).has(role)) {
    base.supplier_id = component.supplier_id;
    base.component_id = component.component_id;
    base.qualification_evidence_ref = component.qualification_evidence_ref;
  }
  return base;
}

function redactBudget(budget, { role, owner }) {
  if (!budget) return null;
  if (!COMMERCIAL_ROLES(owner).has(role)) {
    // 非商业角色只能看到里程碑节奏，看不到金额。
    return {
      event_id: budget.event_id,
      currency: null,
      total_amount: null,
      milestones: budget.milestones.map((m) => ({
        milestone_id: m.milestone_id, name: m.name, due_date: m.due_date,
        deliverable: m.deliverable, stage_gate: m.stage_gate, amount: null,
      })),
      redacted: true,
    };
  }
  return budget;
}

function redactChannelCheck(check, { role }) {
  if (!check) return null;
  return {
    event_id: check.event_id,
    channel: check.channel,
    status: check.status,
    conditions: check.conditions,
    human_reviewed: check.human_reviewed,
    review_note: check.review_note,
    at: check.at,
    scope: canSee(role, ["board", "reviewer", "applicant"]) ? check.scope : null,
    ai_output_disclosure: canSee(role, ["board", "reviewer", "applicant"]) ? check.ai_output_disclosure : null,
    ...(canSee(role, ["board"]) ? { human_reviewer_id: check.human_reviewer_id } : {}),
  };
}

/**
 * 评审下钻主视图：从每个演示片段下钻到论证、素材出处、许可、学术意见、无障碍、专项核对。
 *
 * @param {object} opts.role board | reviewer | applicant | public
 * @param {string} [opts.ownerOrg] applicant 角色须用 X-Org 标明所属机构；
 *   只有方案 lead_org 与之相符时才看得到本机构商业字段，其他机构方案按受限视图呈现。
 */
export function proposalTrace(state, proposalId, { role = "public", ownerOrg, now } = {}) {
  const proposal = state.proposals.get(proposalId);
  if (!proposal) return null;
  const owner = role === "board" || (role === "applicant" && Boolean(ownerOrg) && proposal.lead_org === ownerOrg);
  const ctx = { role, owner };
  const thesis = state.theses.get(proposal.thesis_id);
  const proto = latestPrototype(proposal);
  const lifecycle = reviewLifecycle(proposal, state);
  const gate = evaluateProposal(state, proposalId, now ? { now } : {});

  const assetById = new Map([...state.assets.values()].map((a) => [a.asset_id, a]));

  const demos = proto
    ? proto.scenes.map((scene) => {
        const covering = (kind) =>
          [...lifecycle.values()]
            .filter((i) => i.kind === kind && i.alive && !i.orphaned_by)
            .filter((i) => i.review.scope_sections.includes(scene.scene_id) || i.review.scope_sections.includes("*"))
            .map((i) => i.review);

        const aiCheck = proposal.channel_checks.get("ai_generated");
        const aiVerified = scene.ai_assisted
          ? Boolean(
              aiCheck?.status === "cleared" &&
              aiCheck.human_reviewed &&
              (aiCheck.ai_output_disclosure?.human_verified_sections ?? []).some(
                (s) => s === scene.scene_id || s === "*",
              ),
            )
          : null;

        return {
          scene_id: scene.scene_id,
          title: scene.title,
          claim: scene.claim,
          ai_assisted: scene.ai_assisted ?? false,
          ai_human_verified: aiVerified,
          asset_citations: scene.asset_citations.map((c) => {
            const asset = assetById.get(c.asset_id);
            return {
              ...c,
              asset: asset ? redactAsset(asset, ctx) : { asset_id: c.asset_id, missing: true },
            };
          }),
          scholarly_reviews: covering("scholarly_content").map((r) => redactScholarReview(r, ctx)),
          accessibility_reviews: covering("accessibility").map((r) => redactAccessibilityReview(r, ctx)),
        };
      })
    : [];

  return {
    proposal: {
      proposal_id: proposal.proposal_id,
      title: proposal.title,
      channels: proposal.channels,
      venues: canSee(role, ["board", "reviewer", "applicant"]) ? proposal.venues : [],
      ...(role === "board" || (role === "applicant" && owner) ? { lead_org: proposal.lead_org } : {}),
      created_at: proposal.created_at,
    },
    thesis: thesis
      ? {
          title: thesis.title,
          cultural_claim: thesis.cultural_claim,
          research_questions: thesis.research_questions,
          keywords: thesis.keywords,
          withdrawn: thesis.withdrawn,
        }
      : null,
    gate: { blockers: gate.blockers, advisories: gate.advisories },
    prototype: proto ? { version: proto.version, artifact_ref: proto.artifact_ref, at: proto.at } : null,
    demos,
    components: proposal.components.map((c) => redactComponent(c, ctx)),
    budget: redactBudget(latestBudget(proposal), ctx),
    channel_checks: [...proposal.channel_checks.values()].map((c) => redactChannelCheck(c, ctx)),
    similarity_reports: proposal.similarity_report_ids.map((id) => {
      const r = state.reports.get(id);
      return {
        report_id: r.report_id,
        score: r.score,
        matched_segments: r.matched_segments,
        advisory_only: true,
        adjudication: canSee(role, ["board", "reviewer", "applicant"]) ? r.adjudication : null,
      };
    }),
    changes: proposal.change_ids.map((cid) => {
      const change = state.changes.get(cid);
      return {
        change_id: change.change_id,
        change_kind: change.change_kind,
        affected_sections: change.affected_sections,
        justification: change.justification,
        at: change.at,
        decision: change.decision
          ? {
              decision: change.decision.decision,
              rereview_scope: change.decision.rereview_scope,
              carried_review_ids: change.decision.carried_review_ids,
              invalidated_review_ids: canSee(role, ["board", "reviewer", "applicant"])
                ? change.decision.invalidated_review_ids
                : [],
              conditions: change.decision.conditions,
              note: change.decision.note,
              at: change.decision.at,
            }
          : null,
      };
    }),
    releases: proposal.release_ids.map((rid) => state.releases.get(rid)).filter(Boolean).map((r) => ({
      release_id: r.release_id,
      version: r.version,
      artifact_ref: canSee(role, ["board", "reviewer", "applicant"]) ? r.artifact_ref : null,
      based_on_change_ids: r.based_on_change_ids,
      release_notes: r.release_notes,
      at: r.at,
    })),
  };
}

/** 开放数据视图：只呈现已上线版本面向公众的内容；任何评审内部信息都不出现。 */
export function publicReleaseView(state, releaseId) {
  const release = state.releases.get(releaseId);
  if (!release) return null;
  const proposal = state.proposals.get(release.proposal_id);
  const thesis = state.theses.get(proposal?.thesis_id);
  const proto = proposal?.prototypes.find((p) => p.version === release.prototype_version) ?? latestPrototype(proposal);
  const assetById = new Map([...state.assets.values()].map((a) => [a.asset_id, a]));

  return {
    release_id: release.release_id,
    version: release.version,
    release_notes: release.release_notes,
    title: proposal?.title ?? null,
    cultural_claim: thesis?.cultural_claim ?? null,
    scenes:
      proto?.scenes.map((scene) => ({
        title: scene.title,
        claim: scene.claim,
        sources: scene.asset_citations.map((c) => {
          const asset = assetById.get(c.asset_id);
          return {
            // 公众侧只给文献引注与使用说明，不给馆藏机构/联系人。
            kind: asset?.kind ?? null,
            citation: asset?.citation ?? null,
            locator: c.locator,
            usage: c.usage,
            certainty: c.certainty ?? null,
          };
        }),
        ai_assisted: scene.ai_assisted ?? false,
      })) ?? [],
    notice: "本页论证均来自经学术审读的研究素材；开放后的匿名互动数据仅用于改进体验，不作为历史事实或学术证据。",
  };
}

/**
 * 单条事件的角色脱敏（事件日志接口用）。
 * 传入投影 state 与 ownerOrg 时，applicant 的商业字段仅限本机构 lead_org 相符的方案。
 */
export function redactEvent(event, { role = "public", state = null, ownerOrg = null } = {}) {
  const clone = structuredClone(event);
  if (role === "board") return clone;

  const ownedProposals = new Set();
  const ownedAssets = new Set();
  if (state && role === "applicant" && ownerOrg) {
    for (const proposal of state.proposals.values()) {
      if (proposal.lead_org !== ownerOrg) continue;
      ownedProposals.add(proposal.proposal_id);
    }
    // 素材通过许可记录与方案关联：为本机构方案清过许可的素材，其机构字段可见。
    for (const asset of state.assets.values()) {
      if (asset.clearances.some((c) => ownedProposals.has(c.proposal_id))) ownedAssets.add(asset.asset_id);
    }
  }
  const isOwn = (p) => role === "applicant" && Boolean(ownerOrg) && ownedProposals.has(p?.proposal_id);
  const isOwnAsset = (p) => role === "applicant" && Boolean(ownerOrg) && ownedAssets.has(p?.asset_id);

  if (clone.actor) {
    clone.actor = { id: role === "reviewer" ? clone.actor.id : "redacted", role: clone.actor.role };
    if (role !== "reviewer") delete clone.actor.display_name;
    delete clone.actor.org;
  }
  const p = clone.payload;
  if (!p) return clone;
  if ("custodian_contact" in p) p.custodian_contact = null;
  if ("holding_institution" in p && !(role === "reviewer" || isOwnAsset(p))) {
    p.holding_institution = null;
  }
  if ("reviewer_org" in p && !(role === "reviewer" || isOwn(p))) p.reviewer_org = null;
  if ("reviewer_display_name" in p && role !== "reviewer") p.reviewer_display_name = null;
  if ("total_amount" in p && !isOwn(p)) p.total_amount = null;
  if (Array.isArray(p.milestones)) {
    p.milestones = p.milestones.map((m) => (isOwn(p) ? m : { ...m, amount: null }));
  }
  if ("supplier_id" in p && !isOwn(p)) p.supplier_id = null;
  if ("qualification_evidence_ref" in p && !isOwn(p)) p.qualification_evidence_ref = null;
  return clone;
}

/** 匿名信号的聚合视图（改进体验用）；永远不回放原文给非办公室角色。 */
export function signalSummary(state, releaseId, { role = "board" } = {}) {
  const signals = state.signals.filter((s) => s.release_id === releaseId);
  const byKind = {};
  for (const s of signals) byKind[s.signal_kind] = (byKind[s.signal_kind] ?? 0) + 1;
  return {
    release_id: releaseId,
    total: signals.length,
    by_kind: byKind,
    permitted_use: "experience_improvement",
    samples: role === "board" ? signals.slice(-20).map((s) => ({ kind: s.signal_kind, text: s.summary_text })) : undefined,
  };
}
