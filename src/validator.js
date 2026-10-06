/**
 * 事件信封与载荷的最小校验（零依赖）。
 * 与 contracts/domain.schema.json 中的 x-event-payloads 保持一致；
 * 完整结构化校验以 JSON Schema 为准，这里覆盖跨系统交换最易出错的必填项与取值域。
 */

const ENVELOPE_REQUIRED = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
];

export const EVENT_TYPES = [
  "THESIS_SUBMITTED",
  "THESIS_REVISED",
  "SOURCE_REGISTERED",
  "SOURCE_CLEARED",
  "ACADEMIC_REVIEW_RECORDED",
  "PROPOSAL_CREATED",
  "PROTOTYPE_SUBMITTED",
  "COMPONENT_REGISTERED",
  "COMPONENT_DECLARED",
  "BUDGET_MILESTONE_SET",
  "ACCESSIBILITY_ASSESSED",
  "SIMILARITY_FLAGGED",
  "SPECIAL_REVIEW_CLEARED",
  "REVIEW_REQUESTED",
  "REVIEW_DECIDED",
  "CHANGE_REQUESTED",
  "CHANGE_REVIEWED",
  "VERSION_RELEASED",
  "VERSION_WITHDRAWN",
  "INTERACTION_CAPTURED",
  "INTERACTION_PURPOSE_VIOLATION_DETECTED",
];

export const AGGREGATE_TYPES = [
  "curatorial_thesis",
  "research_asset",
  "experience_proposal",
  "approval_decision",
  "change_request",
  "reused_component",
  "interaction_record",
];

/** 事件类型 → 该事件载荷必填字段。 */
const PAYLOAD_REQUIRED = {
  THESIS_SUBMITTED: ["proposal_id", "title", "proposition", "core_questions", "keywords"],
  THESIS_REVISED: ["proposal_id", "revision_of_event_id", "proposition", "change_note"],
  SOURCE_REGISTERED: ["proposal_id", "asset_kind", "title", "custodian", "content_hash"],
  SOURCE_CLEARED: ["proposal_id", "license_scope", "ai_generated", "human_reviewed", "terms_summary"],
  ACADEMIC_REVIEW_RECORDED: [
    "proposal_id",
    "target_kind",
    "target_ref",
    "reviewer",
    "verdict",
    "claims_reviewed",
    "notes",
  ],
  PROPOSAL_CREATED: [
    "proposal_id",
    "thesis_event_id",
    "title",
    "involves_overseas_tour",
    "involves_site_superposition",
    "involves_ai_generated",
  ],
  PROTOTYPE_SUBMITTED: ["proposal_id", "prototype_id", "demo_ref", "claims"],
  COMPONENT_REGISTERED: ["component_id", "name", "maturity", "origin_ref", "supplier"],
  COMPONENT_DECLARED: [
    "proposal_id",
    "component_id",
    "reuse",
    "modified",
    "origin_disclosure",
  ],
  BUDGET_MILESTONE_SET: ["proposal_id", "currency", "milestones", "total_amount"],
  ACCESSIBILITY_ASSESSED: ["proposal_id", "standard", "result", "findings"],
  SIMILARITY_FLAGGED: ["proposal_id", "threshold", "candidates", "note"],
  SPECIAL_REVIEW_CLEARED: [
    "proposal_id",
    "review_kind",
    "human_reviewed",
    "human_reviewer",
    "usage_scope",
    "verdict",
  ],
  REVIEW_REQUESTED: ["proposal_id", "gate", "reason"],
  REVIEW_DECIDED: ["proposal_id", "gate", "verdict", "reviewer_ids", "note"],
  CHANGE_REQUESTED: ["proposal_id", "change_class", "affected_sections", "reason", "details"],
  CHANGE_REVIEWED: [
    "change_request_id",
    "proposal_id",
    "decision",
    "reopened_gates",
    "carried_reviews",
    "reviewer_ids",
    "note",
  ],
  VERSION_RELEASED: ["proposal_id", "version_tag", "gate_snapshot", "release_note"],
  VERSION_WITHDRAWN: ["proposal_id", "version_tag", "reason"],
  INTERACTION_CAPTURED: [
    "proposal_id",
    "version_tag",
    "anonymous",
    "kind",
    "usage_purpose",
  ],
  INTERACTION_PURPOSE_VIOLATION_DETECTED: ["proposal_id", "attempted_use", "description"],
};

const ENUMS = {
  "payload.asset_kind": [
    "archaeological_survey",
    "architectural_drawing",
    "sound_recording",
    "scholarly_material",
    "other",
  ],
  "payload.license_scope": ["domestic", "overseas_tour", "site_superposition"],
  "payload.verdict": undefined, // 不同事件取值域不同，跳过
  "payload.gate": [
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
  ],
  "payload.change_class": [
    "device_replacement",
    "schedule_delay",
    "budget_adjustment",
    "component_swap",
    "venue_change",
    "content_change",
    "aigc_addition",
  ],
  "payload.review_kind": [
    "overseas_tour",
    "site_superposition",
    "ai_generated_content",
  ],
};

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function validateEvent(record) {
  const errors = [];

  for (const name of ENVELOPE_REQUIRED) {
    if (!(name in record)) errors.push(`缺少字段：${name}`);
  }
  if (errors.length > 0) return errors; // 缺基础字段时后续校验无意义

  if (!EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未知 event_type：${record.event_type}`);
  }
  if (!AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`未知 aggregate_type：${record.aggregate_type}`);
  }
  if (!Number.isInteger(record.version) || record.version < 1) {
    errors.push("version 必须是正整数");
  }
  if (typeof record.occurred_at !== "string" || !ISO_DATE_TIME.test(record.occurred_at)) {
    errors.push("occurred_at 必须是带时区的 ISO 8601 日期时间");
  }
  if (typeof record.event_id !== "string" || record.event_id.trim() === "") {
    errors.push("event_id 必须是非空字符串");
  }

  const required = PAYLOAD_REQUIRED[record.event_type];
  if (required) {
    const payload = record.payload ?? {};
    if (typeof record.payload !== "object" || record.payload === null || Array.isArray(record.payload)) {
      errors.push("payload 必须是对象");
    } else {
      for (const field of required) {
        if (!(field in payload)) errors.push(`payload 缺少字段：${field}`);
      }
      for (const [path, allowed] of Object.entries(ENUMS)) {
        const key = path.replace("payload.", "");
        if (allowed && key in payload && !allowed.includes(payload[key])) {
          errors.push(`payload.${key} 取值非法：${String(payload[key])}`);
        }
      }
      validateEventSpecific(record.event_type, payload, errors);
    }
  }

  return errors;
}

function validateEventSpecific(eventType, p, errors) {
  const at = (msg) => errors.push(msg);

  switch (eventType) {
    case "THESIS_SUBMITTED":
      if (typeof p.proposition === "string" && p.proposition.trim() === "") {
        at("proposition 不能为空：方案必须先提出独有的文化命题");
      }
      break;

    case "SOURCE_CLEARED":
      if (!["domestic", "overseas_tour", "site_superposition"].includes(p.license_scope)) {
        at("license_scope 取值非法");
      }
      // 海外巡展、原址叠加或许可标注含 AI 生成内容时，必须人工复核。
      if (
        (p.license_scope !== "domestic" || p.ai_generated === true) &&
        p.human_reviewed !== true
      ) {
        at("海外巡展 / 原址叠加 / AI 生成内容必须人工复核（human_reviewed=true）");
      }
      break;

    case "ACADEMIC_REVIEW_RECORDED":
      if (!["thesis", "asset", "prototype", "section"].includes(p.target_kind)) {
        at("target_kind 取值非法");
      }
      if (!["pass", "pass_with_conditions", "reject"].includes(p.verdict)) {
        at("学术审读 verdict 取值非法");
      }
      break;

    case "COMPONENT_REGISTERED":
      if (!["mature", "newly_developed"].includes(p.maturity)) {
        at("maturity 取值非法");
      }
      break;

    case "COMPONENT_DECLARED":
      if (p.modified === true && !(Array.isArray(p.modifications) && p.modifications.length > 0)) {
        at("复用组件若有修改，必须在 modifications 中逐项披露");
      }
      break;

    case "ACCESSIBILITY_ASSESSED":
      if (!["pass", "conditional", "fail"].includes(p.result)) {
        at("无障碍 result 取值非法");
      }
      break;

    case "SPECIAL_REVIEW_CLEARED":
      if (p.human_reviewed !== true) {
        at("特殊核对必须经人工复核（human_reviewed=true）");
      }
      if (!["cleared", "cleared_with_conditions", "rejected"].includes(p.verdict)) {
        at("特殊核对 verdict 取值非法");
      }
      if (p.verdict === "cleared_with_conditions" && !(Array.isArray(p.conditions) && p.conditions.length > 0)) {
        at("附条件通过必须给出 conditions");
      }
      break;

    case "REVIEW_DECIDED":
      if (!["approved", "rejected", "conditional"].includes(p.verdict)) {
        at("门禁 verdict 取值非法");
      }
      if (p.verdict === "conditional" && !(Array.isArray(p.conditions) && p.conditions.length > 0)) {
        at("附条件通过必须给出 conditions");
      }
      break;

    case "CHANGE_REVIEWED":
      if (!["approved", "rejected"].includes(p.decision)) at("变更 decision 取值非法");
      if (!Array.isArray(p.reopened_gates)) at("reopened_gates 必须是数组");
      if (!Array.isArray(p.carried_reviews)) at("carried_reviews 必须是数组");
      if (p.carried_reviews?.some((r) => typeof r?.review_event_id !== "string")) {
        at("每条沿用学术意见必须含 review_event_id（学术意见不得悬空）");
      }
      break;

    case "PROTOTYPE_SUBMITTED":
      if (!Array.isArray(p.claims)) at("claims 必须是数组");
      for (const [i, c] of (p.claims ?? []).entries()) {
        if (typeof c?.claim_id !== "string") at(`claims[${i}] 缺少 claim_id`);
        if (!Array.isArray(c?.evidence)) at(`claims[${i}].evidence 必须是数组（演示须可溯源）`);
      }
      break;

    case "INTERACTION_CAPTURED":
      if (p.anonymous !== true) at("开放互动记录必须匿名（anonymous=true）");
      if (p.usage_purpose !== "experience_improvement_only") {
        at("互动数据用途只能是 experience_improvement_only");
      }
      if (!["dwell", "path", "choice", "rating", "anonymous_feedback"].includes(p.kind)) {
        at("互动 kind 取值非法");
      }
      break;

    default:
      break;
  }
}
