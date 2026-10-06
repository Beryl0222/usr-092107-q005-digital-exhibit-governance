import assert from "node:assert/strict";
import test from "node:test";

import { planChangeReview, carryForwardAcademicReviews } from "../src/policies/change-policy.js";
import { findSimilarProposals } from "../src/policies/similarity.js";
import { checkSpecialClearance, requiredSpecialKinds } from "../src/policies/special-review.js";
import { reviewInteractionUse, checkInteractionCaptured, checkClaimProvenance } from "../src/policies/interaction.js";

// ---- 变更分级 ----

test("设备替换只重开受影响门禁，命题/素材/学术不重审", () => {
  const plan = planChangeReview("device_replacement", []);
  assert.deepEqual(plan.reopenedGates.sort(), ["accessibility", "prototype"].sort());
  assert.ok(!plan.reopenedGates.includes("thesis"));
  assert.ok(!plan.reopenedGates.includes("academic"));
  assert.ok(!plan.reopenedGates.includes("source"));
});

test("延期默认只需预算层面处理；内容修改触发大范围重审与特殊核对", () => {
  assert.deepEqual(planChangeReview("schedule_delay").reopenedGates, ["budget"]);
  const content = planChangeReview("content_change");
  for (const g of ["thesis", "source", "academic", "prototype", "special", "approval"]) {
    assert.ok(content.reopenedGates.includes(g));
  }
  assert.ok(content.requiresSpecial.includes("ai_generated_content"));
});

test("组件替换按声明部分扩展到组件/原型/无障碍", () => {
  const plan = planChangeReview("component_swap", ["device_stack"]);
  for (const g of ["components", "prototype", "accessibility"]) assert.ok(plan.reopenedGates.includes(g));
});

test("未受影响的学术意见被显式沿用，绝不悬空", () => {
  const reviews = [
    { event_id: "rv-thesis", event_type: "ACADEMIC_REVIEW_RECORDED", payload: { target_kind: "thesis", target_ref: "P1" } },
    { event_id: "rv-asset", event_type: "ACADEMIC_REVIEW_RECORDED", payload: { target_kind: "asset", target_ref: "A1" } },
    { event_id: "rv-proto", event_type: "ACADEMIC_REVIEW_RECORDED", payload: { target_kind: "prototype", target_ref: "proto-1" } },
  ];
  // 设备替换重开 prototype/accessibility：命题与素材审读沿用，原型审读不沿用
  const carried = carryForwardAcademicReviews(reviews, ["prototype", "accessibility"]);
  const ids = carried.map((c) => c.review_event_id);
  assert.deepEqual(ids.sort(), ["rv-asset", "rv-thesis"]);
  assert.ok(carried.every((c) => c.applies === true));
});

// ---- 雷同提示 ----

test("雷同命中只产出候选与分数，不含抄袭判定字段", () => {
  const mk = (id, pid, text) => ({
    event_id: id,
    payload: { proposal_id: pid, title: "题", proposition: text, keywords: ["钟鼓楼"], core_questions: [] },
  });
  const text = "以钟鼓楼报时制度为线索，体验中轴线如何以时间组织城市生活，让公众听见晨钟暮鼓。";
  const target = mk("t1", "P1", text);
  const other = mk("t2", "P2", text);
  const candidates = findSimilarProposals(target, [other], { threshold: 0.3 });
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].score > 0.5);
  assert.equal(candidates[0].other_proposal_id, "P2");
  // 只给信号，不给 verdict/conclusion
  assert.equal("verdict" in candidates[0], false);
  assert.equal("plagiarism" in candidates[0], false);
});

test("不相似命题不产生候选", () => {
  const mk = (id, pid, text) => ({ event_id: id, payload: { proposal_id: pid, title: "t", proposition: text, keywords: [], core_questions: [] } });
  const candidates = findSimilarProposals(mk("a", "P1", "探讨雨水排放与城市水系生态"), [mk("b", "P2", "复原宫廷戏曲的声学表演空间")], { threshold: 0.5 });
  assert.equal(candidates.length, 0);
});

// ---- 特殊核对 ----

test("所需特殊核对类别由方案声明推导", () => {
  assert.deepEqual(requiredSpecialKinds({ involves_overseas_tour: true, involves_ai_generated: true }).sort(),
    ["ai_generated_content", "overseas_tour"].sort());
});

test("海外巡展地区超出核准范围被指出", () => {
  const cleared = {
    payload: {
      review_kind: "overseas_tour", human_reviewed: true, human_reviewer: { id: "r" }, verdict: "cleared",
      usage_scope: { territories: ["新加坡"], venues: ["博物馆"], until: "2027-12-31" },
    },
  };
  const errors = checkSpecialClearance(cleared, { scope: { territories: ["日本"] } });
  assert.ok(errors.some((e) => e.includes("日本")));
  assert.deepEqual(checkSpecialClearance(cleared, { scope: { territories: ["新加坡"] } }), []);
});

test("使用期限超出核准时限被指出", () => {
  const cleared = { payload: { review_kind: "overseas_tour", human_reviewed: true, human_reviewer: {}, verdict: "cleared", usage_scope: { until: "2027-06-30" } } };
  const errors = checkSpecialClearance(cleared, { scope: { until: "2028-01-01" } });
  assert.ok(errors.some((e) => e.includes("期限")));
});

test("AI 生成内容不得核准为史实且须标注与人工检查点", () => {
  const base = { review_kind: "ai_generated_content", human_reviewed: true, human_reviewer: { id: "r" }, verdict: "cleared" };
  assert.ok(checkSpecialClearance({ payload: { ...base, usage_scope: { allowed_as_historical: true, labeling_required: true, human_checkpoints: ["x"] } } })
    .some((e) => e.includes("历史事实")));
  assert.ok(checkSpecialClearance({ payload: { ...base, usage_scope: { allowed_as_historical: false, human_checkpoints: ["x"] } } })
    .some((e) => e.includes("标注")));
  assert.ok(checkSpecialClearance({ payload: { ...base, usage_scope: { allowed_as_historical: false, labeling_required: true } } })
    .some((e) => e.includes("人工复核检查点")));
});

test("原址叠加须核准具体点位与现场约束", () => {
  const cleared = { payload: { review_kind: "site_superposition", human_reviewed: true, human_reviewer: {}, verdict: "cleared", usage_scope: { sites: [], constraints: [] } } };
  const errors = checkSpecialClearance(cleared, {});
  assert.ok(errors.some((e) => e.includes("点位")));
  assert.ok(errors.some((e) => e.includes("约束")));
});

test("缺少人工复核的特殊核对被指出", () => {
  const errors = checkSpecialClearance({ payload: { review_kind: "ai_generated_content", human_reviewed: false, usage_scope: {} } });
  assert.ok(errors.some((e) => e.includes("人工复核")));
});

// ---- 互动数据治理 ----

test("互动用途：改进体验放行；写成史实/再识别拒绝", () => {
  assert.equal(reviewInteractionUse({ purpose: "根据停留时长优化动线和音量" }).allowed, true);
  const hist = reviewInteractionUse({ purpose: "把观众高频选择写成新的历史事实" });
  assert.equal(hist.allowed, false);
  assert.equal(hist.attempted_use, "historical_claim_evidence");
  const reid = reviewInteractionUse({ purpose: "对匿名会话做再识别和个人画像" });
  assert.equal(reid.allowed, false);
  assert.equal(reid.attempted_use, "re_identification");
});

test("互动记录夹带个人信息字段被指出", () => {
  const errors = checkInteractionCaptured({ payload: { anonymous: true, usage_purpose: "experience_improvement_only", phone: "139..." } });
  assert.ok(errors.some((e) => e.includes("phone")));
  assert.deepEqual(checkInteractionCaptured({ payload: { anonymous: true, usage_purpose: "experience_improvement_only" } }), []);
});

test("史实断言证据：拒绝互动数据、未登记素材与指纹不符", () => {
  const assets = new Map([["A1", { payload: { content_hash: "sha256:h1" } }]]);
  const claims = [
    { claim_id: "c-bad-interaction", historical: true, evidence: [{ asset_id: "interaction-9" }] },
    { claim_id: "c-unregistered", historical: true, evidence: [{ asset_id: "A9" }] },
    { claim_id: "c-hash", historical: true, evidence: [{ asset_id: "A1", content_hash: "sha256:different" }] },
    { claim_id: "c-ok", historical: true, evidence: [{ asset_id: "A1", content_hash: "sha256:h1" }] },
  ];
  const report = checkClaimProvenance(claims, assets);
  const byId = Object.fromEntries(report.map((r) => [r.claim_id, r.errors]));
  assert.ok(byId["c-bad-interaction"].some((e) => e.includes("互动")));
  assert.ok(byId["c-unregistered"].some((e) => e.includes("未登记")));
  assert.ok(byId["c-hash"].some((e) => e.includes("指纹")));
  assert.equal(byId["c-ok"], undefined);
});
