/**
 * 读模型投影：把一个方案的事件流折叠为"决策链"当前状态。
 *
 * 纯函数，不写存储。输出用于：
 *  - 决策链门禁看板（哪个门禁缺什么、哪种变更重开了哪一段）；
 *  - 从演示（原型断言）下钻到素材登记、许可与学术审读；
 *  - 上线门禁判断与发布快照。
 */

import { GATE_ORDER } from "./contracts.js";
import { requiredSpecialKinds } from "./policies/special-review.js";
import { checkClaimProvenance } from "./policies/interaction.js";

function indexAssets(events) {
  const index = new Map();
  for (const e of events) {
    if (e.event_type === "SOURCE_REGISTERED") {
      const id = e.payload?.asset_id ?? e.aggregate_id;
      const prev = index.get(id) ?? {};
      index.set(id, { ...prev, registration: e });
    }
    if (e.event_type === "SOURCE_CLEARED") {
      const id = e.payload?.asset_id ?? e.aggregate_id;
      const prev = index.get(id) ?? {};
      // 许可更正以追加后继记录方式出现，取最新一条，并保留历史。
      index.set(id, { ...prev, clearance: e, clearanceHistory: [...(prev.clearanceHistory ?? []), e] });
    }
  }
  return index;
}

/**
 * @param {string} proposalId
 * @param {object[]} events 该方案决策链事件（按追加顺序）
 * @param {object} [registries]
 * @param {object[]} [registries.components] 全局 COMPONENT_REGISTERED 事件
 */
export function projectProposal(proposalId, events, registries = {}) {
  const ordered = [...events].sort((a, b) =>
    (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));

  const thesis = { current: null, history: [] };
  const assets = indexAssets(ordered);
  const academicReviews = [];
  const prototypes = new Map();
  const componentDeclarations = [];
  const componentRegistry = new Map();
  for (const c of registries.components ?? []) {
    componentRegistry.set(c.payload?.component_id, c);
  }
  let budget = null;
  const accessibility = [];
  const similarityFlags = [];
  const specialByKind = new Map();
  const changes = new Map();
  const releases = [];
  const interactions = [];
  const interactionViolations = [];
  let proposal = null;

  // 门禁状态：decision 为最近一次人工裁定；若之后被变更重开则置 pending。
  const gates = new Map();
  for (const gate of GATE_ORDER) {
    gates.set(gate, { gate, state: "not_started", decision: null, reopenedBy: [], readiness: {}, blockers: [] });
  }

  for (const e of ordered) {
    const p = e.payload ?? {};
    switch (e.event_type) {
      case "PROPOSAL_CREATED":
        proposal = e;
        break;
      case "THESIS_SUBMITTED":
      case "THESIS_REVISED":
        thesis.history.push(e);
        thesis.current = e;
        break;
      case "ACADEMIC_REVIEW_RECORDED":
        academicReviews.push(e);
        break;
      case "PROTOTYPE_SUBMITTED": {
        const prev = prototypes.get(p.prototype_id) ?? { history: [] };
        prototypes.set(p.prototype_id, { current: e, history: [...prev.history, e] });
        break;
      }
      case "COMPONENT_DECLARED":
        componentDeclarations.push(e);
        break;
      case "BUDGET_MILESTONE_SET":
        budget = e;
        break;
      case "ACCESSIBILITY_ASSESSED":
        accessibility.push(e);
        break;
      case "SIMILARITY_FLAGGED":
        similarityFlags.push({ flag: e, adjudicatedBy: [] });
        break;
      case "SPECIAL_REVIEW_CLEARED":
        specialByKind.set(p.review_kind, e);
        break;
      case "REVIEW_DECIDED": {
        const gate = gates.get(p.gate);
        gate.decision = e;
        gate.state = p.verdict === "approved" ? "approved"
          : p.verdict === "conditional" ? "conditional" : "rejected";
        // 若该决定是对某条雷同提示的人工裁定，回填。
        if (p.adjudicates_event_id) {
          const found = similarityFlags.find((s) => s.flag.event_id === p.adjudicates_event_id);
          if (found) found.adjudicatedBy.push(e);
        }
        break;
      }
      case "CHANGE_REQUESTED":
        changes.set(e.aggregate_id, { request: e, review: null });
        break;
      case "CHANGE_REVIEWED": {
        const rec = changes.get(p.change_request_id) ?? { request: null, review: null };
        rec.review = e;
        changes.set(p.change_request_id, rec);
        for (const gateName of p.reopened_gates ?? []) {
          const gate = gates.get(gateName);
          if (gate) {
            gate.state = "reopened_pending";
            gate.reopenedBy.push(p.change_request_id);
            // 重开后旧决定对受影响部分失效，但 carried_reviews 中的学术意见仍然有效。
          }
        }
        break;
      }
      case "VERSION_RELEASED":
        releases.push(e);
        break;
      case "VERSION_WITHDRAWN":
        releases.push({ ...e, _withdrawn: true });
        break;
      case "INTERACTION_CAPTURED":
        interactions.push(e);
        break;
      case "INTERACTION_PURPOSE_VIOLATION_DETECTED":
        interactionViolations.push(e);
        break;
      default:
        break;
    }
  }

  // 计算各门禁就绪度与阻塞原因（面向项目组：明确告诉他们还缺什么）。
  evaluateReadiness({
    gates, thesis, assets, academicReviews, prototypes, componentDeclarations,
    componentRegistry, budget, accessibility, similarityFlags, specialByKind, proposal,
  });

  const activeReleases = releases.filter((r) => !r._withdrawn && r.event_type === "VERSION_RELEASED");

  return {
    proposal_id: proposalId,
    proposal,
    thesis,
    assets,
    academicReviews,
    prototypes,
    componentDeclarations,
    componentRegistry,
    budget,
    accessibility,
    similarityFlags,
    specialByKind,
    gates,
    changes,
    releases,
    activeReleases,
    interactions,
    interactionViolations,
    ordered,
    releaseReady: computeReleaseReadiness(gates),
    drilldown: buildDrilldown(proposalId, prototypes, assets, academicReviews),
  };
}

function evaluateReadiness(ctx) {
  const {
    gates, thesis, assets, academicReviews, prototypes, componentDeclarations,
    componentRegistry, budget, accessibility, similarityFlags, specialByKind, proposal,
  } = ctx;

  const setBlockers = (name, blockers, readiness) => {
    const gate = gates.get(name);
    gate.blockers = blockers;
    gate.readiness = readiness;
    if (gate.state === "not_started") {
      gate.state = blockers.length === 0 ? "awaiting_review" : "in_progress";
    }
  };

  // thesis
  setBlockers("thesis", thesis.current ? [] : ["尚未提交策展命题（无独有文化命题不得进入评审）"], {
    has_thesis: Boolean(thesis.current),
  });

  // source：每个登记素材都需有许可；海外/原址/AIGC 需人工复核
  const assetList = [...assets.values()];
  const sourceBlockers = [];
  if (assetList.length === 0) sourceBlockers.push("尚未登记任何研究素材（考古测绘/建筑图档/声音采集/学术资料）");
  for (const a of assetList) {
    const id = a.registration?.payload?.asset_id ?? a.registration?.aggregate_id;
    if (!a.clearance) sourceBlockers.push(`素材「${a.registration?.payload?.title ?? id}」尚未取得许可`);
    const c = a.clearance?.payload;
    if (c && c.license_scope !== "domestic" && c.human_reviewed !== true) {
      sourceBlockers.push(`素材「${a.registration?.payload?.title ?? id}」海外/原址许可缺少人工复核`);
    }
    if (c && c.ai_generated === true && c.human_reviewed !== true) {
      sourceBlockers.push(`AI 生成素材「${a.registration?.payload?.title ?? id}」缺少人工复核`);
    }
  }
  setBlockers("source", sourceBlockers, { assets: assetList.length, cleared: assetList.filter((a) => a.clearance).length });

  // academic：命题与原型都需有审读，且无未处理 reject
  const rejecting = academicReviews.filter((r) => r.payload?.verdict === "reject");
  const acadBlockers = [];
  if (academicReviews.length === 0) acadBlockers.push("尚无学术审读意见");
  if (rejecting.length > 0) acadBlockers.push(`存在 ${rejecting.length} 条否决性学术审读未解决`);
  setBlockers("academic", acadBlockers, { reviews: academicReviews.length, rejects: rejecting.length });

  // prototype：每个原型史实断言证据链必须可溯源
  // provenance 校验需要的是素材登记事件（携带 content_hash），故把索引收敛为 id→registration。
  const assetRegistrations = new Map(
    [...assets].map(([id, entry]) => [id, entry.registration]),
  );
  const protoBlockers = [];
  let claimCount = 0;
  for (const { current } of prototypes.values()) {
    const claims = current?.payload?.claims ?? [];
    claimCount += claims.length;
    const report = checkClaimProvenance(claims, assetRegistrations);
    for (const item of report) for (const err of item.errors) protoBlockers.push(`原型 ${current.payload.prototype_id} 断言 ${item.claim_id}：${err}`);
  }
  if (prototypes.size === 0) protoBlockers.push("尚未提交交互原型/演示包");
  setBlockers("prototype", protoBlockers, { prototypes: prototypes.size, claims: claimCount });

  // components：复用须披露来源与修改
  const compBlockers = [];
  if (componentDeclarations.length === 0) compBlockers.push("尚未登记并披露任何供应商组件");
  for (const d of componentDeclarations) {
    const p = d.payload;
    const registered = componentRegistry.get(p.component_id);
    if (p.reuse === true && (!p.origin_disclosure || String(p.origin_disclosure).trim() === "")) {
      compBlockers.push(`组件 ${p.component_id} 复用但未披露来源`);
    }
    if (p.modified === true && !(p.modifications?.length > 0)) {
      compBlockers.push(`复用组件 ${p.component_id} 有修改但未逐项披露`);
    }
    if (!registered) compBlockers.push(`组件 ${p.component_id} 未在组件库登记`);
  }
  setBlockers("components", compBlockers, { declared: componentDeclarations.length });

  // budget
  setBlockers("budget", budget ? [] : ["尚未设定预算与里程碑"], {
    milestones: budget?.payload?.milestones?.length ?? 0,
  });

  // accessibility
  const latestAccess = accessibility[accessibility.length - 1];
  const accessBlockers = [];
  if (!latestAccess) accessBlockers.push("尚未进行无障碍评估");
  else if (latestAccess.payload.result === "fail") accessBlockers.push("无障碍评估不通过");
  else if (latestAccess.payload.result === "conditional" && latestAccess.payload.reassessment_required) {
    accessBlockers.push("无障碍附条件通过，需整改后重评");
  }
  setBlockers("accessibility", accessBlockers, {
    result: latestAccess?.payload?.result ?? null,
  });

  // similarity：所有提示必须经人工裁定（系统不自动判抄）
  const unadjudicated = similarityFlags.filter((s) => s.adjudicatedBy.length === 0);
  const simBlockers = unadjudicated.map((s) => `雷同提示 ${s.flag.event_id} 尚待人工裁定（系统不自动判定抄袭）`);
  setBlockers("similarity", simBlockers, {
    flagged: similarityFlags.length,
    adjudicated: similarityFlags.length - unadjudicated.length,
  });

  // special：按方案声明核对海外巡展/原址叠加/AIGC
  const requiredKinds = requiredSpecialKinds(proposal?.payload);
  const specialBlockers = [];
  for (const kind of requiredKinds) {
    const clearance = specialByKind.get(kind);
    if (!clearance) specialBlockers.push(`缺少特殊核对：${kind}`);
    else if (clearance.payload.verdict === "rejected") specialBlockers.push(`特殊核对被驳回：${kind}`);
    else if (clearance.payload.human_reviewed !== true) specialBlockers.push(`${kind} 缺少人工复核`);
  }
  setBlockers("special", specialBlockers, { required: requiredKinds, cleared: requiredKinds.filter((k) => specialByKind.get(k)).length });

  // approval 由最终评审会决定；就绪度看前序门禁是否都已通过
  const prior = GATE_ORDER.slice(0, -1);
  const pendingPrior = prior.filter((name) => {
    const g = gates.get(name);
    return g.state !== "approved";
  });
  setBlockers("approval", pendingPrior.map((name) => `前序门禁未通过：${name}`), {
    priorApproved: prior.length - pendingPrior.length,
    priorTotal: prior.length,
  });
}

function computeReleaseReadiness(gates) {
  const notApproved = [];
  for (const name of GATE_ORDER) {
    const g = gates.get(name);
    if (g.state !== "approved") {
      notApproved.push({ gate: name, state: g.state, blockers: g.blockers });
    }
  }
  return {
    ready: notApproved.length === 0,
    notApproved,
  };
}

/**
 * 演示下钻：原型 → 每条断言 → 每条证据 → 素材登记/许可指纹/相关学术审读。
 * 评审人员在演示里看到一个论断，即可一路查到测绘图档与审读意见。
 */
function buildDrilldown(proposalId, prototypes, assets, academicReviews) {
  const result = [];
  for (const { current } of prototypes.values()) {
    const p = current.payload;
    const claims = [];
    for (const claim of p.claims ?? []) {
      const evidence = [];
      for (const ev of claim.evidence ?? []) {
        const ref = ev.asset_id ?? ev.ref;
        const asset = assets.get(ref);
        const reviews = academicReviews.filter(
          (r) => r.payload?.target_ref === ref || r.payload?.target_ref === claim.claim_id,
        );
        evidence.push({
          ref,
          locator: ev.locator ?? null,
          claimed_hash: ev.content_hash ?? null,
          registered: asset?.registration ? {
            event_id: asset.registration.event_id,
            kind: asset.registration.payload.asset_kind,
            title: asset.registration.payload.title,
            custodian: asset.registration.payload.custodian,
            content_hash: asset.registration.payload.content_hash,
            hash_match: ev.content_hash ? ev.content_hash === asset.registration.payload.content_hash : null,
          } : null,
          clearance: asset?.clearance ? {
            event_id: asset.clearance.event_id,
            license_scope: asset.clearance.payload.license_scope,
            ai_generated: asset.clearance.payload.ai_generated,
            human_reviewed: asset.clearance.payload.human_reviewed,
          } : null,
          academic_reviews: reviews.map((r) => ({
            event_id: r.event_id,
            verdict: r.payload.verdict,
            reviewer_expertise: r.payload.reviewer?.expertise,
            notes: r.payload.notes,
          })),
        });
      }
      claims.push({ claim_id: claim.claim_id, statement: claim.statement, historical: claim.historical !== false, evidence });
    }
    result.push({ prototype_id: p.prototype_id, demo_ref: p.demo_ref, claims });
  }
  return result;
}
