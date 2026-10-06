import assert from "node:assert/strict";
import test from "node:test";

import { GovernancePlatform, GateError } from "../src/app.js";
import { buildScenario, buildEquipmentChange, buildContentChange, BOARD } from "../src/scenario.js";
import { requiredRereviewScope } from "../src/policies.js";

function readyPlatform() {
  const pf = new GovernancePlatform();
  buildScenario(pf); // v1.0.0 已上线
  return pf;
}

test("影响矩阵：设备替换强制组件重审；内容变更强制原型与学术重审；海外扩展强制渠道", () => {
  const pf = readyPlatform();
  const proposal = pf.state.proposals.get("proposal-bell-drum");
  const eq = requiredRereviewScope(
    { change_kind: "equipment_replacement", affected_sections: [{ section_type: "component", summary: "换投影" }] },
    proposal,
  );
  assert.deepEqual(eq.sort(), ["component"]);

  const delay = requiredRereviewScope(
    { change_kind: "schedule_delay", affected_sections: [{ section_type: "schedule", summary: "顺延" }] },
    proposal,
  );
  assert.deepEqual(delay, ["schedule"]);

  const content = requiredRereviewScope(
    { change_kind: "content_revision", affected_sections: [{ section_type: "scholarly_content", ref: "s-sound", summary: "改写" }] },
    proposal,
  );
  assert.ok(content.includes("scholarly_content") && content.includes("prototype"));

  const overseas = requiredRereviewScope(
    { change_kind: "overseas_extension", affected_sections: [{ section_type: "channel_scope", ref: "overseas_tour", summary: "加德国" }] },
    proposal,
  );
  assert.ok(overseas.includes("channel_scope") && overseas.includes("venue"));
});

test("设备替换+延期：只重审组件与排期；既有学术/无障碍意见必须全部显式承继", () => {
  const pf = readyPlatform();
  const change = pf.requestChange({
    proposal_id: "proposal-bell-drum", change_id: "c-eq", change_kind: "equipment_replacement",
    affected_sections: [{ section_type: "component", ref: "comp-dome-screen", summary: "换主机" }],
    justification: "停产", actor: { id: "u", role: "applicant" },
  });
  assert.ok(change.required_rereview_scope.includes("component"));

  // 遗漏承继 → 学术意见悬空，审批被拒绝。
  assert.throws(
    () => pf.reviewChange({
      change_id: "c-eq", decision: "approved", rereview_scope: ["component", "schedule"],
      carried_review_ids: [], actor: BOARD,
    }),
    /悬空|承继/,
  );

  // 把学术意见错误列入重审（设备替换不动内容）→ 不允许随意扩大重审范围？
  // 平台允许扩大重审范围，但落入范围内的意见就必须失效重做，不能原样承继。
  assert.throws(
    () => pf.reviewChange({
      change_id: "c-eq", decision: "approved", rereview_scope: ["component", "schedule", "scholarly_content"],
      carried_review_ids: ["review-arch-001", "review-sound-001", "a11y-001"],
      invalidated_review_ids: [], actor: BOARD,
    }),
    /不能原样承继/,
  );

  pf.reviewChange({
    change_id: "c-eq", decision: "approved", rereview_scope: ["component", "schedule"],
    carried_review_ids: ["review-arch-001", "review-sound-001", "a11y-001"], actor: BOARD,
  });

  // 未补新组件披露前，变更不闭环。
  assert.ok(pf.gateReport("proposal-bell-drum").blockers.some((b) => b.includes("重新披露")));

  pf.declareComponent({
    component_id: "comp-new", proposal_id: "proposal-bell-drum", name: "B 型主机", is_reuse: true,
    origin: { source_type: "mature_product", upstream_name: "B 型", license: "合同" },
    modifications: "未修改，整机替换", actor: { id: "u", role: "applicant" },
  });
  assert.deepEqual(pf.gateReport("proposal-bell-drum").blockers, []);
});

test("已审批的变更决定不可原地改写；重复审批被拒绝", () => {
  const pf = readyPlatform();
  buildEquipmentChange(pf);
  assert.throws(
    () => pf.reviewChange({
      change_id: "change-projector-swap", decision: "rejected",
      rereview_scope: ["component"], carried_review_ids: [], actor: BOARD,
    }),
    /已经过审批/,
  );
});

test("内容变更：受影响片段的学术意见失效并以新意见重做；测绘意见与无障碍评估承继", () => {
  const pf = readyPlatform();
  buildContentChange(pf);
  const decision = pf.state.changes.get("change-ritual-rewrite").decision;
  assert.deepEqual(decision.rereview_scope.sort(), ["prototype", "scholarly_content"]);
  assert.deepEqual(decision.invalidated_review_ids, ["review-sound-001"]);
  assert.deepEqual(decision.carried_review_ids.sort(), ["a11y-001", "review-arch-001"]);

  // 原意见不再存活；新意见 review-sound-002 覆盖 s-sound。
  const trace = pf.state;
  const proposal = trace.proposals.get("proposal-bell-drum");
  // 门禁通过即证明新意见已覆盖、承继的意见仍然有效。
  assert.deepEqual(pf.gateReport("proposal-bell-drum").blockers, []);
  assert.ok(proposal.scholar_reviews.some((r) => r.review_id === "review-sound-002" && r.verdict === "endorse"));
});

test("内容变更批准后若不补齐材料，门禁持续阻断（意见不会自动恢复）", () => {
  const pf = readyPlatform();
  pf.requestChange({
    proposal_id: "proposal-bell-drum", change_id: "c-half", change_kind: "content_revision",
    affected_sections: [{ section_type: "scholarly_content", ref: "s-sound", summary: "改写" }],
    justification: "新档案", actor: { id: "u", role: "applicant" },
  });
  pf.reviewChange({
    change_id: "c-half", decision: "approved",
    rereview_scope: ["prototype", "scholarly_content"],
    carried_review_ids: ["review-arch-001", "a11y-001"],
    invalidated_review_ids: ["review-sound-001"],
    conditions: ["须重做"], actor: BOARD,
  });
  const blockers = pf.gateReport("proposal-bell-drum").blockers;
  assert.ok(blockers.some((b) => b.includes("须重新提交交互原型版本")));
  assert.ok(blockers.some((b) => b.includes("须重做受影响内容的学术审读")));
});

test("任何变更后发布新版本都须重新确认 go_live（延期也不例外）", () => {
  const pf = readyPlatform();
  buildEquipmentChange(pf);
  assert.throws(
    () => pf.releaseVersion({
      proposal_id: "proposal-bell-drum", release_id: "rel-x", version: "1.0.1",
      artifact_ref: "ref", prototype_version: 1, actor: BOARD,
    }),
    GateError,
  );
  pf.approveStage({ proposal_id: "proposal-bell-drum", stage: "go_live", decision: "approved", board_id: "board-x", actor: BOARD });
  pf.releaseVersion({
    proposal_id: "proposal-bell-drum", release_id: "rel-x", version: "1.0.1",
    artifact_ref: "ref", prototype_version: 1, actor: BOARD,
  });
  assert.ok(pf.state.releases.has("rel-x"));
});

test("海外扩展变更：新增巡展国必须重新核对海外渠道使用范围", () => {
  const pf = readyPlatform();
  pf.requestChange({
    proposal_id: "proposal-bell-drum", change_id: "c-de", change_kind: "overseas_extension",
    affected_sections: [
      { section_type: "channel_scope", ref: "overseas_tour", summary: "新增德国柏林站" },
      { section_type: "venue", ref: "DE-BER", summary: "柏林场馆" },
    ],
    justification: "文化交流邀请", actor: { id: "u", role: "applicant" },
  });
  pf.reviewChange({
    change_id: "c-de", decision: "approved",
    rereview_scope: ["channel_scope", "venue"],
    carried_review_ids: ["review-arch-001", "review-sound-001", "a11y-001"],
    actor: BOARD,
  });
  // 未重新核对海外渠道 → 阻断。
  assert.ok(pf.gateReport("proposal-bell-drum").blockers.some((b) => b.includes("overseas_tour") && b.includes("重新核对")));
});
