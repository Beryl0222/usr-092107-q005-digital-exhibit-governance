import assert from "node:assert/strict";
import test from "node:test";

import { GovernancePlatform, GateError } from "../src/app.js";
import { buildScenario, completeReviewAndRelease } from "../src/scenario.js";

const A = { id: "u1", role: "applicant" };
const R = { id: "r1", role: "reviewer" };
const B = { id: "b1", role: "board" };

/**
 * 可逐步组装的最小合格方案：每一步都可单独省略以验证对应门禁。
 */
function minimalReady() {
  const pf = new GovernancePlatform();
  const ctx = { pf };

  ctx.thesis = () => pf.submitThesis({
    thesis_id: "t", title: "命题", cultural_claim: "独有的文化命题表述",
    keywords: ["中轴线"], actor: A,
  });
  ctx.proposal = (channels = ["onsite"], venues = ["CN-BJ"]) => pf.createProposal({
    proposal_id: "p", thesis_id: "t", title: "方案", channels, venues, actor: A,
  });
  ctx.asset = () => pf.registerAsset({
    asset_id: "a1", kind: "archaeological_survey", title: "实测图",
    citation: "考古研究院测绘报告 图版 1", holding_institution: "考古院", actor: A,
  });
  ctx.clear = (scope = { channels: ["onsite"], territories: ["CN"] }) => pf.clearSource({
    asset_id: "a1", proposal_id: "p", scope, cleared: true, license_document_ref: "LIC-1", actor: R,
  });
  ctx.prototype = () => pf.submitPrototype({
    proposal_id: "p", prototype_version: 1,
    demo_scenes: [{
      scene_id: "s1", title: "片段", claim: "基于实测图的论证",
      asset_citations: [{ asset_id: "a1", locator: "图版 1", usage: "尺度", certainty: "measured" }],
    }],
    actor: A,
  });
  ctx.component = () => pf.declareComponent({
    proposal_id: "p", name: "自研组件", is_reuse: false,
    origin: { source_type: "market_new" }, actor: A,
  });
  ctx.budget = () => pf.setBudget({
    proposal_id: "p", currency: "CNY", total_amount: 100,
    milestones: [{ milestone_id: "m1", name: "交付", amount: 100, due_date: "2027-01-01", stage_gate: "go_live" }],
    actor: A,
  });
  ctx.a11y = () => pf.reviewAccessibility({
    proposal_id: "p", review_id: "acc1", result: "pass", scope_sections: ["s1"], actor: R,
  });
  ctx.scholar = () => pf.recordScholarReview({
    proposal_id: "p", review_id: "rev1", verdict: "endorse", opinion: "有据",
    scope_sections: ["s1"], reviewer_id: "r1", actor: R,
  });
  ctx.channel = (channel = "onsite", extra = {}) => pf.checkChannel({
    proposal_id: "p", channel, status: "cleared", scope: { territories: ["CN"] }, actor: R, ...extra,
  });
  ctx.all = () => {
    ctx.thesis(); ctx.proposal(); ctx.asset(); ctx.clear(); ctx.prototype();
    ctx.component(); ctx.budget(); ctx.a11y(); ctx.scholar(); ctx.channel();
    return ctx;
  };
  return ctx;
}

test("首要门禁：没有独有文化命题不能立项；命题撤回后不能建新方案", () => {
  const pf = new GovernancePlatform();
  assert.throws(
    () => pf.createProposal({ proposal_id: "p", thesis_id: "missing", title: "x", channels: ["onsite"], actor: A }),
    /命题不存在/,
  );

  pf.submitThesis({ thesis_id: "t", title: "命题", cultural_claim: "独有命题", actor: A });
  pf.withdrawThesis("t", { reason: "放弃", actor: A });
  assert.throws(
    () => pf.createProposal({ proposal_id: "p2", thesis_id: "t", title: "x", channels: ["onsite"], actor: A }),
    /已撤回/,
  );
});

test("缺原型：评审无法从演示下钻出处 → 阻断", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal(); ctx.asset(); ctx.clear();
  const { blockers } = ctx.pf.gateReport("p");
  assert.ok(blockers.some((b) => b.includes("尚未提交交互原型")));
});

test("素材许可不覆盖实际渠道 → 阻断，并指明片段与素材", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal(["onsite", "online"]); ctx.asset();
  ctx.clear({ channels: ["onsite"], territories: ["CN"] }); // 未覆盖 online
  ctx.prototype();
  const { blockers } = ctx.pf.gateReport("p");
  assert.ok(blockers.some((b) => b.includes("缺少渠道 online 的有效许可")), blockers.join("\n"));
});

test("许可到期不再放行", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal(); ctx.asset();
  ctx.clear({ channels: ["onsite"], territories: ["CN"], expires_at: "2020-01-01T00:00:00Z" });
  ctx.prototype();
  assert.ok(ctx.pf.gateReport("p").blockers.some((b) => b.includes("有效许可")));
});

test("引用未登记素材 → 阻断", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal();
  assert.throws(() => ctx.prototype(), /未登记素材/);
});

test("复用组件未披露来源或修改 → 登记即被拒绝", () => {
  const ctx = minimalReady();
  ctx.all();
  assert.throws(
    () => ctx.pf.declareComponent({ proposal_id: "p", name: "成熟套件", is_reuse: true, actor: A }),
    { name: "ValidationError" },
  );
});

test("预算里程碑金额合计与总额不一致 → 阻断", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal(); ctx.asset(); ctx.clear(); ctx.prototype();
  ctx.component();
  ctx.pf.setBudget({
    proposal_id: "p", currency: "CNY", total_amount: 100,
    milestones: [{ milestone_id: "m1", name: "x", amount: 90, due_date: "2027-01-01" }], actor: A,
  });
  assert.ok(ctx.pf.gateReport("p").blockers.some((b) => b.includes("金额合计")));
});

test("学术审读缺失 / 要求修改 / 否定分别阻断", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal(); ctx.asset(); ctx.clear(); ctx.prototype();
  ctx.component(); ctx.budget(); ctx.a11y(); ctx.channel();
  assert.ok(ctx.pf.gateReport("p").blockers.some((b) => b.includes("学术审读覆盖")));

  ctx.pf.recordScholarReview({ proposal_id: "p", review_id: "rv", verdict: "revise", opinion: "要改", scope_sections: ["s1"], actor: R });
  assert.ok(ctx.pf.gateReport("p").blockers.some((b) => b.includes("要求修改后重审")));

  // reject 用全新的合格方案验证（revise 与 reject 同时存在时按更严结论阻断）。
  const ctx2 = minimalReady();
  ctx2.all();
  ctx2.pf.recordScholarReview({ proposal_id: "p", review_id: "rev2", verdict: "reject", opinion: "不成立", scope_sections: ["s1"], actor: R });
  // rev2 与 rev1 同时覆盖 s1：存在 reject 即阻断。
  assert.ok(ctx2.pf.gateReport("p").blockers.some((b) => b.includes("被学术审读否定")));
});

test("无障碍评估 fail 阻断；片段无覆盖阻断", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal(); ctx.asset(); ctx.clear(); ctx.prototype();
  ctx.component(); ctx.budget(); ctx.scholar(); ctx.channel();
  ctx.pf.reviewAccessibility({ proposal_id: "p", review_id: "acc", result: "fail", scope_sections: ["s1"], actor: R });
  assert.ok(ctx.pf.gateReport("p").blockers.some((b) => b.includes("不通过")));
});

test("海外巡展：境外场所超出授权地域 → 阻断", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal(["onsite", "overseas_tour"], ["CN-BJ", "FR-PAR", "US-NYC"]);
  ctx.asset(); ctx.clear({ channels: ["onsite", "overseas_tour"], territories: ["CN", "FR", "US"] });
  ctx.prototype(); ctx.component(); ctx.budget(); ctx.a11y(); ctx.scholar();
  ctx.channel("onsite", { scope: { territories: ["CN"] } });
  ctx.pf.checkChannel({
    proposal_id: "p", channel: "overseas_tour", status: "cleared",
    scope: { territories: ["FR"] }, // 未授权 US
    actor: R,
  });
  assert.ok(ctx.pf.gateReport("p").blockers.some((b) => b.includes("US-NYC") && b.includes("海外授权范围")));
});

test("原址叠加与 AI：未人工复核不能放行", () => {
  const ctx = minimalReady();
  ctx.thesis(); ctx.proposal(["onsite", "on_site_overlay"], ["CN-BJ"]);
  ctx.asset(); ctx.clear({ channels: ["onsite", "on_site_overlay"], territories: ["CN"] });
  ctx.prototype(); ctx.component(); ctx.budget(); ctx.a11y(); ctx.scholar();
  ctx.channel("onsite", { scope: { territories: ["CN"] } });
  // 直接登记 cleared 且不附人工复核 → 命令层拒绝。
  assert.throws(
    () => ctx.pf.checkChannel({ proposal_id: "p", channel: "on_site_overlay", status: "cleared", scope: { territories: ["CN"] }, actor: R }),
    /必须经过人工复核/,
  );
  // pending 状态同样阻断门禁。
  ctx.pf.checkChannel({ proposal_id: "p", channel: "on_site_overlay", status: "pending_human_review", scope: {}, actor: R });
  assert.ok(ctx.pf.gateReport("p").blockers.some((b) => b.includes("等待人工复核")));
});

test("AI 片段未逐段人工核实 → 阻断；未披露模型来源 → 阻断", () => {
  const pf = new GovernancePlatform();
  pf.submitThesis({ thesis_id: "t", title: "命题", cultural_claim: "独有命题", actor: A });
  pf.createProposal({ proposal_id: "p", thesis_id: "t", title: "方案", channels: ["onsite", "ai_generated"], venues: ["CN-BJ"], actor: A });
  pf.registerAsset({ asset_id: "a1", kind: "sound_recording", title: "测音", citation: "测音报告", actor: A });
  pf.clearSource({ asset_id: "a1", proposal_id: "p", cleared: true, scope: { channels: ["onsite", "ai_generated"] }, actor: R });
  pf.submitPrototype({
    proposal_id: "p", prototype_version: 1,
    demo_scenes: [{
      scene_id: "s1", title: "片段", claim: "论证", ai_assisted: true,
      asset_citations: [{ asset_id: "a1", locator: "B07", usage: "音色" }],
    }],
    actor: A,
  });
  pf.declareComponent({ proposal_id: "p", name: "x", is_reuse: false, origin: { source_type: "market_new" }, actor: A });
  pf.setBudget({ proposal_id: "p", currency: "CNY", total_amount: 1, milestones: [{ milestone_id: "m", name: "x", amount: 1, due_date: "2027-01-01" }], actor: A });
  pf.reviewAccessibility({ proposal_id: "p", review_id: "acc", result: "pass", scope_sections: ["s1"], actor: R });
  pf.recordScholarReview({ proposal_id: "p", review_id: "rev", verdict: "endorse", opinion: "可", scope_sections: ["s1"], actor: R });
  pf.checkChannel({ proposal_id: "p", channel: "onsite", status: "cleared", scope: { territories: ["CN"] }, actor: R });
  pf.checkChannel({
    proposal_id: "p", channel: "ai_generated", status: "cleared", human_reviewed: true, human_reviewer_id: "r1",
    ai_output_disclosure: { human_verified_sections: [] }, actor: R,
  });
  const blockers = pf.gateReport("p").blockers;
  assert.ok(blockers.some((b) => b.includes("未经逐段人工核实")), blockers.join("\n"));
  assert.ok(blockers.some((b) => b.includes("披露模型来源")));
});

test("阶段顺序不可跳过；批准不可原地改写", () => {
  const ctx = minimalReady();
  ctx.all();
  assert.throws(() => ctx.pf.approveStage({ proposal_id: "p", stage: "go_live", decision: "approved", actor: B }), GateError);
  ctx.pf.approveStage({ proposal_id: "p", stage: "acceptance", decision: "approved", actor: B });
  assert.throws(() => ctx.pf.approveStage({ proposal_id: "p", stage: "acceptance", decision: "approved", actor: B }), GateError);
});

test("完整材料在未批准 go_live 前不能上线", () => {
  const ctx = minimalReady();
  ctx.all();
  assert.throws(() => ctx.pf.releaseVersion({ proposal_id: "p", release_id: "r", version: "1.0.0", artifact_ref: "ref", actor: B }), GateError);
});

test("完整场景门禁通过并可上线", () => {
  const pf = new GovernancePlatform();
  buildScenario(pf, { full: false });
  const blockersBefore = pf.gateReport("proposal-bell-drum").blockers;
  assert.ok(blockersBefore.some((b) => b.includes("等待人工复核")));
  assert.ok(blockersBefore.some((b) => b.includes("尚未人工裁定")));
  const out = { similarityReportId: pf.state.proposals.get("proposal-bell-drum").similarity_report_ids.at(-1) };
  completeReviewAndRelease(pf, out);
  assert.deepEqual(pf.gateReport("proposal-bell-drum").blockers, []);
});
