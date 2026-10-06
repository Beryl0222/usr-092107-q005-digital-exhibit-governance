/**
 * 数字文化展项立项台领域事件信封与事件目录。
 *
 * 一条决策链上的所有动作都以不可变事件保存：
 * 策展命题 → 研究素材许可 → 交互原型（逐处出处）→ 供应商组件披露 →
 * 预算里程碑 → 无障碍评估 / 学术审读 → 渠道使用范围核对 →
 * 阶段批准 → 变更请求与局部重审 → 上线版本 → 匿名观众信号。
 *
 * 记录一经接收，event_id / occurred_at / version 不得原地改写；
 * 更正只能追加 CORRECTION_RECORDED 后继记录。
 */

export type Channel = "onsite" | "overseas_tour" | "on_site_overlay" | "online" | "ai_generated";

export type ActorRole = "applicant" | "reviewer" | "board" | "system" | "anonymous";

export interface Actor {
  id: string;
  role: ActorRole;
  display_name?: string;
  org?: string;
}

export interface Scope {
  territories?: string[];
  channels?: Channel[];
  purposes?: string[];
  expires_at?: string | null;
  restrictions?: string[];
}

export type Certainty = "measured" | "documented" | "inferred";

export interface AssetCitation {
  asset_id: string;
  locator: string;
  usage: string;
  interpretation?: string;
  certainty?: Certainty;
}

export interface DemoScene {
  scene_id: string;
  title: string;
  claim: string;
  asset_citations: AssetCitation[];
  ai_assisted?: boolean;
}

export type AssetKind =
  | "archaeological_survey"
  | "architectural_archive"
  | "sound_recording"
  | "field_notes"
  | "other";

export type ReviewVerdict = "endorse" | "revise" | "reject";
export type AccessibilityResult = "pass" | "conditional" | "fail";
export type ChannelStatus = "cleared" | "restricted" | "rejected" | "pending_human_review";

export type ChangeKind =
  | "equipment_replacement"
  | "schedule_delay"
  | "content_revision"
  | "venue_change"
  | "overseas_extension"
  | "ai_scope_extension"
  | "budget_adjustment";

export type SectionType =
  | "prototype"
  | "component"
  | "budget"
  | "accessibility"
  | "scholarly_content"
  | "channel_scope"
  | "venue"
  | "schedule";

export type StageGate = "acceptance" | "pre_release" | "go_live" | "none";
export type Stage = Exclude<StageGate, "none">;

export type EventType =
  | "THESIS_SUBMITTED"
  | "THESIS_WITHDRAWN"
  | "PROPOSAL_CREATED"
  | "ASSET_REGISTERED"
  | "SOURCE_CLEARED"
  | "PROTOTYPE_SUBMITTED"
  | "COMPONENT_DECLARED"
  | "BUDGET_MILESTONE_SET"
  | "ACCESSIBILITY_REVIEWED"
  | "SCHOLAR_REVIEW_RECORDED"
  | "CHANNEL_SCOPE_CHECKED"
  | "SIMILARITY_FLAGGED"
  | "SIMILARITY_ADJUDICATED"
  | "CHANGE_REQUESTED"
  | "CHANGE_REVIEWED"
  | "STAGE_APPROVED"
  | "VERSION_RELEASED"
  | "VISITOR_SIGNAL_RECORDED"
  | "CORRECTION_RECORDED";

export type AggregateType =
  | "curatorial_thesis"
  | "research_asset"
  | "experience_proposal"
  | "prototype"
  | "supplier_component"
  | "budget"
  | "accessibility_review"
  | "scholarly_review"
  | "channel_clearance"
  | "similarity_report"
  | "change_request"
  | "approval_decision"
  | "release"
  | "visitor_signal";

/**
 * 各事件类型对应的聚合类型（见 contracts/domain.schema.json 的 if/then 约束）。
 * CORRECTION_RECORDED 可更正任意聚合的事件，其 aggregate_type 与被更正事件一致，故值为 "*"。
 */
export const AGGREGATE_FOR_EVENT: Record<EventType, AggregateType | "*"> = {
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
  CORRECTION_RECORDED: "approval_decision",
};

/** 事件专有字段。键与 EventType 一一对应。 */
export interface EventPayloads {
  THESIS_SUBMITTED: {
    title: string;
    cultural_claim: string;
    research_questions?: string[];
    keywords?: string[];
    submitter_id?: string;
  };
  THESIS_WITHDRAWN: { reason: string };
  PROPOSAL_CREATED: {
    proposal_id: string;
    thesis_id: string;
    title: string;
    channels: Channel[];
    venues?: string[];
    lead_org?: string;
  };
  ASSET_REGISTERED: {
    asset_id: string;
    kind: AssetKind;
    title: string;
    citation: string;
    holding_institution?: string;
    custodian_contact?: string;
    provenance_note?: string;
    acquired_at?: string;
  };
  SOURCE_CLEARED: {
    asset_id: string;
    proposal_id?: string;
    scope: Scope;
    cleared: boolean;
    license_document_ref?: string;
    limitations?: string[];
    reviewer_id?: string;
  };
  PROTOTYPE_SUBMITTED: {
    proposal_id: string;
    prototype_version: number;
    artifact_ref?: string;
    demo_scenes: DemoScene[];
  };
  COMPONENT_DECLARED: {
    proposal_id: string;
    component_id?: string;
    name: string;
    supplier_id?: string;
    is_reuse: boolean;
    origin?: {
      source_type: "mature_product" | "internal_prior" | "open_source" | "market_new";
      upstream_name?: string;
      upstream_version?: string;
      license?: string;
    };
    /** 成熟组件复用时必须披露来源与修改；无修改也要显式写"未修改"。 */
    modifications?: string;
    qualification_evidence_ref?: string;
  };
  BUDGET_MILESTONE_SET: {
    proposal_id: string;
    currency: string;
    total_amount: number;
    milestones: {
      milestone_id: string;
      name: string;
      amount: number;
      due_date: string;
      deliverable?: string;
      stage_gate?: StageGate;
    }[];
  };
  ACCESSIBILITY_REVIEWED: {
    proposal_id: string;
    review_id?: string;
    standard?: string;
    result: AccessibilityResult;
    scope_sections: string[];
    findings?: { area: string; severity?: "low" | "medium" | "high"; finding: string }[];
    conditions?: string[];
    reviewer_org?: string;
  };
  SCHOLAR_REVIEW_RECORDED: {
    proposal_id: string;
    review_id: string;
    verdict: ReviewVerdict;
    opinion: string;
    scope_sections: string[];
    reviewed_prototype_version?: number;
    conditions?: string[];
    reviewer_id?: string;
    reviewer_display_name?: string;
    reviewer_org?: string;
  };
  CHANNEL_SCOPE_CHECKED: {
    proposal_id: string;
    channel: Exclude<Channel, never>;
    status: ChannelStatus;
    scope?: Scope;
    human_reviewed?: boolean;
    human_reviewer_id?: string;
    review_note?: string;
    ai_output_disclosure?: {
      model_source?: string;
      training_data_note?: string;
      human_verified_sections?: string[];
    };
    conditions?: string[];
  };
  SIMILARITY_FLAGGED: {
    proposal_id: string;
    compared_proposal_ids: string[];
    score: number;
    matched_segments?: { segment: string; score: number }[];
    /** 永远为 true：系统只提示雷同，不自动判定抄袭。 */
    advisory_only: true;
  };
  SIMILARITY_ADJUDICATED: {
    report_id: string;
    proposal_id?: string;
    disposition: "distinct" | "needs_revision" | "plagiarism_concern_escalated";
    rationale: string;
    adjudicator_id?: string;
  };
  CHANGE_REQUESTED: {
    proposal_id: string;
    change_id: string;
    change_kind: ChangeKind;
    affected_sections: { section_type: SectionType; ref?: string; summary: string }[];
    justification: string;
    requested_by?: string;
  };
  CHANGE_REVIEWED: {
    change_id: string;
    proposal_id: string;
    decision: "approved" | "approved_with_conditions" | "rejected";
    rereview_scope: SectionType[];
    carried_review_ids: string[];
    invalidated_review_ids?: string[];
    conditions?: string[];
    note?: string;
    reviewer_id?: string;
  };
  STAGE_APPROVED: {
    proposal_id: string;
    stage: Stage;
    decision: "approved" | "rejected";
    conditions?: string[];
    board_id?: string;
    note?: string;
  };
  VERSION_RELEASED: {
    proposal_id: string;
    release_id: string;
    version: string;
    artifact_ref: string;
    based_on_change_ids?: string[];
    prototype_version?: number;
    release_notes?: string;
    approver_id?: string;
  };
  VISITOR_SIGNAL_RECORDED: {
    release_id: string;
    signal_kind: "interaction_path" | "dwell_time" | "rating" | "free_text" | "accessibility_usage";
    permitted_use: "experience_improvement";
    anonymous: true;
    summary_text?: string;
  };
  CORRECTION_RECORDED: {
    predecessor_event_id: string;
    reason: string;
    correction?: Record<string, unknown>;
  };
}

export interface DomainEvent<T extends EventType = EventType> {
  event_id: string;
  event_type: T;
  aggregate_type: AggregateType;
  aggregate_id: string;
  occurred_at: string;
  version: number;
  summary: string;
  payload: T extends keyof EventPayloads ? EventPayloads[T] : Record<string, unknown>;
  actor?: Actor;
  predecessor_event_id?: string;
}
