/**
 * 开放后匿名互动数据治理。
 *
 * 硬边界：
 *  - 互动记录必须匿名（anonymous=true），不得含可识别个人信息；
 *  - 用途只能是 experience_improvement_only（改进体验）；
 *  - 互动数据不得被写成新的历史事实，也不得作为原型史实断言的证据；
 *  - 不得对匿名会话做再识别（re-identification）。
 *
 * 违规尝试不静默放行：生成 INTERACTION_PURPOSE_VIOLATION_DETECTED 事件留痕并拒绝该用途。
 */

const PERSONAL_KEYS = [
  "name", "real_name", "id_card", "phone", "email", "passport", "wechat", "face", "device_id",
];

const HISTORICAL_USE_HINTS = [
  "史实", "历史事实", "证明", "考证", "史料", "增补", "改写", "新证据", "histori", "fact", "evidence",
];

/** 校验一条互动采集是否满足匿名与用途限制。返回问题列表。 */
export function checkInteractionCaptured(event) {
  const errors = [];
  const p = event.payload ?? {};
  if (p.anonymous !== true) errors.push("互动记录必须匿名（anonymous=true）");
  if (p.usage_purpose !== "experience_improvement_only") {
    errors.push("互动数据用途只能是 experience_improvement_only");
  }
  // 深扫载荷，防止把个人信息夹带在 summary / 明细里。
  const json = JSON.stringify(p).toLowerCase();
  for (const key of PERSONAL_KEYS) {
    if (json.includes(`"${key}"`)) {
      errors.push(`互动记录疑似含可识别个人信息字段：${key}`);
    }
  }
  return errors;
}

/**
 * 审查"将互动数据用于某用途"的请求。
 * @param {{purpose:string, target?:string}} attempted
 * @returns {{allowed:boolean, attempted_use:string, reasons:string[]}}
 */
export function reviewInteractionUse(attempted) {
  const purpose = String(attempted?.purpose ?? "");
  const reasons = [];

  const looksHistorical = HISTORICAL_USE_HINTS.some((h) => purpose.includes(h));
  const wantsAsEvidence = /evidence|证据|claim|断言/.test(purpose) || attempted?.target === "historical_claim";

  if (looksHistorical || wantsAsEvidence) {
    reasons.push("开放互动数据只能用于改进体验，不得作为新的历史事实或史实证据");
    return { allowed: false, attempted_use: "historical_claim_evidence", reasons };
  }

  if (/re-?identif|实名|识别个人|画像/.test(purpose)) {
    reasons.push("不得对匿名互动数据做再识别或个人画像");
    return { allowed: false, attempted_use: "re_identification", reasons };
  }

  if (/improve|优化|改进体验|体验|动线|停留|可用性|usability/.test(purpose)) {
    return { allowed: true, attempted_use: "experience_improvement", reasons: [] };
  }

  reasons.push("未识别为体验改进用途，默认拒绝");
  return { allowed: false, attempted_use: "other", reasons };
}

/** 构造一条互动用途违规事件（由平台在拒绝用途时留痕）。 */
export function buildViolationEvent(proposalId, review) {
  return {
    event_type: "INTERACTION_PURPOSE_VIOLATION_DETECTED",
    aggregate_type: "interaction_record",
    summary: `检测到互动数据越界使用企图：${review.attempted_use}（已拒绝并留痕）`,
    payload: {
      proposal_id: proposalId,
      attempted_use: review.attempted_use,
      description: review.reasons.join("；"),
    },
  };
}

/**
 * 校验原型的史实断言证据链：证据必须来自 research_asset，
 * 且不得引用任何 interaction_record。
 * @param {Array<{claim_id:string, historical?:boolean, evidence:Array}>} claims
 * @param {Map<string, object>} assetIndex asset_id → 素材事件
 * @returns {Array<{claim_id:string, errors:string[]}>}
 */
export function checkClaimProvenance(claims, assetIndex) {
  const report = [];
  for (const claim of claims ?? []) {
    const errors = [];
    if (claim.historical !== false && (!claim.evidence || claim.evidence.length === 0)) {
      errors.push("史实断言必须提供证据链");
    }
    for (const [i, ev] of (claim.evidence ?? []).entries()) {
      const ref = ev.asset_id ?? ev.ref ?? ev.record_id;
      if (!ref) {
        errors.push(`证据[${i}] 缺少素材标识`);
        continue;
      }
      if (/^interaction|anon|session/i.test(ref)) {
        errors.push(`证据[${i}] 引用了互动数据（${ref}）：互动数据不得作为史实证据`);
        continue;
      }
      const asset = assetIndex.get(ref);
      if (!asset) {
        errors.push(`证据[${i}] 指向未登记素材：${ref}`);
      } else if (ev.content_hash && asset.payload?.content_hash && ev.content_hash !== asset.payload.content_hash) {
        errors.push(`证据[${i}] 内容指纹与登记素材不一致（${ref}）：演示须对得上测绘/图档/采集原件`);
      }
    }
    if (errors.length) report.push({ claim_id: claim.claim_id, errors });
  }
  return report;
}
