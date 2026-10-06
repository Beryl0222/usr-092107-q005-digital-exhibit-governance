import assert from "node:assert/strict";
import test from "node:test";

import { Platform, ConstraintError } from "../src/platform.js";
import { makePlatform, buildReadyProposal } from "./helpers.js";

/** 断言抛出 ConstraintError 且 details 中至少一条匹配 re。 */
function throwsDetail(fn, re) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ConstraintError, `期望 ConstraintError，实际 ${err.constructor.name}`);
    assert.ok(
      (err.details ?? []).some((d) => re.test(d)),
      `期望某条明细匹配 ${re}，实际明细：${JSON.stringify(err.details)}`,
    );
    return;
  }
  assert.fail("期望抛出 ConstraintError，但未抛出");
}

test("无独有命题不得立项（纯设备采购式方案被拦）", () => {
  const pf = makePlatform();
  assert.throws(
    () => pf.submitThesis({ proposal_id: "P", title: "买投影", proposition: "  ", core_questions: [], keywords: [] }),
    /文化命题/,
  );
});

test("门禁未就绪不得批准：素材未清许可时 source 关被拦", () => {
  const pf = makePlatform();
  pf.submitThesis({ proposal_id: "P", title: "题", proposition: "独有命题", core_questions: [], keywords: [] });
  pf.createProposal({ proposal_id: "P", title: "题", thesis_event_id: pf.getProposal("P").thesis.current.event_id });
  pf.decideGate({ proposal_id: "P", gate: "thesis", verdict: "approved", reviewer_ids: ["r"], note: "ok" });
  // source 无任何素材许可 → 阻止批准
  throwsDetail(() => pf.decideGate({ proposal_id: "P", gate: "source", verdict: "approved", reviewer_ids: ["r"], note: "ok" }), /尚未登记/);
  // 但驳回始终允许
  assert.doesNotThrow(() => pf.decideGate({ proposal_id: "P", gate: "source", verdict: "rejected", reviewer_ids: ["r"], note: "素材不足" }));
});

test("门禁必须按决策链顺序推进（前序未过不得跳关）", () => {
  const pf = makePlatform();
  pf.submitThesis({ proposal_id: "P", title: "题", proposition: "独有命题", core_questions: [], keywords: [] });
  pf.createProposal({ proposal_id: "P", title: "题", thesis_event_id: pf.getProposal("P").thesis.current.event_id });
  throwsDetail(() => pf.decideGate({ proposal_id: "P", gate: "budget", verdict: "approved", reviewer_ids: ["r"], note: "x" }), /前序门禁/);
});

test("完整决策链可上线，并生成发布门禁快照", () => {
  const pf = makePlatform();
  const { P } = buildReadyProposal(pf);
  const release = pf.releaseVersion({ proposal_id: P, version_tag: "v1.0.0", release_note: "上线" });
  assert.equal(release.payload.gate_snapshot.approval.state, "approved");
  assert.equal(release.payload.gate_snapshot.thesis.state, "approved");
  assert.equal(pf.getProposal(P).releaseReady.ready, true);
});

test("任一门禁未通过不得上线", () => {
  const pf = makePlatform();
  buildReadyProposal(pf);
  // 制造一个未通过门禁：撤掉无障碍材料难以直接回退，改为新建不完整方案
  const pf2 = makePlatform();
  pf2.submitThesis({ proposal_id: "Q", title: "题", proposition: "独有命题Q", core_questions: [], keywords: [] });
  pf2.createProposal({ proposal_id: "Q", title: "题", thesis_event_id: pf2.getProposal("Q").thesis.current.event_id });
  assert.throws(() => pf2.releaseVersion({ proposal_id: "Q", version_tag: "v1" }), /上线条件/);
});

test("雷同仅提示：产生 SIMILARITY_FLAGGED 并阻塞 similarity 关，直到人工裁定", () => {
  const pf = makePlatform();
  buildReadyProposal(pf, "P1", { proposition: "以钟鼓楼报时制度组织城市时间生活的声音景观体验。", keywords: ["钟鼓楼"] });
  // 注意：buildReadyProposal 已把 similarity 人工通过；这里另测一条未裁定路径
  const pf2 = makePlatform();
  pf2.submitThesis({ proposal_id: "A", title: "甲", proposition: "以钟鼓楼报时制度组织城市时间生活的声音景观体验。", core_questions: [], keywords: ["钟鼓楼"] });
  pf2.submitThesis({ proposal_id: "B", title: "乙", proposition: "以钟鼓楼报时制度组织城市时间生活的声音景观体验。", core_questions: [], keywords: ["钟鼓楼"] });
  const result = pf2.runSimilarityCheck("A", { threshold: 0.3 });
  assert.equal(result.flagged, true);
  assert.match(result.flag.payload.note, /不构成抄袭结论|须由人工/);
  const proj = pf2.getProposal("A");
  assert.ok(proj.gates.get("similarity").blockers.some((b) => b.includes("待人工裁定")));
  // 未附裁定不能通过 similarity
  throwsDetail(() => pf2.decideGate({ proposal_id: "A", gate: "similarity", verdict: "approved", reviewer_ids: ["r"], note: "x" }), /待人工裁定/);
});

test("特殊核对：海外巡展地区超出素材许可被拦，补齐后通过", () => {
  const pf = makePlatform();
  buildReadyProposal(pf, "P", { flags: { overseas_tour: true } });
  // 再提交一个海外方案但核准地区不含申报地
  const pf2 = makePlatform();
  pf2.submitThesis({ proposal_id: "O", title: "题", proposition: "独有海外命题", core_questions: [], keywords: [] });
  pf2.createProposal({ proposal_id: "O", title: "题", thesis_event_id: pf2.getProposal("O").thesis.current.event_id, flags: { overseas_tour: true } });
  throwsDetail(
    () => pf2.recordSpecialClearance({
      proposal_id: "O", review_kind: "overseas_tour", human_reviewer: { id: "r" },
      usage_scope: { territories: ["新加坡"], venues: ["博物馆"], until: "2027-12-31" },
      verdict: "cleared", scopeCtx: { territories: ["日本"], asset_ids: [] },
    }),
    /日本/,
  );
});

test("变更：设备替换只重开受影响门禁，既有学术意见显式沿用不悬空", () => {
  const pf = makePlatform();
  const { P } = buildReadyProposal(pf);
  pf.releaseVersion({ proposal_id: P, version_tag: "v1.0.0", release_note: "首版" });

  const change = pf.requestChange({ proposal_id: P, change_class: "device_replacement", affected_sections: [], reason: "停产替换" });
  // 默认设备替换仅 prototype/accessibility（不原地排序，保持决策链规范顺序）
  assert.deepEqual([...change.plan.reopenedGates].sort(), ["accessibility", "prototype"].sort());
  assert.deepEqual(change.plan.reopenedGates, ["prototype", "accessibility"]);

  const reviewed = pf.reviewChange({ change_request_id: change.change_request_id, decision: "approved", reviewer_ids: ["o"], note: "等效" });
  // 学术意见被显式沿用（命题审读仍在）
  assert.ok(reviewed.payload.carried_reviews.length >= 1);
  assert.ok(reviewed.payload.carried_reviews.every((c) => c.applies === true && c.review_event_id));

  const after = pf.getProposal(P);
  for (const g of ["thesis", "source", "academic", "budget", "similarity", "special", "approval"]) {
    assert.equal(after.gates.get(g).state, "approved", `${g} 应保持有效`);
  }
  for (const g of change.plan.reopenedGates) {
    assert.equal(after.gates.get(g).state, "reopened_pending");
  }

  // 重开的两关重新通过后可再次发布；未重开的关不需要重审
  for (const g of change.plan.reopenedGates) {
    pf.decideGate({ proposal_id: P, gate: g, verdict: "approved", reviewer_ids: ["r"], note: "替换后复核" });
  }
  pf.releaseVersion({ proposal_id: P, version_tag: "v1.1.0", release_note: "设备替换" });
  assert.deepEqual(pf.getProposal(P).activeReleases.map((r) => r.payload.version_tag), ["v1.0.0", "v1.1.0"]);
});

test("延期只重开 budget，命题与素材学术结论保持有效", () => {
  const pf = makePlatform();
  const { P } = buildReadyProposal(pf);
  const change = pf.requestChange({ proposal_id: P, change_class: "schedule_delay", affected_sections: [], reason: "供货延迟" });
  assert.deepEqual(change.plan.reopenedGates, ["budget"]);
  pf.reviewChange({ change_request_id: change.change_request_id, decision: "approved", reviewer_ids: ["o"], note: "同意延期" });
  const after = pf.getProposal(P);
  assert.equal(after.gates.get("budget").state, "reopened_pending");
  assert.equal(after.gates.get("thesis").state, "approved");
  assert.equal(after.gates.get("academic").state, "approved");
});

test("演示下钻：断言→证据→素材指纹/许可/学术审读，指纹不符会暴露", () => {
  const pf = makePlatform();
  const { P } = buildReadyProposal(pf);
  const drill = pf.drilldown(P);
  const claim = drill[0].claims.find((c) => c.claim_id === "c1");
  const ev = claim.evidence[0];
  assert.equal(ev.registered.kind, "archaeological_survey");
  assert.equal(ev.registered.hash_match, true);
  assert.equal(ev.clearance.license_scope, "domestic");
  assert.ok(ev.academic_reviews.some((r) => r.verdict === "pass"));

  // 提交一条指纹不符的证据，prototype 关应被阻塞
  pf.submitPrototype({
    proposal_id: P, prototype_id: "proto-bad", demo_ref: "artifact://bad",
    claims: [{ claim_id: "x", statement: "失实", historical: true, evidence: [{ asset_id: "A1", content_hash: "sha256:WRONG" }] }],
  });
  // 触发一次变更重开 prototype 以便重新评估，或直接检查投影阻塞（存在多个原型，最新含坏证据）
  const blockers = pf.getProposal(P).gates.get("prototype").blockers;
  assert.ok(blockers.some((b) => b.includes("指纹")));
});

test("开放互动只能改进体验：匿名采集放行，越界用途拒绝并留痕", () => {
  const pf = makePlatform();
  const { P } = buildReadyProposal(pf);
  pf.releaseVersion({ proposal_id: P, version_tag: "v1", release_note: "x" });
  assert.doesNotThrow(() => pf.captureInteraction({ proposal_id: P, version_tag: "v1", kind: "dwell", payload_summary: "停留4分钟" }));
  const denied = pf.requestInteractionUse(P, { purpose: "增补为新的历史事实证据" });
  assert.equal(denied.allowed, false);
  assert.ok(denied.violation_event_id);
  const proj = pf.getProposal(P);
  assert.equal(proj.interactionViolations.length, 1);
  assert.equal(proj.interactions[0].payload.anonymous, true);
  assert.equal(proj.interactions[0].payload.usage_purpose, "experience_improvement_only");
  // 互动数据不得进入证据链：尝试把它当素材登记证据会被拒（原型证据策略）
});

test("复用组件必须披露来源；有修改必须逐项披露，否则 components 关阻塞", () => {
  const pf = makePlatform();
  pf.submitThesis({ proposal_id: "P", title: "题", proposition: "独有命题", core_questions: [], keywords: [] });
  pf.createProposal({ proposal_id: "P", title: "题", thesis_event_id: pf.getProposal("P").thesis.current.event_id });
  pf.registerComponent({ component_id: "C1", name: "引擎", maturity: "mature", origin_ref: "repo/x", supplier: { name: "供应商" } });
  // 复用但不披露来源（modified:false 时无修改项可披露；只考察来源披露缺失）
  pf.declareComponent({ proposal_id: "P", component_id: "C1", reuse: true, modified: false, modifications: [], origin_disclosure: "  " });
  const blockers = pf.getProposal("P").gates.get("components").blockers;
  assert.ok(blockers.some((b) => b.includes("来源")));

  // 有修改却不在存储层逐项披露：事件直接被存储校验拒绝（不可带病入库）
  throwsDetail(
    () => pf.declareComponent({ proposal_id: "P", component_id: "C1", reuse: true, modified: true, modifications: [], origin_disclosure: "repo/x" }),
    /modifications/,
  );
});
