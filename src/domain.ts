/** 数字文化展项立项台使用的领域事件信封与事件目录。 */

/** 字段密级：读模型按调用方角色脱敏。 */
export type Classification = "personal" | "institutional" | "commercial";

/** 事件类型目录。 */
export type EventType =
  | "THESIS_SUBMITTED"
  | "THESIS_REVISED"
  | "SOURCE_REGISTERED"
  | "SOURCE_CLEARED"
  | "ACADEMIC_REVIEW_RECORDED"
  | "PROPOSAL_CREATED"
  | "PROTOTYPE_SUBMITTED"
  | "COMPONENT_REGISTERED"
  | "COMPONENT_DECLARED"
  | "BUDGET_MILESTONE_SET"
  | "ACCESSIBILITY_ASSESSED"
  | "SIMILARITY_FLAGGED"
  | "SPECIAL_REVIEW_CLEARED"
  | "REVIEW_REQUESTED"
  | "REVIEW_DECIDED"
  | "CHANGE_REQUESTED"
  | "CHANGE_REVIEWED"
  | "VERSION_RELEASED"
  | "VERSION_WITHDRAWN"
  | "INTERACTION_CAPTURED"
  | "INTERACTION_PURPOSE_VIOLATION_DETECTED";

/** 聚合类型目录。 */
export type AggregateType =
  | "curatorial_thesis"
  | "research_asset"
  | "experience_proposal"
  | "approval_decision"
  | "change_request"
  | "reused_component"
  | "interaction_record";

/** 评审门禁：决策链上的每个关口。 */
export type Gate =
  | "thesis"
  | "source"
  | "academic"
  | "prototype"
  | "components"
  | "budget"
  | "accessibility"
  | "similarity"
  | "special"
  | "approval";

/** 变更类别：决定重开哪些门禁。 */
export type ChangeClass =
  | "device_replacement"
  | "schedule_delay"
  | "budget_adjustment"
  | "component_swap"
  | "venue_change"
  | "content_change"
  | "aigc_addition";

/** 特殊核对类别。 */
export type SpecialReviewKind =
  | "overseas_tour"
  | "site_superposition"
  | "ai_generated_content";

/** 素材类别：可追溯到考古测绘、建筑图档、声音采集与学术审读。 */
export type ResearchAssetKind =
  | "archaeological_survey"
  | "architectural_drawing"
  | "sound_recording"
  | "scholarly_material"
  | "other";

export interface EventActor {
  id?: string;
  role?: string;
}

/** 领域事件信封。记录一经接收，event_id / occurred_at / version 不得原地改写。 */
export interface DomainEvent {
  event_id: string;
  event_type: EventType;
  aggregate_type: AggregateType;
  aggregate_id: string;
  occurred_at: string;
  version: number;
  summary: string;
  payload?: Record<string, unknown>;
  actor?: EventActor;
  /** 后继更正记录指向被更正事件；被更正记录保留不删改。 */
  supersedes_event_id?: string;
}

/** 原型中的每条演示断言及其证据链。 */
export interface PrototypeClaim {
  claim_id: string;
  statement: string;
  /** 证据只能来自 research_asset；互动数据不得作为史实证据。 */
  evidence: Array<{ asset_id: string; content_hash?: string; locator?: string }>;
  /** 哪些是可被写成史实的断言，哪些只是体验呈现。 */
  historical: boolean;
}

/** 变更评审对既有学术意见的沿用条目（不悬空）。 */
export interface CarriedReview {
  review_event_id: string;
  applies: boolean;
  note?: string;
}

/** 事件类型到聚合类型的归属约定。 */
export const EVENT_AGGREGATE: Record<EventType, AggregateType> = {
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

export const EVENT_TYPES: readonly EventType[] = Object.keys(
  EVENT_AGGREGATE,
) as EventType[];
