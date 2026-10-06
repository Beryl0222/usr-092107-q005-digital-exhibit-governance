/**
 * 变更分级与局部重审策略。
 *
 * 核心规则：
 *  - 设备替换、延期等只重开"受影响部分"对应的门禁，未受影响部分的结论保持有效；
 *  - 未受影响的既有学术意见必须被显式沿用（carried_reviews），不能因变更而悬空；
 *  - 项目组据此明确知道"哪种变更必须重新审批"。
 *
 * 门禁：thesis source academic prototype components budget accessibility similarity special approval
 */

/**
 * 变更类别 → 需要重新审批的门禁与是否触发特殊核对。
 * affected_sections（展项部分）用于在该类别默认范围内再做裁剪。
 */

import { GATE_ORDER } from "../contracts.js";
export const CHANGE_IMPACT = {
  // 设备替换：只重验技术呈现与无障碍；命题、素材、学术结论不变。
  device_replacement: {
    reopenedGates: ["prototype", "accessibility"],
    requiresSpecial: [],
    reapprovalNeeded: true,
    label: "设备替换",
  },
  // 延期：默认无需学术重审；若涉及许可/特殊核对到期则由 affected_sections 触发。
  schedule_delay: {
    reopenedGates: ["budget"],
    requiresSpecial: ["license_expiry_check"],
    reapprovalNeeded: true,
    label: "延期",
  },
  budget_adjustment: {
    reopenedGates: ["budget"],
    requiresSpecial: [],
    reapprovalNeeded: true,
    label: "预算调整",
  },
  component_swap: {
    reopenedGates: ["components", "prototype", "accessibility"],
    requiresSpecial: [],
    reapprovalNeeded: true,
    label: "组件替换",
  },
  venue_change: {
    reopenedGates: ["accessibility", "special"],
    requiresSpecial: ["overseas_tour", "site_superposition"],
    reapprovalNeeded: true,
    label: "场地变化（含海外巡展/原址叠加）",
  },
  content_change: {
    reopenedGates: ["thesis", "source", "academic", "prototype", "similarity", "special", "approval"],
    requiresSpecial: ["ai_generated_content"],
    reapprovalNeeded: true,
    label: "内容修改",
  },
  aigc_addition: {
    reopenedGates: ["source", "academic", "prototype", "special", "approval"],
    requiresSpecial: ["ai_generated_content"],
    reapprovalNeeded: true,
    label: "新增AI生成内容",
  },
};

/** 各展项部分（section）→ 其论证所依赖的门禁。用于按 affected_sections 精确裁剪重审范围。 */
export const SECTION_GATES = {
  thesis_statement: ["thesis", "academic"],
  evidence_assets: ["source", "academic"],
  interaction_design: ["prototype", "accessibility"],
  device_stack: ["components", "prototype", "accessibility"],
  venue_install: ["accessibility", "special"],
  budget_schedule: ["budget"],
  narrative_content: ["thesis", "source", "academic", "prototype", "similarity", "special", "approval"],
};

/**
 * 计算一次变更需要重开的门禁集合。
 * @param {string} changeClass
 * @param {string[]} affectedSections 申报方声明的受影响展项部分
 * @returns {{reopenedGates: string[], requiresSpecial: string[], baseline: object}}
 */
export function planChangeReview(changeClass, affectedSections = []) {
  const baseline = CHANGE_IMPACT[changeClass];
  if (!baseline) {
    throw new Error(`未知变更类别：${changeClass}`);
  }

  // 以类别默认门禁为下限；再并入受影响部分显式依赖的门禁。
  const gates = new Set(baseline.reopenedGates);
  for (const section of affectedSections) {
    for (const gate of SECTION_GATES[section] ?? []) gates.add(gate);
  }

  // 延期但声明影响到内容/场地时，放宽到相应门禁，避免漏审。
  const orderedGates = GATE_ORDER.filter((g) => gates.has(g));
  return {
    reopenedGates: orderedGates,
    requiresSpecial: [...baseline.requiresSpecial],
    reapprovalNeeded: baseline.reapprovalNeeded || gates.size > 0,
    baseline,
  };
}

/**
 * 计算未受影响、应显式沿用的学术意见。
 * 学术意见不悬空：变更重开的门禁之外，针对 thesis/asset/prototype/section 的
 * 既有 ACADEMIC_REVIEW_RECORDED，凡目标不在重开范围内，都必须列入 carried_reviews。
 *
 * @param {object[]} academicReviews 既有学术审读事件
 * @param {string[]} reopenedGates 本次重开门禁
 * @param {Map<string, string[]>} targetGateIndex 审读 target_ref → 相关门禁（可由 affected sections 推导）
 * @returns {Array<{review_event_id:string, applies:true, note:string}>}
 */
export function carryForwardAcademicReviews(academicReviews, reopenedGates, targetGateIndex = new Map()) {
  const reopened = new Set(reopenedGates);
  const carried = [];

  for (const review of academicReviews) {
    if (review.event_type !== "ACADEMIC_REVIEW_RECORDED") continue;
    const gates = targetGateIndex.get(review.payload?.target_ref) ?? defaultReviewGates(review.payload?.target_kind);
    const touchesReopened = gates.some((g) => reopened.has(g));
    if (!touchesReopened) {
      carried.push({
        review_event_id: review.event_id,
        applies: true,
        note: `未受本次变更影响的${review.payload?.target_kind ?? ""}审读意见，继续有效`,
      });
    }
  }
  return carried;
}

function defaultReviewGates(targetKind) {
  switch (targetKind) {
    case "thesis":
      return ["thesis", "academic"];
    case "asset":
      return ["source", "academic"];
    case "prototype":
      return ["prototype", "academic"];
    case "section":
    default:
      return ["academic"];
  }
}

/** 变更是否完全不需要重新审批（例如纯文案笔误更正走后继更正记录，不产生重审）。 */
export function needsReapproval(changeClass, affectedSections = []) {
  return planChangeReview(changeClass, affectedSections).reapprovalNeeded;
}
