/**
 * 决策链门禁的流转规则（纯策略，无存储副作用）。
 */

import { GATE_ORDER } from "../contracts.js";

/**
 * 是否允许对某门禁下人工结论。
 * 规则：
 *  - 门禁的就绪检查必须无阻塞（缺素材许可、证据不可溯源、雷同未裁定等不得通过）；
 *  - 批准/附条件通过要求前序门禁都已通过（决策链按序推进）；
 *  - 驳回始终允许（要能拦住问题方案）；
 *  - similarity 门禁的阻塞（雷同提示待裁定）由本次人工裁定本身解除：
 *    当本次决定通过 adjudicates_event_id 裁定了待裁定提示时即视为就绪。
 *
 * @param {string} gate
 * @param {string} verdict
 * @param {object} projection
 * @param {object} [opts]
 * @param {string} [opts.adjudicatesEventId] 本次决定所裁定的雷同提示事件
 * @returns {{allowed:boolean, reasons:string[]}}
 */
export function canDecideGate(gate, verdict, projection, { adjudicatesEventId } = {}) {
  const reasons = [];
  const gateState = projection.gates.get(gate);
  if (!gateState) return { allowed: false, reasons: [`未知门禁：${gate}`] };

  if (verdict !== "rejected") {
    let blockers = gateState.blockers;

    if (gate === "similarity" && adjudicatesEventId) {
      // 本次人工裁定将解除对应提示；其余未裁定提示仍然阻塞。
      const stillPending = projection.similarityFlags.filter(
        (s) => s.adjudicatedBy.length === 0 && s.flag.event_id !== adjudicatesEventId,
      );
      if (stillPending.length === 0) blockers = [];
      else blockers = stillPending.map((s) => `雷同提示 ${s.flag.event_id} 仍待人工裁定`);
    }

    if (gateState.state === "reopened_pending") {
      if (blockers.length > 0) reasons.push(`重开的门禁仍有未决问题：${blockers.join("；")}`);
    } else if (blockers.length > 0) {
      reasons.push(`门禁尚未就绪：${blockers.join("；")}`);
    }

    const idx = GATE_ORDER.indexOf(gate);
    for (const prior of GATE_ORDER.slice(0, idx)) {
      if (projection.gates.get(prior).state !== "approved") {
        reasons.push(`前序门禁「${prior}」尚未通过`);
      }
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

/** 上线前最终检查：所有门禁（含 approval）均 approved。 */
export function canRelease(projection) {
  return projection.releaseReady.ready
    ? { allowed: true, reasons: [] }
    : {
        allowed: false,
        reasons: projection.releaseReady.notApproved.map(
          (n) => `门禁 ${n.gate} 状态 ${n.state}${n.blockers.length ? `：${n.blockers.join("；")}` : ""}`,
        ),
      };
}
