/**
 * 事件信封与各事件 payload 的最小校验（零依赖，与 contracts/domain.schema.json 同义）。
 * 返回中文错误信息数组；空数组表示通过。
 * 与 src/domain.ts、contracts/domain.schema.json 三处定义保持同义。
 */

const REQUIRED = ["event_id", "event_type", "aggregate_type", "aggregate_id", "occurred_at", "version", "summary"];

/** 事件类型 → 聚合类型（与 src/domain.ts 的 AGGREGATE_FOR_EVENT 保持一致）。 */
const AGGREGATE_FOR_EVENT = {
  THESIS_SUBMITTED: "curatorial_thesis",
  THESIS_WITHDRAWN: "curatorial_thesis",
  PROPOSAL_CREATED: "experience_proposal",
  ASSET_REGISTERED: "research_asset",
  SOURCE_CLEARED: "research_asset",
  PROTOTYPE_SUBMITTED: "prototype",
  COMPONENT_DECLARED: "supplier_component",
  BUDGET_MILESTONE_SET: "budget",
  ACCESSIBILITY_REVIEWED: "accessibility_review",
  SCHOLAR_REVIEW_RECORDED: "scholarly_review",
  CHANNEL_SCOPE_CHECKED: "channel_clearance",
  SIMILARITY_FLAGGED: "similarity_report",
  SIMILARITY_ADJUDICATED: "similarity_report",
  CHANGE_REQUESTED: "change_request",
  CHANGE_REVIEWED: "approval_decision",
  STAGE_APPROVED: "approval_decision",
  VERSION_RELEASED: "release",
  VISITOR_SIGNAL_RECORDED: "visitor_signal",
  // CORRECTION_RECORDED 可更正任意聚合上的事件，aggregate_type 与被更正事件一致；
  // 具体合法性在 store.append / 应用层按 predecessor 事件核对。
  CORRECTION_RECORDED: "*",
};

const AGGREGATE_TYPES = [
  "curatorial_thesis", "research_asset", "experience_proposal", "prototype",
  "supplier_component", "budget", "accessibility_review", "scholarly_review",
  "channel_clearance", "similarity_report", "change_request", "approval_decision",
  "release", "visitor_signal",
];

export const EVENT_TYPES = Object.keys(AGGREGATE_FOR_EVENT);

const CHANNELS = ["onsite", "overseas_tour", "on_site_overlay", "online", "ai_generated"];

// 每个事件类型 payload 的必填字段（除 CORRECTION_RECORDED 外都要求 payload 存在）。
const PAYLOAD_REQUIRED = {
  THESIS_SUBMITTED: ["title", "cultural_claim"],
  THESIS_WITHDRAWN: ["reason"],
  PROPOSAL_CREATED: ["proposal_id", "thesis_id", "title", "channels"],
  ASSET_REGISTERED: ["asset_id", "kind", "title", "citation"],
  SOURCE_CLEARED: ["asset_id", "scope", "cleared"],
  PROTOTYPE_SUBMITTED: ["proposal_id", "prototype_version", "demo_scenes"],
  COMPONENT_DECLARED: ["proposal_id", "name", "is_reuse"],
  BUDGET_MILESTONE_SET: ["proposal_id", "currency", "total_amount", "milestones"],
  ACCESSIBILITY_REVIEWED: ["proposal_id", "result", "scope_sections"],
  SCHOLAR_REVIEW_RECORDED: ["proposal_id", "verdict", "opinion", "scope_sections", "review_id"],
  CHANNEL_SCOPE_CHECKED: ["proposal_id", "channel", "status"],
  SIMILARITY_FLAGGED: ["proposal_id", "compared_proposal_ids", "score", "advisory_only"],
  SIMILARITY_ADJUDICATED: ["report_id", "disposition", "rationale"],
  CHANGE_REQUESTED: ["proposal_id", "change_id", "change_kind", "affected_sections", "justification"],
  CHANGE_REVIEWED: ["change_id", "proposal_id", "decision", "rereview_scope", "carried_review_ids"],
  STAGE_APPROVED: ["proposal_id", "stage", "decision"],
  VERSION_RELEASED: ["proposal_id", "release_id", "version", "artifact_ref"],
  VISITOR_SIGNAL_RECORDED: ["release_id", "signal_kind", "permitted_use", "anonymous"],
  CORRECTION_RECORDED: ["predecessor_event_id", "reason"],
};

const ENUMS = {
  "PROPOSAL_CREATED.channels": CHANNELS,
  "ASSET_REGISTERED.kind": ["archaeological_survey", "architectural_archive", "sound_recording", "field_notes", "other"],
  "ACCESSIBILITY_REVIEWED.result": ["pass", "conditional", "fail"],
  "SCHOLAR_REVIEW_RECORDED.verdict": ["endorse", "revise", "reject"],
  "CHANNEL_SCOPE_CHECKED.channel": CHANNELS,
  "CHANNEL_SCOPE_CHECKED.status": ["cleared", "restricted", "rejected", "pending_human_review"],
  "SIMILARITY_ADJUDICATED.disposition": ["distinct", "needs_revision", "plagiarism_concern_escalated"],
  "CHANGE_REQUESTED.change_kind": [
    "equipment_replacement", "schedule_delay", "content_revision", "venue_change",
    "overseas_extension", "ai_scope_extension", "budget_adjustment",
  ],
  "CHANGE_REVIEWED.decision": ["approved", "approved_with_conditions", "rejected"],
  "STAGE_APPROVED.stage": ["acceptance", "pre_release", "go_live"],
  "STAGE_APPROVED.decision": ["approved", "rejected"],
  "VISITOR_SIGNAL_RECORDED.signal_kind": ["interaction_path", "dwell_time", "rating", "free_text", "accessibility_usage"],
};

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const at = (path) => `payload.${path}`;

export function validateEvent(record) {
  const errors = REQUIRED.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);

  if (record.event_id !== undefined && !isNonEmptyString(record.event_id)) errors.push("event_id 必须是非空字符串");
  if (record.aggregate_id !== undefined && !isNonEmptyString(record.aggregate_id)) errors.push("aggregate_id 必须是非空字符串");
  if (record.summary !== undefined && !isNonEmptyString(record.summary)) errors.push("summary 必须是非空字符串");
  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("occurred_at" in record && Number.isNaN(Date.parse(record.occurred_at))) {
    errors.push("occurred_at 必须是合法的 date-time");
  }
  if ("event_type" in record) {
    if (!EVENT_TYPES.includes(record.event_type)) {
      errors.push(`event_type 不在事件目录中：${record.event_type}`);
    } else {
      const expectedAggregate = AGGREGATE_FOR_EVENT[record.event_type];
      if ("aggregate_type" in record) {
        if (expectedAggregate === "*") {
          if (!AGGREGATE_TYPES.includes(record.aggregate_type)) {
            errors.push(`CORRECTION_RECORDED 的 aggregate_type 必须与被更正事件一致（${AGGREGATE_TYPES.join(" / ")}）`);
          }
        } else if (record.aggregate_type !== expectedAggregate) {
          errors.push(`${record.event_type} 的 aggregate_type 必须是 ${expectedAggregate}，实际为 ${record.aggregate_type}`);
        }
      }
    }
  } else if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`aggregate_type 不在聚合目录中：${record.aggregate_type}`);
  }

  if ("actor" in record && record.actor !== undefined) {
    const actor = record.actor;
    if (typeof actor !== "object" || actor === null) {
      errors.push("actor 必须是对象");
    } else {
      if (!isNonEmptyString(actor.id)) errors.push("actor.id 必须是非空字符串");
      const roles = ["applicant", "reviewer", "board", "system", "anonymous"];
      if (!roles.includes(actor.role)) errors.push(`actor.role 必须是 ${roles.join("/")}`);
    }
  }

  const type = record.event_type;
  if (!EVENT_TYPES.includes(type)) return errors;

  if (type !== "CORRECTION_RECORDED" && (record.payload === undefined || record.payload === null)) {
    errors.push("缺少字段：payload");
    return errors;
  }
  const p = record.payload ?? {};
  if (typeof p !== "object" || Array.isArray(p)) {
    errors.push("payload 必须是对象");
    return errors;
  }

  for (const field of PAYLOAD_REQUIRED[type] ?? []) {
    if (!(field in p) || p[field] === undefined || p[field] === null || (typeof p[field] === "string" && p[field].trim() === "")) {
      errors.push(`${at(field)} 为必填项`);
    }
  }

  for (const [key, allowed] of Object.entries(ENUMS)) {
    const [evt, field] = key.split(".");
    if (evt !== type || !(field in p) || p[field] === undefined) continue;
    const values = Array.isArray(p[field]) ? p[field] : [p[field]];
    for (const value of values) {
      if (!allowed.includes(value)) {
        errors.push(`${at(field)} 取值非法：${value}（允许：${allowed.join(" / ")}）`);
      }
    }
  }

  // 结构化约束（只校验平台决策依赖的关键不变量）。
  if (type === "PROPOSAL_CREATED" && Array.isArray(p.channels)) {
    if (p.channels.length === 0) errors.push(`${at("channels")} 至少包含一个渠道`);
    const bad = p.channels.filter((c) => !CHANNELS.includes(c));
    if (bad.length) errors.push(`${at("channels")} 含未知渠道：${bad.join("、")}`);
  }

  if (type === "SOURCE_CLEARED") {
    const scope = p.scope;
    if (scope !== undefined && (typeof scope !== "object" || Array.isArray(scope))) {
      errors.push(`${at("scope")} 必须是对象`);
    } else if (scope && Array.isArray(scope.channels)) {
      const bad = scope.channels.filter((c) => !CHANNELS.includes(c));
      if (bad.length) errors.push(`${at("scope.channels")} 含未知渠道：${bad.join("、")}`);
    }
  }

  if (type === "PROTOTYPE_SUBMITTED") {
    if (!Number.isInteger(p.prototype_version) || p.prototype_version < 1) {
      errors.push(`${at("prototype_version")} 必须是正整数`);
    }
    if (!Array.isArray(p.demo_scenes) || p.demo_scenes.length === 0) {
      errors.push(`${at("demo_scenes")} 至少包含一个演示片段`);
    } else {
      p.demo_scenes.forEach((scene, i) => {
        const prefix = `${at("demo_scenes")}[${i}]`;
        for (const f of ["scene_id", "title", "claim"]) {
          if (!isNonEmptyString(scene?.[f])) errors.push(`${prefix}.${f} 为必填项`);
        }
        if (!Array.isArray(scene?.asset_citations) || scene.asset_citations.length === 0) {
          errors.push(`${prefix}.asset_citations 不能为空：每个演示片段必须可追溯到研究素材`);
        } else {
          scene.asset_citations.forEach((c, j) => {
            for (const f of ["asset_id", "locator", "usage"]) {
              if (!isNonEmptyString(c?.[f])) errors.push(`${prefix}.asset_citations[${j}].${f} 为必填项`);
            }
            if (c?.certainty !== undefined && !["measured", "documented", "inferred"].includes(c.certainty)) {
              errors.push(`${prefix}.asset_citations[${j}].certainty 取值非法`);
            }
          });
        }
      });
    }
  }

  if (type === "COMPONENT_DECLARED") {
    if (typeof p.is_reuse !== "boolean") errors.push(`${at("is_reuse")} 必须是布尔值`);
    // 复用成熟组件：必须披露来源；修改情况必须显式说明（允许写"未修改"，但不允许留空）。
    if (p.is_reuse === true) {
      if (!p.origin || !isNonEmptyString(p.origin.source_type)) {
        errors.push(`${at("origin.source_type")} 为必填项：复用组件必须披露来源`);
      }
      if (!isNonEmptyString(p.modifications)) {
        errors.push(`${at("modifications")} 为必填项：复用组件必须披露修改情况（未修改也须显式声明）`);
      }
    }
  }

  if (type === "BUDGET_MILESTONE_SET") {
    if (typeof p.total_amount !== "number" || p.total_amount < 0) errors.push(`${at("total_amount")} 必须是非负数`);
    if (!Array.isArray(p.milestones) || p.milestones.length === 0) {
      errors.push(`${at("milestones")} 至少一个里程碑`);
    } else {
      p.milestones.forEach((m, i) => {
        for (const f of ["milestone_id", "name", "due_date"]) {
          if (!isNonEmptyString(m?.[f])) errors.push(`${at("milestones")}[${i}].${f} 为必填项`);
        }
        if (typeof m?.amount !== "number" || m.amount < 0) errors.push(`${at("milestones")}[${i}].amount 必须是非负数`);
      });
    }
  }

  if (type === "ACCESSIBILITY_REVIEWED") {
    if (!Array.isArray(p.scope_sections) || p.scope_sections.length === 0) {
      errors.push(`${at("scope_sections")} 不能为空：评估须标明覆盖范围`);
    }
  }

  if (type === "SCHOLAR_REVIEW_RECORDED") {
    if (!Array.isArray(p.scope_sections) || p.scope_sections.length === 0) {
      errors.push(`${at("scope_sections")} 不能为空：学术意见须标明针对的内容范围`);
    }
  }

  if (type === "SIMILARITY_FLAGGED") {
    if (typeof p.score !== "number" || p.score < 0 || p.score > 1) errors.push(`${at("score")} 必须在 0–1 之间`);
    if (!Array.isArray(p.compared_proposal_ids) || p.compared_proposal_ids.length === 0) {
      errors.push(`${at("compared_proposal_ids")} 至少一个对照方案`);
    }
    if (p.advisory_only !== true) {
      errors.push(`${at("advisory_only")} 必须为 true：系统只能提示雷同，不得自动判定抄袭`);
    }
  }

  if (type === "CHANGE_REQUESTED") {
    if (!Array.isArray(p.affected_sections) || p.affected_sections.length === 0) {
      errors.push(`${at("affected_sections")} 至少标明一个受影响部分`);
    } else {
      const sections = ["prototype", "component", "budget", "accessibility", "scholarly_content", "channel_scope", "venue", "schedule"];
      p.affected_sections.forEach((s, i) => {
        if (!sections.includes(s?.section_type)) errors.push(`${at("affected_sections")}[${i}].section_type 非法`);
        if (!isNonEmptyString(s?.summary)) errors.push(`${at("affected_sections")}[${i}].summary 为必填项`);
      });
    }
  }

  if (type === "CHANGE_REVIEWED") {
    for (const f of ["rereview_scope", "carried_review_ids"]) {
      if (!Array.isArray(p[f])) errors.push(`${at(f)} 必须是数组（没有重审/承继项时给空数组）`);
    }
    // 受影响部分重审与既有意见承继必须显式二选一落位，不能让意见悬空。
    if (Array.isArray(p.rereview_scope) && Array.isArray(p.carried_review_ids)) {
      const overlap = p.rereview_scope.filter((x) => p.carried_review_ids.includes(x));
      if (overlap.length) errors.push(`同一部分不能既重审又承继：${overlap.join("、")}`);
    }
  }

  if (type === "VISITOR_SIGNAL_RECORDED") {
    if (p.permitted_use !== "experience_improvement") {
      errors.push(`${at("permitted_use")} 必须为 experience_improvement：匿名互动只能用于改进体验`);
    }
    if (p.anonymous !== true) errors.push(`${at("anonymous")} 必须为 true`);
  }

  if (type === "CORRECTION_RECORDED") {
    if (!isNonEmptyString(p.predecessor_event_id)) errors.push(`${at("predecessor_event_id")} 为必填项`);
    if (!isNonEmptyString(p.reason)) errors.push(`${at("reason")} 为必填项`);
  }

  return errors;
}

/** 批量校验；返回 { valid, errors }。 */
export function validateEvents(records) {
  const all = [];
  for (const record of records) all.push(...validateEvent(record).map((e) => `${record.event_id ?? "?"}: ${e}`));
  return { valid: all.length === 0, errors: all };
}
