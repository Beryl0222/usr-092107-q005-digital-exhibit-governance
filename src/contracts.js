/**
 * 运行期共享约定（零依赖 ESM）。
 * 类型定义见 src/domain.ts；这里给出 JS 运行期需要的实际映射，
 * 与 contracts/domain.schema.json 的事件目录保持一致。
 */

export const EVENT_AGGREGATE = {
  THESIS_SUBMITTED: "curatorial_thesis",
  THESIS_REVISED: "curatorial_thesis",
  SOURCE_REGISTERED: "research_asset",
  SOURCE_CLEARED: "research_asset",
  ACADEMIC_REVIEW_RECORDED: "experience_proposal",
  PROPOSAL_CREATED: "experience_proposal",
  PROTOTYPE_SUBMITTED: "experience_proposal",
  COMPONENT_REGISTERED: "reused_component",
  COMPONENT_DECLARED: "experience_proposal",
  BUDGET_MILESTONE_SET: "experience_proposal",
  ACCESSIBILITY_ASSESSED: "experience_proposal",
  SIMILARITY_FLAGGED: "experience_proposal",
  SPECIAL_REVIEW_CLEARED: "experience_proposal",
  REVIEW_REQUESTED: "approval_decision",
  REVIEW_DECIDED: "approval_decision",
  CHANGE_REQUESTED: "change_request",
  CHANGE_REVIEWED: "change_request",
  VERSION_RELEASED: "experience_proposal",
  VERSION_WITHDRAWN: "experience_proposal",
  INTERACTION_CAPTURED: "interaction_record",
  INTERACTION_PURPOSE_VIOLATION_DETECTED: "interaction_record",
};

/** 决策链门禁的规范顺序（从命题到上线）。 */
export const GATE_ORDER = [
  "thesis",
  "source",
  "academic",
  "prototype",
  "components",
  "budget",
  "accessibility",
  "similarity",
  "special",
  "approval",
];

/** 素材类别 → 中文名，供下钻视图与提示使用。 */
export const ASSET_KIND_LABELS = {
  archaeological_survey: "考古测绘",
  architectural_drawing: "建筑图档",
  sound_recording: "声音采集",
  scholarly_material: "学术资料",
  other: "其他",
};

export const CHANGE_CLASS_LABELS = {
  device_replacement: "设备替换",
  schedule_delay: "延期",
  budget_adjustment: "预算调整",
  component_swap: "组件替换",
  venue_change: "场地变化",
  content_change: "内容修改",
  aigc_addition: "新增AI生成内容",
};
