/**
 * 端到端中文演示（node src/demo.js）：
 * 展示立项决策链、演示下钻、雷同提示与人工裁定、设备替换/延期的局部重审、
 * 内容变更的意见失效与重做、变更后上线再确认，以及匿名信号的用途边界。
 */
import { GovernancePlatform, GateError } from "./app.js";
import { buildScenario, buildEquipmentChange, buildContentChange, BOARD } from "./scenario.js";
import { proposalTrace, publicReleaseView, signalSummary } from "./views.js";

const pf = new GovernancePlatform();

const line = (title) => console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
const showGate = (id) => {
  const { blockers, advisories } = pf.gateReport(id);
  console.log(blockers.length ? `门禁阻断项（${blockers.length}）：` : "门禁：通过（无阻断项）");
  blockers.forEach((b) => console.log(`  ✗ ${b}`));
  advisories.forEach((a) => console.log(`  · 提示：${a}`));
};

// 1) 完整立项链直到 v1.0.0 上线。
line("一、立项决策链：命题 → 素材许可 → 原型出处 → 组件披露 → 预算 → 评估/审读 → 专项渠道 → 上线");
const out = buildScenario(pf);
console.log(`共保存 ${pf.store.events().length} 条不可变事件；v1.0.0 已上线。`);
showGate("proposal-bell-drum");

// 2) 评审人员从演示下钻到论证与数据出处（reviewer 角色，看不到金额与馆藏联系人）。
line("二、评审下钻：从演示片段看到论证、考古测绘出处、许可、学术意见（reviewer 视角）");
const trace = proposalTrace(pf.state, "proposal-bell-drum", { role: "reviewer" });
const sound = trace.demos.find((d) => d.scene_id === "s-sound");
console.log(`片段：${sound.title}`);
console.log(`论证：${sound.claim}`);
console.log(`AI 辅助：${sound.ai_assisted}；逐段人工核实：${sound.ai_human_verified}`);
for (const c of sound.asset_citations) {
  console.log(`  出处：${c.asset.citation} ｜定位 ${c.locator}｜用途：${c.usage}｜确定性：${c.certainty}`);
}
console.log(`学术意见：${sound.scholarly_reviews[0].verdict} —— ${sound.scholarly_reviews[0].opinion}`);
console.log(`预算在 reviewer 视角下：总额 ${trace.budget.total_amount}（金额已按角色隐藏，只见里程碑节奏）`);

// 3) 雷同只提示，人工裁定。
line("三、雷同提示不等于抄袭判定");
const report = pf.state.reports.get(out.similarityReportId);
console.log(`系统报告：与 ${report.compared_proposal_ids.join("、")} 相似度 ${report.score}，advisory_only=${report.advisory_only}`);
console.log(`匹配片段：${report.matched_segments[0].segment}（${report.matched_segments[0].score}）`);
console.log(`人工裁定：${report.adjudication.disposition} —— ${report.adjudication.rationale}`);

// 4) 设备替换 + 延期：只重审组件与排期，学术/无障碍意见全部承继。
line("四、设备替换与延期：只触发受影响部分重审，学术意见不悬空");
const equipmentChange = buildEquipmentChange(pf);
console.log(`平台提示本次至少重审：${equipmentChange.required_rereview_scope.join("、")}`);
const eqDecision = pf.state.changes.get("change-projector-swap").decision;
console.log(`审批：${eqDecision.decision}；重审 ${eqDecision.rereview_scope.join("、")}；承继意见 ${eqDecision.carried_review_ids.join("、")}`);
showGate("proposal-bell-drum");

// 5) 内容变更：声音段学术意见失效重做，测绘意见与无障碍评估承继。
line("五、内容变更：受影响片段学术意见失效并重审，其余显式承继");
buildContentChange(pf);
const contentDecision = pf.state.changes.get("change-ritual-rewrite").decision;
console.log(`重审：${contentDecision.rereview_scope.join("、")}`);
console.log(`失效：${contentDecision.invalidated_review_ids.join("、")}（已由 review-sound-002 重做覆盖）`);
console.log(`承继：${contentDecision.carried_review_ids.join("、")}`);
showGate("proposal-bell-drum");

// 6) 变更后新版本发布：办公室重新确认 go_live。
line("六、变更后发布新版本须重新确认上线");
try {
  pf.releaseVersion({
    proposal_id: "proposal-bell-drum", release_id: "rel-1-1-0", version: "1.1.0",
    artifact_ref: "release://bell-drum/1.1.0", prototype_version: 2,
    release_notes: "修正报时仪式时序表述。", approver_id: "board-office", actor: BOARD,
  });
  console.log("未确认即发布：意外放行（不应发生）");
} catch (err) {
  if (err instanceof GateError) console.log(`如预期被阻断：${err.blockers[0]}`);
  else throw err;
}
pf.approveStage({ proposal_id: "proposal-bell-drum", stage: "go_live", decision: "approved", board_id: "board-2027-q3", note: "两次变更材料齐备，意见承继清晰，确认 v1.1.0 上线。", actor: BOARD });
const rel11 = pf.releaseVersion({
  proposal_id: "proposal-bell-drum", release_id: "rel-1-1-0", version: "1.1.0",
  artifact_ref: "release://bell-drum/1.1.0", prototype_version: 2,
  release_notes: "修正报时仪式时序表述。", approver_id: "board-office", actor: BOARD,
});
console.log(`已发布 ${rel11.payload.version}（事件 ${rel11.event_id}）`);

// 7) 开放后的匿名互动：只能改进体验，不进入证据链。
line("七、开放后的匿名互动：仅用于改进体验，不能写成新的历史事实");
pf.recordVisitorSignal({ release_id: "rel-1-1-0", signal_kind: "dwell_time", summary_text: "声音片段平均停留 4 分 12 秒" });
pf.recordVisitorSignal({ release_id: "rel-1-1-0", signal_kind: "free_text", summary_text: "希望增加字幕字号调节" });
console.log(JSON.stringify(signalSummary(pf.state, "rel-1-1-0", { role: "board" }), null, 2));
const publicView = publicReleaseView(pf.state, "rel-1-1-0");
console.log(`公众视图数据来源仅含经审读素材，片段数：${publicView.scenes.length}；声明：${publicView.notice}`);

line("演示完成");
console.log(`事件总数：${pf.store.events().length}（只追加、不可原地改写；更正使用后继记录）`);
