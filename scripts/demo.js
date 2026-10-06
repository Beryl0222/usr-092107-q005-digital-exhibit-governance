/**
 * 端到端演示：一个中轴线数字展项方案从命题到上线、再到设备替换变更的完整决策链。
 * 运行：node scripts/demo.js
 */

import { Platform, ConstraintError } from "../src/platform.js";
import { redactEvent } from "../src/redact.js";

let tick = 0;
const base = Date.parse("2026-09-20T09:00:00+08:00");
const clock = () => new Date(base + tick++ * 60_000).toISOString();
// 可选：node scripts/demo.js --file data/demo-store.jsonl
const fileArg = process.argv.indexOf("--file");
const file = fileArg >= 0 ? process.argv[fileArg + 1] : null;
const pf = new Platform({ now: clock, ...(file ? { file } : {}) });

const P = "PROP-AXIS-2026-014";
const line = (s) => console.log(`\n=== ${s} ===`);

// 1) 命题：先有独有的文化命题，而不是先谈设备
line("1. 提交策展命题并立项（原址叠加 + 海外巡展 + 一处AI复原）");
pf.submitThesis({
  proposal_id: P,
  title: "中轴时辰",
  proposition: "以钟鼓楼报时制度为线索，体验中轴线如何以时间组织城市生活，让公众在原址听见晨钟暮鼓的声音景观。",
  core_questions: ["报时信号如何被不同阶层接收？", "声音景观如何在当代原址叠加？"],
  keywords: ["中轴线", "钟鼓楼", "时间制度", "声音景观"],
  proposer: { name: "陈某", organization: "某市属博物馆数字展陈部", contact: "chen@example.org" },
  actor: { id: "u-chen", role: "curator" },
});
pf.createProposal({
  proposal_id: P,
  title: "中轴时辰",
  thesis_event_id: pf.getProposal(P).thesis.current.event_id,
  flags: { site_superposition: true, overseas_tour: true, ai_generated: true },
});

// 雷同诱饵：另一方案命题高度相似
pf.submitThesis({
  proposal_id: "PROP-OTHER-2026-002",
  title: "钟鼓之间",
  proposition: "以钟鼓楼报时制度为线索，体验中轴线如何以时间组织城市生活，让公众在原址听见晨钟暮鼓的声音景观。",
  core_questions: [],
  keywords: ["中轴线", "钟鼓楼"],
});

// 2) 研究素材：考古测绘 / 建筑图档 / 声音采集，逐项登记并取得许可
line("2. 登记研究素材与许可（含内容指纹，使用范围与人工复核）");
pf.registerAsset({ asset_id: "A1", proposal_id: P, asset_kind: "archaeological_survey", title: "钟鼓楼台基考古测绘图", custodian: "市考古研究院", content_hash: "sha256:aaa1", provenance_note: "2024年实测" });
pf.registerAsset({ asset_id: "A2", proposal_id: P, asset_kind: "architectural_drawing", title: "鼓楼梁架建筑图档", custodian: "市古建研究所", content_hash: "sha256:bbb2", bib_ref: "《北京中轴古建图档》" });
pf.registerAsset({ asset_id: "A3", proposal_id: P, asset_kind: "sound_recording", title: "钟鼓楼报时声音采集", custodian: "钟鼓楼文保所", content_hash: "sha256:ccc3" });
pf.clearAsset({ asset_id: "A1", proposal_id: P, license_scope: "site_superposition", human_reviewed: true, human_reviewer_ids: ["r-li"], terms_summary: "仅限原址点位叠加展示" });
pf.clearAsset({ asset_id: "A2", proposal_id: P, license_scope: "overseas_tour", scope_territories: ["新加坡"], scope_venues: ["亚洲文明博物馆"], human_reviewed: true, human_reviewer_ids: ["r-li"], terms_summary: "海外巡展一站" });
pf.clearAsset({ asset_id: "A3", proposal_id: P, license_scope: "domestic", ai_generated: false, human_reviewed: true, human_reviewer_ids: ["r-wang"], terms_summary: "国内声音展映" });

// 3) 学术审读：命题、素材、原型分别留意见
line("3. 记录学术审读意见");
pf.recordAcademicReview({ proposal_id: P, target_kind: "thesis", target_ref: P, reviewer: { name: "李某", organization: "高校建筑史系", expertise: "中轴古建" }, verdict: "pass", claims_reviewed: ["时间制度命题成立"], notes: "命题有学术增量，非设备堆砌。" });
pf.recordAcademicReview({ proposal_id: P, target_kind: "asset", target_ref: "A1", reviewer: { name: "王某", organization: "考古研究院", expertise: "考古测绘" }, verdict: "pass", claims_reviewed: ["台基尺度"], notes: "测绘图与实物一致。" });

// 4) 原型：演示中的每条史实断言都能下钻到素材指纹
line("4. 提交交互原型（断言→证据链）");
pf.submitPrototype({
  proposal_id: P, prototype_id: "proto-1", demo_ref: "artifact://demo/axis-v0.9",
  claims: [
    { claim_id: "c1", statement: "鼓楼台基为明代遗存尺度", historical: true,
      evidence: [{ asset_id: "A1", content_hash: "sha256:aaa1", locator: "sheet/3" }] },
    { claim_id: "c2", statement: "暮鼓为一百零八声", historical: true,
      evidence: [{ asset_id: "A3", content_hash: "sha256:ccc3" }, { asset_id: "A2", content_hash: "sha256:bbb2" }] },
  ],
});

// 5) 组件：成熟组件复用，但披露来源与修改
line("5. 登记并披露复用组件（来源 + 修改）");
pf.registerComponent({ component_id: "C-spatial", name: "空间音频引擎", maturity: "mature", origin_ref: "github.com/example/spatial-audio", origin_license: "Apache-2.0", supplier: { name: "某声景科技", contact: "sales@example.org" } });
pf.declareComponent({ proposal_id: P, component_id: "C-spatial", reuse: true, modified: true, modifications: ["新增原址点位坐标偏移校正"], origin_disclosure: "基于开源空间音频引擎 v3.2，已自行修改坐标校正模块", supplier_quote: { amount: 180000, currency: "CNY" } });

// 6) 预算里程碑  7) 无障碍
line("6-7. 预算里程碑与无障碍评估");
pf.setBudget({ proposal_id: P, currency: "CNY", total_amount: 1200000, milestones: [{ name: "原型", amount: 300000 }, { name: "试运行", amount: 500000 }, { name: "上线", amount: 400000 }] });
pf.assessAccessibility({ proposal_id: P, standard: "GB/T 无障碍设计", result: "pass", findings: ["提供字幕与触感替代"], remediations: [] });

// 8) 雷同提示（只提示，不判抄袭）
line("8. 雷同比对 → 仅产生提示，等待人工裁定");
const sim = pf.runSimilarityCheck(P, { threshold: 0.4 });
console.log(`命中候选 ${sim.candidates.length} 个，最高相似度 ${sim.candidates[0]?.score}（系统不判定抄袭）`);

// 9) 特殊核对：海外巡展 / 原址叠加 / AI内容，逐项核对范围 + 人工
line("9. 特殊核对（范围一致 + 人工复核）");
pf.recordSpecialClearance({ proposal_id: P, review_kind: "site_superposition", human_reviewer: { id: "r-zhao", name: "赵某" }, usage_scope: { sites: ["鼓楼台基"], constraints: ["最小干预", "设备可逆安装"], until: "2027-12-31" }, verdict: "cleared", scopeCtx: { sites: ["鼓楼台基"], asset_ids: ["A1"] } });
pf.recordSpecialClearance({ proposal_id: P, review_kind: "overseas_tour", human_reviewer: { id: "r-zhao", name: "赵某" }, usage_scope: { territories: ["新加坡"], venues: ["亚洲文明博物馆"], until: "2027-06-30" }, verdict: "cleared", scopeCtx: { territories: ["新加坡"], venues: ["亚洲文明博物馆"], asset_ids: ["A2"] } });
pf.recordSpecialClearance({ proposal_id: P, review_kind: "ai_generated_content", human_reviewer: { id: "r-li", name: "李某" }, usage_scope: { allowed_as_historical: false, labeling_required: true, human_checkpoints: ["生成后审读", "上线前复核"] }, verdict: "cleared" });

// 10) 逐关人工评审
line("10. 决策链逐关评审（雷同关由人工裁定）");
for (const gate of ["thesis", "source", "academic", "prototype", "components", "budget", "accessibility"]) {
  pf.decideGate({ proposal_id: P, gate, verdict: "approved", reviewer_ids: ["panel-1"], note: "通过" });
}
pf.decideGate({ proposal_id: P, gate: "similarity", verdict: "approved", reviewer_ids: ["panel-1"], note: "命题虽表述相近，但选题证据链独立，人工裁定不构成抄袭。", adjudicates_event_id: sim.flag.event_id });
pf.decideGate({ proposal_id: P, gate: "special", verdict: "approved", reviewer_ids: ["panel-1"], note: "三类特殊核对齐备" });
pf.decideGate({ proposal_id: P, gate: "approval", verdict: "approved", reviewer_ids: ["panel-1", "office-0"], note: "准予上线" });

// 11) 上线
line("11. 发布上线版本");
pf.releaseVersion({ proposal_id: P, version_tag: "v1.0.0", release_note: "首版开放" });
console.log("已发布：", pf.getProposal(P).activeReleases.map((r) => r.payload.version_tag));

// 12) 开放后互动：匿名、仅改进体验；越界使用被拒并留痕
line("12. 匿名互动数据治理");
pf.captureInteraction({ proposal_id: P, version_tag: "v1.0.0", kind: "dwell", payload_summary: "声音场景平均停留 4 分钟" });
const bad = pf.requestInteractionUse(P, { purpose: "把观众高频选择写成新的历史事实证据" });
console.log("越界用途 allowed =", bad.allowed, "→ 违规事件", bad.violation_event_id);
const good = pf.requestInteractionUse(P, { purpose: "根据停留时长优化动线与音量" });
console.log("改进体验用途 allowed =", good.allowed);

// 13) 演示下钻
line("13. 评审人员由演示下钻到论证与出处");
const drill = pf.drilldown(P)[0];
for (const c of drill.claims) {
  console.log(`断言 ${c.claim_id}：${c.statement}`);
  for (const ev of c.evidence) {
    console.log(`   └─ 素材 ${ev.ref}｜${ev.registered?.kind}｜${ev.registered?.custodian}｜指纹一致=${ev.registered?.hash_match}｜许可=${ev.clearance?.license_scope}｜审读=${ev.academic_reviews.map((r) => r.verdict).join(",") || "—"}`);
  }
}

// 14) 设备替换：只重开受影响部分，学术意见显式沿用
line("14. 变更：投影设备替换（影响 device_stack）→ 重开 组件/原型/无障碍，学术意见沿用不悬空");
const preview = pf.previewChangeImpact(P, "device_replacement", ["device_stack"]);
console.log("必须重审的门禁：", preview.reopened_gates, "｜沿用学术意见：", preview.carried_reviews.length, "条");
const change = pf.requestChange({ proposal_id: P, change_class: "device_replacement", affected_sections: ["device_stack"], reason: "原型号停产，等效替换", details: { from: "proj-X", to: "proj-Y" } });
pf.reviewChange({ change_request_id: change.change_request_id, decision: "approved", reviewer_ids: ["office-0"], note: "等效替换" });
// 只对被重开的门禁按决策链顺序重新评审；命题、素材、学术、预算、特殊核对等结论保持有效
for (const gate of change.plan.reopenedGates) {
  pf.decideGate({ proposal_id: P, gate, verdict: "approved", reviewer_ids: ["panel-1"], note: "设备等效替换后复核通过（论证与素材未变）" });
}
pf.releaseVersion({ proposal_id: P, version_tag: "v1.1.0", release_note: "设备等效替换后再发布" });
console.log("已发布：", pf.getProposal(P).activeReleases.map((r) => r.payload.version_tag));

// 15) 角色脱敏
line("15. 角色脱敏（同一命题事件，三种视角）");
const thesisEvent = pf.store.streamForProposal(P).find((e) => e.event_type === "THESIS_SUBMITTED");
for (const role of ["public", "reviewer", "office"]) {
  const seen = redactEvent(thesisEvent, { role });
  console.log(role, "→ 申报机构:", seen.payload.proposer.organization, "｜联系:", seen.payload.proposer.contact);
}

console.log("\n演示完成。");
