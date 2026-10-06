import assert from "node:assert/strict";
import test from "node:test";

import { GovernancePlatform } from "../src/app.js";
import { buildScenario, buildEquipmentChange, BOARD } from "../src/scenario.js";
import { textSimilarity } from "../src/similarity.js";
import { proposalTrace, publicReleaseView, redactEvent, signalSummary } from "../src/views.js";

test("相似性：中文命题文本可计算，明显雷同高于独立命题", () => {
  assert.ok(textSimilarity("晨钟暮鼓：中轴线的时间秩序", "晨钟暮鼓：中轴线上的时间秩序") > 0.5);
  assert.ok(textSimilarity("晨钟暮鼓：中轴线的时间秩序", "完全不同的园林水体主题") < 0.3);
});

test("雷同只产生 advisory 提示，未人工裁定前阻断放行；系统不产出抄袭结论", () => {
  const pf = new GovernancePlatform();
  const out = buildScenario(pf, { full: false });
  const report = pf.state.reports.get(out.similarityReportId);
  assert.equal(report.advisory_only, true);
  // 事件链里不存在任何由系统写入的"抄袭"判定字段。
  assert.ok(!("plagiarism" in report));
  assert.ok(pf.gateReport("proposal-bell-drum").blockers.some((b) => b.includes("尚未人工裁定")));

  // 人工裁定升级为抄袭关切 → 阻断；再改判不可能（裁定不可改写），只能走新报告。
  pf.checkChannel({
    proposal_id: "proposal-bell-drum", channel: "on_site_overlay", status: "pending_human_review",
    scope: {}, actor: { id: "r", role: "reviewer" },
  });
  pf.adjudicateSimilarity({
    report_id: out.similarityReportId, disposition: "plagiarism_concern_escalated",
    rationale: "证据链也高度重合，升级复核", adjudicator_id: "r1", actor: { id: "r1", role: "reviewer" },
  });
  assert.ok(pf.gateReport("proposal-bell-drum").blockers.some((b) => b.includes("抄袭关切")));
  assert.throws(() => pf.adjudicateSimilarity({
    report_id: out.similarityReportId, disposition: "distinct", rationale: "改主意", actor: { id: "r1", role: "reviewer" },
  }), /已人工裁定/);
});

test("匿名观众信号：服务端强制用途与匿名性，且不进入任何证据链", () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  const sig = pf.recordVisitorSignal({ release_id: "rel-1-0-0", signal_kind: "rating", summary_text: "5 星" });
  assert.equal(sig.payload.permitted_use, "experience_improvement");
  assert.equal(sig.payload.anonymous, true);
  assert.equal(sig.actor.role, "anonymous");

  // 即便调用方伪造用途，服务端也不会接受其他取值（校验拒绝）。
  assert.throws(() => pf.store.append({
    event_type: "VISITOR_SIGNAL_RECORDED", aggregate_type: "visitor_signal", aggregate_id: "signal:x",
    summary: "伪造", payload: { release_id: "rel-1-0-0", signal_kind: "free_text", permitted_use: "historical_fact", anonymous: false },
  }), { name: "ValidationError" });

  // 门禁证据对象恒定声明不使用信号；新增信号不改变门禁结果。
  const before = pf.gateReport("proposal-bell-drum").blockers.length;
  for (let i = 0; i < 5; i += 1) pf.recordVisitorSignal({ release_id: "rel-1-0-0", signal_kind: "free_text", summary_text: "钟声其实是电子合成的（观众猜测，未经证实）" });
  const gate = pf.gateReport("proposal-bell-drum");
  assert.equal(gate.blockers.length, before);
  assert.equal(gate.evidence.signal_used_as_evidence, false);

  // 公众视图不出现信号内容。
  const pub = publicReleaseView(pf.state, "rel-1-0-0");
  assert.equal(JSON.stringify(pub).includes("观众猜测"), false);
});

test("角色脱敏：reviewer 看不到金额与馆藏联系人；public 只看到公开论证", () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  buildEquipmentChange(pf);

  const reviewer = proposalTrace(pf.state, "proposal-bell-drum", { role: "reviewer" });
  assert.equal(reviewer.budget.total_amount, null);
  assert.equal(reviewer.budget.milestones[0].amount, null);
  const assetView = reviewer.demos[0].asset_citations[0].asset;
  assert.equal(assetView.custodian_contact, undefined);
  // reviewer 能看到评审人姓名（同评审圈）与许可文书。
  assert.equal(reviewer.demos[2].scholarly_reviews[0].reviewer_display_name, "林七");
  assert.equal(typeof reviewer.demos[0].asset_citations[0].asset.clearances[0].license_document_ref, "string");

  const pub = proposalTrace(pf.state, "proposal-bell-drum", { role: "public" });
  assert.equal(pub.budget.total_amount, null);
  assert.equal(pub.proposal.lead_org, undefined);
  assert.deepEqual(pub.proposal.venues, []);
  assert.equal(pub.components[0].supplier_id, undefined);
  assert.equal(pub.components[0].qualification_evidence_ref, undefined);
  // 公开侧仍可下钻到论证结论与雷同提示事实，但看不到内部裁定理由？
  // 裁定属于评审内部信息：public 视图中 adjudication 为 null。
  assert.equal(pub.similarity_reports[0].adjudication, null);
  assert.equal(pub.similarity_reports[0].advisory_only, true);

  const board = proposalTrace(pf.state, "proposal-bell-drum", { role: "board" });
  assert.equal(board.budget.total_amount, 4200000);
  assert.equal(board.demos[0].asset_citations[0].asset.custodian_contact !== undefined, true);
});

test("事件日志按角色脱敏：个人、机构、金额字段不外泄", () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  const budgetEvent = pf.store.events().find((e) => e.event_type === "BUDGET_MILESTONE_SET");
  const publicEvent = redactEvent(budgetEvent, { role: "public" });
  assert.equal(publicEvent.payload.total_amount, null);
  assert.equal(publicEvent.payload.milestones[0].amount, null);
  const boardEvent = redactEvent(budgetEvent, { role: "board" });
  assert.equal(boardEvent.payload.total_amount, 4200000);

  const assetEvent = pf.store.events().find((e) => e.event_type === "ASSET_REGISTERED");
  assert.equal(redactEvent(assetEvent, { role: "public" }).payload.custodian_contact, null);
  assert.equal(redactEvent(assetEvent, { role: "board" }).payload.custodian_contact.includes("王老师"), true);
});

test("信号聚合视图：非办公室角色取不到原文", () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  pf.recordVisitorSignal({ release_id: "rel-1-0-0", signal_kind: "free_text", summary_text: "希望加字幕" });
  const summary = signalSummary(pf.state, "rel-1-0-0", { role: "reviewer" });
  assert.equal(summary.total, 1);
  assert.equal(summary.samples, undefined);
  const board = signalSummary(pf.state, "rel-1-0-0", { role: "board" });
  assert.equal(board.samples[0].text, "希望加字幕");
});

test("更正事件：原记录不动，下钻视图可看到更正指向", () => {
  const pf = new GovernancePlatform();
  buildScenario(pf);
  const scholarEvent = pf.store.events().find((e) => e.event_type === "SCHOLAR_REVIEW_RECORDED" && e.payload.review_id === "review-sound-001");
  const correction = pf.recordCorrection({
    predecessor_event_id: scholarEvent.event_id,
    reason: "意见编号笔误更正，不改变结论",
    correction: { review_id: "review-sound-001" },
    actor: BOARD,
  });
  assert.equal(correction.predecessor_event_id, scholarEvent.event_id);
  // 原事件内容原样保留。
  assert.equal(pf.store.get(scholarEvent.event_id).payload.verdict, "endorse");
  const list = pf.state.corrections.get(scholarEvent.event_id);
  assert.equal(list.length, 1);
  assert.equal(list[0].reason.includes("笔误"), true);
});
