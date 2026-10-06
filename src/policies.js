/**
 * 门禁与变更策略。全部为纯函数：输入投影读模型，输出阻断项 / 提示项。
 *
 * 设计原则：
 * - 系统只做可核对的机械判断与雷同"提示"；是否构成抄袭、学术意见是否成立，只能由人给出。
 * - 设备替换、延期等变更只重审受影响部分；重审范围之外的既有学术/无障碍意见必须显式承继，不得悬空。
 * - 开放后的匿名观众信号（state.signals）在本文件中没有任何通往"证据/事实"的代码路径。
 */
import {
  latestPrototype,
  latestBudget,
  channelCheck,
  stageDecision,
  changesOf,
  reviewLifecycle,
} from "./projections.js";
import { sceneScopeAffected, opinionTouched } from "./change-scope.js";

export const STAGE_ORDER = ["acceptance", "pre_release", "go_live"];

const SPECIAL_CHANNELS = {
  overseas_tour: { label: "海外巡展", requires_human: false },
  on_site_overlay: { label: "原址叠加", requires_human: true },
  ai_generated: { label: "AI 生成内容", requires_human: true },
};

/** 场所代码约定：PROPOSAL_CREATED.venues 使用地区代码（如 CN-BJ、FR-PAR）。 */
export function venueTerritory(venue) {
  return venue.includes("-") ? venue.split("-")[0] : venue;
}

// ---------------------------------------------------------------------------
// 变更影响矩阵
// ---------------------------------------------------------------------------

/**
 * 根据变更种类与申报方列明的受影响部分，计算"至少必须重审"的范围。
 * 申报方列明的部分全部进入范围；种类本身另有强制加项：
 * - content_revision 强制学术内容重审；
 * - overseas_extension 强制海外巡展使用范围核对；
 * - ai_scope_extension 强制 AI 使用范围核对 + 学术（人工复核生成内容）；
 * - venue_change 强制原址叠加渠道核对（如适用）。
 */
export function requiredRereviewScope(change, proposal) {
  const scope = new Set(change.affected_sections.map((s) => s.section_type));
  switch (change.change_kind) {
    case "content_revision":
      scope.add("scholarly_content");
      scope.add("prototype");
      break;
    case "overseas_extension":
      scope.add("channel_scope");
      scope.add("venue");
      break;
    case "ai_scope_extension":
      scope.add("channel_scope");
      scope.add("scholarly_content");
      break;
    case "venue_change":
      if (proposal.channels.includes("on_site_overlay")) scope.add("channel_scope");
      scope.add("venue");
      break;
    case "equipment_replacement":
      scope.add("component");
      break;
    case "schedule_delay":
      scope.add("schedule");
      break;
    case "budget_adjustment":
      scope.add("budget");
      break;
    default:
      break;
  }
  return [...scope];
}

/**
 * 校验变更重审决定本身是否合法（CHANGE_REVIEWED 写入前调用）。
 * 关键不变量：每条既有学术/无障碍意见必须显式"承继"或"失效"，二者恰居其一；
 * 落在重审范围内的意见不得承继（必须重做），范围之外的不得失效（没有东西触动它）。
 */
export function validateChangeDecision(change, proposal, state, decision) {
  const errors = [];
  const required = new Set(requiredRereviewScope(change, proposal));
  for (const section of required) {
    if (!decision.rereview_scope.includes(section)) {
      errors.push(`重审范围遗漏受影响部分：${section}（变更 ${change.change_id} 至少须重审 ${[...required].join("、")}）`);
    }
  }

  const lifecycle = reviewLifecycle(proposal, state);
  // 仅统计该变更提出之前已经存在的意见（按日志序号判定先后，不依赖时间戳精度）。
  const prior = [...lifecycle.values()].filter((info) => info.review.seq <= change.seq);
  const carried = new Set(decision.carried_review_ids);
  const invalidated = new Set(decision.invalidated_review_ids ?? []);

  for (const id of carried) {
    if (!lifecycle.has(id)) errors.push(`carried_review_ids 引用了不存在的意见：${id}`);
    if (invalidated.has(id)) errors.push(`意见 ${id} 既被承继又被失效，必须二选一`);
  }
  for (const id of invalidated) {
    if (!lifecycle.has(id)) errors.push(`invalidated_review_ids 引用了不存在的意见：${id}`);
  }

  for (const info of prior) {
    const id = info.review.review_id;
    // 是否真的受影响：重审大类与意见覆盖片段取交集（片段级判定）。
    const affectedSet = sceneScopeAffected(change, decision.rereview_scope, info.kind);
    const touched = opinionTouched(info.review.scope_sections, affectedSet);
    if (touched) {
      if (carried.has(id)) {
        errors.push(`意见 ${id} 覆盖的片段在重审范围内，不能原样承继，须重做后登记新意见`);
      }
      if (!invalidated.has(id)) {
        errors.push(`意见 ${id} 落入重审范围却未显式失效并安排重审，学术意见不得悬空`);
      }
    } else if (!carried.has(id)) {
      errors.push(`意见 ${id} 的覆盖部分不受本次变更影响，必须列入 carried_review_ids 显式承继，不得悬空`);
    }
  }

  if (decision.decision === "approved_with_conditions" && (decision.conditions ?? []).length === 0) {
    errors.push("附条件批准必须列明 conditions");
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 变更闭环：批准时要求的新材料是否到位
// ---------------------------------------------------------------------------

function affectedChannels(change) {
  const refs = change.affected_sections.filter((s) => s.section_type === "channel_scope").map((s) => s.ref).filter(Boolean);
  return refs.length ? refs : null; // 空表示方案全部渠道
}

/** 已批准变更要求重审的部分，新材料/新意见是否已补齐。 */
export function changeClosure(change, proposal, state) {
  const d = change.decision;
  const missing = [];
  if (!d || d.decision === "rejected") return { closed: true, missing };
  const decidedSeq = d.seq;

  const newPrototype = latestPrototype(proposal);
  const newBudget = latestBudget(proposal);

  for (const section of d.rereview_scope) {
    switch (section) {
      case "prototype":
        if (!newPrototype || newPrototype.seq <= decidedSeq) missing.push("变更后须重新提交交互原型版本");
        break;
      case "component":
        if (!proposal.components.some((c) => c.seq > decidedSeq)) {
          missing.push(`变更 ${change.change_id}：替换设备/组件须重新披露来源、修改与资质证据`);
        }
        break;
      case "budget":
        if (!newBudget || newBudget.seq <= decidedSeq) missing.push(`变更 ${change.change_id}：须重新登记预算里程碑`);
        break;
      case "accessibility":
        if (!proposal.accessibility_reviews.some((r) => r.seq > decidedSeq)) {
          missing.push(`变更 ${change.change_id}：须重做受影响部分的无障碍评估`);
        }
        break;
      case "scholarly_content":
        if (!proposal.scholar_reviews.some((r) => r.seq > decidedSeq)) {
          missing.push(`变更 ${change.change_id}：须重做受影响内容的学术审读`);
        }
        break;
      case "channel_scope": {
        const channels = affectedChannels(change) ?? proposal.channels;
        for (const ch of channels) {
          const check = channelCheck(proposal, ch);
          if (!check || check.seq <= decidedSeq) {
            missing.push(`变更 ${change.change_id}：渠道 ${ch} 须重新核对使用范围`);
          }
        }
        break;
      }
      case "venue":
      case "schedule":
        // 场所与排期本身在批准决定中留痕，条件满足即闭环。
        break;
      default:
        break;
    }
  }
  return { closed: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// 立项 / 上线门禁
// ---------------------------------------------------------------------------

function clearanceCovering(asset, proposal, channel, now) {
  return asset.clearances.find((c) => {
    if (c.proposal_id && c.proposal_id !== proposal.proposal_id) return false;
    if (!c.cleared) return false;
    const scope = c.scope ?? {};
    if (Array.isArray(scope.channels) && scope.channels.length && !scope.channels.includes(channel)) return false;
    if (scope.expires_at && new Date(scope.expires_at).getTime() < new Date(now).getTime()) return false;
    if (channel === "overseas_tour" && Array.isArray(scope.territories) && scope.territories.length) {
      const allowed = new Set(scope.territories);
      for (const venue of proposal.venues) {
        if (!allowed.has(venue) && !allowed.has(venueTerritory(venue))) return false;
      }
    }
    return true;
  });
}

/**
 * 评估方案当前状态能否进入某阶段。
 * @returns {{blockers: string[], advisories: string[], evidence: object}}
 */
export function evaluateProposal(state, proposalId, { now = new Date().toISOString() } = {}) {
  const blockers = [];
  const advisories = [];
  const proposal = state.proposals.get(proposalId);
  if (!proposal) return { blockers: [`方案不存在：${proposalId}`], advisories: [], evidence: {} };

  // 1) 独有的文化命题
  const thesis = state.theses.get(proposal.thesis_id);
  if (!thesis) blockers.push("缺少策展命题：每个方案必须先提出独有的文化命题");
  else if (thesis.withdrawn) blockers.push("策展命题已撤回");

  // 2) 交互原型与逐处出处
  const proto = latestPrototype(proposal);
  if (!proto) {
    blockers.push("尚未提交交互原型：评审人员须能从演示下钻到论证与数据出处");
  }

  // 3) 研究素材：登记 + 许可范围覆盖"该渠道实际呈现"的每个片段
  const lifecycle = reviewLifecycle(proposal, state);
  const assetCoverage = [];
  if (proto) {
    for (const channel of proposal.channels) {
      // AI 渠道只核对标注 ai_assisted 的片段；其余渠道核对全部演示片段。
      const scenesForChannel = channel === "ai_generated"
        ? proto.scenes.filter((s) => s.ai_assisted)
        : proto.scenes;
      for (const scene of scenesForChannel) {
        for (const citation of scene.asset_citations) {
          const asset = [...state.assets.values()].find((a) => a.asset_id === citation.asset_id);
          if (!asset) {
            blockers.push(`演示片段「${scene.title}」引用的素材 ${citation.asset_id} 未登记`);
            continue;
          }
          const clearance = clearanceCovering(asset, proposal, channel, now);
          if (!clearance) {
            blockers.push(
              `素材《${asset.title}》（${citation.asset_id}）缺少渠道 ${channel} 的有效许可：` +
                `演示片段「${scene.title}」无法在该渠道合法呈现`,
            );
          } else {
            assetCoverage.push({
              scene: scene.scene_id,
              asset_id: asset.asset_id,
              channel,
              license_document_ref: clearance.license_document_ref,
              expires_at: clearance.scope?.expires_at ?? null,
            });
          }
        }
      }
    }
  }

  // 4) 供应商组件：复用披露
  for (const c of proposal.components) {
    if (c.is_reuse && (!c.origin || !c.modifications)) {
      blockers.push(`复用组件「${c.name}」未完整披露来源与修改情况`);
    }
  }

  // 5) 预算里程碑
  const budget = latestBudget(proposal);
  if (!budget) {
    blockers.push("尚未登记预算与里程碑");
  } else {
    const sum = budget.milestones.reduce((acc, m) => acc + m.amount, 0);
    if (Math.abs(sum - budget.total_amount) > 0.001) {
      blockers.push(`预算里程碑金额合计 ${sum} 与总额 ${budget.total_amount} 不一致`);
    }
  }

  // 6) 无障碍：当前原型的每个片段都被"仍然有效"的评估覆盖
  if (proto) {
    const aliveA11y = [...lifecycle.values()].filter((i) => i.kind === "accessibility" && i.alive && !i.orphaned_by);
    const latestCovering = (sceneId) =>
      aliveA11y
        .filter((i) => i.review.scope_sections.includes(sceneId) || i.review.scope_sections.includes("*"))
        .reduce((acc, i) => (!acc || i.review.seq > acc.review.seq ? i : acc), null);
    for (const scene of proto.scenes) {
      const covering = latestCovering(scene.scene_id);
      if (!covering) {
        blockers.push(`演示片段「${scene.title}」缺少有效的无障碍评估覆盖`);
      } else if (covering.review.result === "fail") {
        blockers.push(`演示片段「${scene.title}」的无障碍评估结论为不通过`);
      }
    }
    // 附带条件提示以每条仍有效且未被更新评估取代的 conditional 为准。
    for (const info of aliveA11y) {
      if (info.review.result === "conditional" && info.review.conditions.length) {
        advisories.push(`无障碍评估（${info.review.review_id}）附带条件：${info.review.conditions.join("；")}`);
      }
    }
  }

  // 7) 学术审读：每个演示片段的论证都被"仍然有效"的学术意见覆盖；reject/revise 阻断。
  //    同一片段有多条意见时，以最新一条为准——重做后登记的新意见可以解除旧否定。
  if (proto) {
    const aliveScholar = [...lifecycle.values()].filter((i) => i.kind === "scholarly_content" && i.alive && !i.orphaned_by);
    const latestCovering = (sceneId) =>
      aliveScholar
        .filter((i) => i.review.scope_sections.includes(sceneId) || i.review.scope_sections.includes("*"))
        .reduce((acc, i) => (!acc || i.review.seq > acc.review.seq ? i : acc), null);
    for (const scene of proto.scenes) {
      const covering = latestCovering(scene.scene_id);
      if (!covering) {
        blockers.push(`演示片段「${scene.title}」的论证缺少有效的学术审读覆盖`);
      } else if (covering.review.verdict === "reject") {
        blockers.push(`演示片段「${scene.title}」被学术审读否定（${covering.review.review_id}）`);
      } else if (covering.review.verdict === "revise") {
        blockers.push(`演示片段「${scene.title}」学术审读要求修改后重审（${covering.review.review_id}）`);
      }
    }
  }
  for (const info of lifecycle.values()) {
    if (info.orphaned_by) blockers.push(`意见 ${info.review.review_id} 在变更 ${info.orphaned_by} 中悬空（既未承继也未重审）`);
  }

  // 8) 渠道专项：海外巡展、原址叠加、AI 生成内容分别核对
  const channelEvidence = {};
  for (const channel of proposal.channels) {
    const check = channelCheck(proposal, channel);
    if (!check) {
      blockers.push(`渠道 ${channel} 尚未完成使用范围核对`);
      continue;
    }
    channelEvidence[channel] = check;
    if (check.status === "rejected") blockers.push(`渠道 ${channel} 使用范围核对结论为不予通过`);
    if (check.status === "restricted") blockers.push(`渠道 ${channel} 使用范围受限：${(check.conditions ?? []).join("；") || "见核对记录"}`);
    if (check.status === "pending_human_review") blockers.push(`渠道 ${channel} 等待人工复核，不能放行`);

    const rule = SPECIAL_CHANNELS[channel];
    if (rule && check.status === "cleared" && rule.requires_human && !check.human_reviewed) {
      blockers.push(`${rule.label}（${channel}）必须留存人工复核，不能仅凭系统核对放行`);
    }
    if (channel === "overseas_tour" && check.status === "cleared") {
      const territories = check.scope?.territories ?? [];
      if (!territories.length) blockers.push("海外巡展核对须列明授权巡展的国家/地区范围");
      // 本土场所归 onsite 渠道核对，海外范围只校验境外场所。
      const onsite = channelCheck(proposal, "onsite");
      const homeTerritories = new Set(onsite?.scope?.territories ?? []);
      const overseasVenues = proposal.venues.filter((v) => !homeTerritories.has(venueTerritory(v)));
      for (const venue of overseasVenues) {
        if (!territories.includes(venue) && !territories.includes(venueTerritory(venue))) {
          blockers.push(`巡展场所 ${venue} 不在海外授权范围（${territories.join("、") || "未列明"}）内`);
        }
      }
    }
    if (channel === "ai_generated" && check.status === "cleared") {
      const verified = new Set(check.ai_output_disclosure?.human_verified_sections ?? []);
      if (proto) {
        for (const scene of proto.scenes.filter((s) => s.ai_assisted)) {
          if (!verified.has(scene.scene_id) && !verified.has("*")) {
            blockers.push(`AI 辅助生成的演示片段「${scene.title}」未经逐段人工核实`);
          }
        }
      }
      if (!check.ai_output_disclosure?.model_source) blockers.push("AI 渠道须披露模型来源与训练数据说明");
    }
  }

  // 9) 雷同提示：不阻断于"分数"，但必须经过人工裁定才能上会——系统从不自动判定抄袭
  for (const reportId of proposal.similarity_report_ids) {
    const report = state.reports.get(reportId);
    if (!report?.adjudication) {
      blockers.push(`雷同提示报告 ${reportId}（相似度 ${report?.score.toFixed(2)}）尚未人工裁定；系统只提示、不判定`);
    } else if (report.adjudication.disposition === "needs_revision") {
      blockers.push(`雷同提示报告 ${reportId} 被人工裁定为需要修改：${report.adjudication.rationale}`);
    } else if (report.adjudication.disposition === "plagiarism_concern_escalated") {
      blockers.push(`雷同提示报告 ${reportId} 已升级为抄袭关切复核，未结案前不得放行`);
    } else {
      advisories.push(`雷同提示报告 ${reportId} 已人工裁定为各自独立（${report.adjudication.rationale}）`);
    }
  }

  // 10) 变更闭环
  for (const change of changesOf(proposal, state)) {
    const closure = changeClosure(change, proposal, state);
    blockers.push(...closure.missing);
  }

  return {
    blockers,
    advisories,
    evidence: {
      thesis: thesis ? { title: thesis.title, cultural_claim: thesis.cultural_claim } : null,
      prototype: proto ? { version: proto.version, scene_count: proto.scenes.length } : null,
      asset_coverage: assetCoverage,
      channels: Object.keys(channelEvidence),
      signal_used_as_evidence: false, // 常量守卫：匿名互动永不进入历史事实/证据链
    },
  };
}

/** 阶段批准的顺序与前置门禁。 */
export function evaluateStage(state, proposalId, stage, opts = {}) {
  const result = evaluateProposal(state, proposalId, opts);
  const proposal = state.proposals.get(proposalId);
  if (proposal) {
    const idx = STAGE_ORDER.indexOf(stage);
    for (let i = 0; i < idx; i += 1) {
      const prior = stageDecision(proposal, STAGE_ORDER[i]);
      if (!prior || prior.decision !== "approved") {
        result.blockers.push(`阶段顺序：须先通过 ${STAGE_ORDER[i]}`);
      }
    }
    const current = stageDecision(proposal, stage);
    if (current?.decision === "approved") {
      // 已批准后只有出现新的"已审批变更"才允许再次确认（新版本放行）；
      // 没有变化时，决定不可原地改写。
      const laterChange = changesOf(proposal, state)
        .filter((c) => c.decision && c.decision.decision !== "rejected" && c.decision.seq > current.seq);
      if (!laterChange.length) {
        result.blockers.push(`阶段 ${stage} 已批准且此后无变更；决定不可原地改写，如需调整请先发起变更`);
      }
    }
  }
  return result;
}

/**
 * 新版本放行条件：除全量门禁外，go_live 决定必须晚于最近一次已审批变更——
 * 即任何变更（哪怕只换一台设备）在发布新版本前都由办公室再次确认过。
 */
export function evaluateRelease(state, proposalId, opts = {}) {
  const result = evaluateProposal(state, proposalId, opts);
  const proposal = state.proposals.get(proposalId);
  if (proposal) {
    const goLive = stageDecision(proposal, "go_live");
    if (goLive?.decision !== "approved") {
      result.blockers.push("上线前须通过 go_live 阶段批准");
    } else {
      const unconfirmedChange = changesOf(proposal, state)
        .filter((c) => c.decision && c.decision.decision !== "rejected" && c.decision.seq > goLive.seq);
      for (const c of unconfirmedChange) {
        result.blockers.push(`变更 ${c.change_id} 发生在最近一次上线批准之后，发布新版本前须重新确认 go_live`);
      }
    }
  }
  return result;
}
