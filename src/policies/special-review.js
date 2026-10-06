/**
 * 特殊核对策略：海外巡展、原址叠加、AI 生成内容。
 *
 * 三类情形都必须：
 *  1) 逐项核对"使用范围"（地区/场地/期限/限制），且与素材许可范围一致；
 *  2) 经人工复核（human_reviewed=true，并记录复核人）；
 * 系统只做范围一致性检查与留痕，不替人下结论。
 */

import { ConstraintError } from "../store/event-store.js";

/** 方案声明涉及的情形 → 所需特殊核对类别。 */
export function requiredSpecialKinds(proposal) {
  const p = proposal ?? {};
  const kinds = [];
  if (p.involves_overseas_tour) kinds.push("overseas_tour");
  if (p.involves_site_superposition) kinds.push("site_superposition");
  if (p.involves_ai_generated) kinds.push("ai_generated_content");
  return kinds;
}

/**
 * 核对一条特殊核准记录是否满足要求。
 * @param {object} cleared SPECIAL_REVIEW_CLEARED 事件
 * @param {object} ctx { scope, assets } scope=申报使用范围；assets=相关素材许可
 * @returns {string[]} 问题列表；空数组表示通过范围一致性检查
 */
export function checkSpecialClearance(cleared, ctx = {}) {
  const errors = [];
  const p = cleared.payload ?? {};

  if (p.human_reviewed !== true || !p.human_reviewer) {
    errors.push(`${p.review_kind}：必须人工复核并记录复核人`);
  }
  if (p.verdict === undefined) {
    errors.push(`${p.review_kind}：缺少结论`);
  }
  if (p.verdict === "rejected") {
    return errors; // 已明确驳回，范围核对无意义
  }

  const usage = p.usage_scope ?? {};
  const requested = ctx.scope ?? {};

  if (p.review_kind === "overseas_tour") {
    // 申报巡展地区/场地必须全部落在核准范围内。
    for (const territory of requested.territories ?? []) {
      if (!(usage.territories ?? []).includes(territory)) {
        errors.push(`海外巡展：地区「${territory}」不在核准使用范围`);
      }
    }
    for (const venue of requested.venues ?? []) {
      if (!(usage.venues ?? []).includes(venue)) {
        errors.push(`海外巡展：场地「${venue}」不在核准使用范围`);
      }
    }
    checkValidity(usage, requested, errors, "海外巡展");
  }

  if (p.review_kind === "site_superposition") {
    if (!usage.sites || usage.sites.length === 0) {
      errors.push("原址叠加：必须核准具体原址点位");
    }
    for (const site of requested.sites ?? []) {
      if (!(usage.sites ?? []).includes(site)) {
        errors.push(`原址叠加：原址点位「${site}」不在核准范围`);
      }
    }
    // 原址叠加通常要求最小干预与可逆性约束。
    if (!usage.constraints || !usage.constraints.length) {
      errors.push("原址叠加：须记录最小干预/可逆性等现场约束");
    }
    checkValidity(usage, requested, errors, "原址叠加");
  }

  if (p.review_kind === "ai_generated_content") {
    if (usage.allowed_as_historical === true) {
      errors.push("AI 生成内容不得被核准为历史事实依据");
    }
    if (!usage.labeling_required) {
      errors.push("AI 生成内容须要求对公众显著标注");
    }
    if (!Array.isArray(usage.human_checkpoints) || usage.human_checkpoints.length === 0) {
      errors.push("AI 生成内容须设置人工复核检查点");
    }
  }

  // 素材许可范围必须覆盖申报使用范围。
  for (const asset of ctx.assets ?? []) {
    const clearedScope = asset.payload?.license_scope;
    if (p.review_kind === "overseas_tour" && clearedScope !== "overseas_tour") {
      errors.push(`素材 ${asset.payload?.title ?? asset.event_id} 未获海外巡展许可（当前：${clearedScope}）`);
    }
    if (p.review_kind === "site_superposition" && clearedScope !== "site_superposition" && clearedScope !== "overseas_tour") {
      errors.push(`素材 ${asset.payload?.title ?? asset.event_id} 未获原址叠加许可（当前：${clearedScope}）`);
    }
    if (asset.payload?.ai_generated === true && asset.payload?.human_reviewed !== true) {
      errors.push(`AI 生成素材 ${asset.payload?.title ?? asset.event_id} 缺少人工复核标记`);
    }
  }

  return errors;
}

function checkValidity(usage, requested, errors, label) {
  if (requested.until && usage.until) {
    if (new Date(requested.until) > new Date(usage.until)) {
      errors.push(`${label}：申报使用期限超出核准时限（核准至 ${usage.until}）`);
    }
  }
}

/** 平台用：声明需要的特殊核对是否都已具备且通过。 */
export function assertSpecialReviewsSatisfied(requiredKinds, clearances, ctxByKind) {
  const missing = [];
  const problems = [];
  for (const kind of requiredKinds) {
    const clearance = (clearances ?? []).find(
      (c) => c.payload?.review_kind === kind && c.payload?.verdict !== "rejected",
    );
    if (!clearance) {
      missing.push(kind);
      continue;
    }
    const errs = checkSpecialClearance(clearance, ctxByKind?.[kind] ?? {});
    if (errs.length > 0) problems.push(...errs);
  }
  if (missing.length || problems.length) {
    throw new ConstraintError("特殊核对未满足", {
      code: "special_review",
      details: [...missing.map((k) => `缺少特殊核对：${k}`), ...problems],
    });
  }
}
