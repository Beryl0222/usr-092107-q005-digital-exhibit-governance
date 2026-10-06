/**
 * 变更影响范围的片段级计算（策略层与投影层共用）。
 *
 * 重审范围里的 "scholarly_content" / "accessibility" 是大类，
 * 但一条学术意见是否真的受影响，取决于它覆盖的片段（scope_sections）
 * 与变更申请中列明片段的交集——设备替换不应使覆盖其他片段的学术意见失效。
 */

/**
 * @returns {Set<string>|null}
 *   null 表示该大类不在重审范围内；
 *   含 "*" 的集合表示整类受影响（申请列明了该类但未注明具体片段）；
 *   否则为受影响片段 id 集合。
 */
export function sceneScopeAffected(change, rereviewScope, kind) {
  if (!rereviewScope.includes(kind)) return null;
  const sourceSections = kind === "scholarly_content" ? ["scholarly_content", "prototype"] : [kind];
  let wildcard = false;
  let anyEntry = false;
  const refs = new Set();
  for (const s of change.affected_sections ?? []) {
    if (!sourceSections.includes(s.section_type)) continue;
    anyEntry = true;
    if (s.ref) refs.add(s.ref);
    else wildcard = true;
  }
  if (wildcard || !anyEntry) return new Set(["*"]);
  return refs;
}

/** 意见覆盖片段是否与受影响集合相交。 */
export function opinionTouched(scopeSections, affectedSet) {
  if (affectedSet === null) return false;
  if (affectedSet.has("*")) return true;
  return (scopeSections ?? []).some((x) => x === "*" || affectedSet.has(x));
}
