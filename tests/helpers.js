/** 测试辅助：构造一个满足全部门禁、可直接上线的方案，并可按需改写。 */

import { Platform } from "../src/platform.js";

export function makePlatform() {
  let tick = 0;
  const base = Date.parse("2026-09-20T09:00:00+08:00");
  const now = () => new Date(base + tick++ * 1000).toISOString();
  return new Platform({ now });
}

/**
 * 提交命题→素材/许可→学术审读→原型证据链→组件披露→预算→无障碍，
 * 再逐关通过评审。返回 { pf, P, ids, flagEvent? }。
 */
export function buildReadyProposal(pf, P = "PROP-T-001", opts = {}) {
  const flags = opts.flags ?? {};
  pf.submitThesis({
    proposal_id: P,
    title: opts.title ?? "测试命题",
    proposition: opts.proposition ?? "独有文化命题：以某制度组织城市生活的体验线索。",
    core_questions: ["问题一"],
    keywords: opts.keywords ?? ["中轴线"],
    proposer: { name: "申报人甲", organization: "某机构", contact: "a@example.org" },
  });
  const thesisId = pf.getProposal(P).thesis.current.event_id;
  pf.createProposal({ proposal_id: P, title: opts.title ?? "测试命题", thesis_event_id: thesisId, flags });

  pf.registerAsset({ asset_id: "A1", proposal_id: P, asset_kind: "archaeological_survey", title: "测绘图", custodian: "考古院", content_hash: "sha256:h1" });
  const assetScope = flags.site_superposition ? "site_superposition"
    : flags.overseas_tour ? "overseas_tour" : "domestic";
  pf.clearAsset({ asset_id: "A1", proposal_id: P, license_scope: assetScope, human_reviewed: true, human_reviewer_ids: ["r1"], terms_summary: "许可" });

  pf.recordAcademicReview({ proposal_id: P, target_kind: "thesis", target_ref: P, reviewer: { name: "专家", organization: "高校", expertise: "古建" }, verdict: "pass", claims_reviewed: ["命题"], notes: "成立" });
  pf.recordAcademicReview({ proposal_id: P, target_kind: "asset", target_ref: "A1", reviewer: { name: "专家", organization: "考古院", expertise: "考古测绘" }, verdict: "pass", claims_reviewed: ["测绘尺度"], notes: "与实物一致" });

  pf.submitPrototype({
    proposal_id: P, prototype_id: "proto-1", demo_ref: "artifact://demo",
    claims: [{ claim_id: "c1", statement: "某尺度为明代遗存", historical: true, evidence: [{ asset_id: "A1", content_hash: "sha256:h1" }] }],
  });

  pf.registerComponent({ component_id: "C1", name: "引擎", maturity: "mature", origin_ref: "repo/x", supplier: { name: "供应商", contact: "s@example.org" } });
  pf.declareComponent({ proposal_id: P, component_id: "C1", reuse: true, modified: false, modifications: [], origin_disclosure: "来自开源仓库 x，未修改" });

  pf.setBudget({ proposal_id: P, currency: "CNY", total_amount: 1000, milestones: [{ name: "上线", amount: 1000 }] });
  pf.assessAccessibility({ proposal_id: P, standard: "GB", result: "pass", findings: [] });

  const ctx = { pf, P, ids: { thesis: thesisId, asset: "A1", prototype: "proto-1", component: "C1" } };

  if (flags.overseas_tour || flags.site_superposition || flags.ai_generated) {
    addSpecialClearances(pf, P, flags);
  }

  for (const gate of ["thesis", "source", "academic", "prototype", "components", "budget", "accessibility", "similarity", "special", "approval"]) {
    pf.decideGate({ proposal_id: P, gate, verdict: "approved", reviewer_ids: ["panel"], note: "通过" });
  }
  return ctx;
}

export function addSpecialClearances(pf, P, flags) {
  if (flags.site_superposition) {
    pf.recordSpecialClearance({
      proposal_id: P, review_kind: "site_superposition", human_reviewer: { id: "r", name: "复核" },
      usage_scope: { sites: ["点位1"], constraints: ["最小干预"], until: "2027-12-31" },
      verdict: "cleared", scopeCtx: { sites: ["点位1"], asset_ids: ["A1"] },
    });
  }
  if (flags.overseas_tour) {
    pf.recordSpecialClearance({
      proposal_id: P, review_kind: "overseas_tour", human_reviewer: { id: "r", name: "复核" },
      usage_scope: { territories: ["新加坡"], venues: ["博物馆"], until: "2027-12-31" },
      verdict: "cleared", scopeCtx: { territories: ["新加坡"], venues: ["博物馆"], asset_ids: ["A1"] },
    });
  }
  if (flags.ai_generated) {
    pf.recordSpecialClearance({
      proposal_id: P, review_kind: "ai_generated_content", human_reviewer: { id: "r", name: "复核" },
      usage_scope: { allowed_as_historical: false, labeling_required: true, human_checkpoints: ["审读"] },
      verdict: "cleared",
    });
  }
}
