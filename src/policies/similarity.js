/**
 * 方案雷同提示策略。
 *
 * 重要边界：系统只能"提示"方案之间可能雷同，绝不自动判定抄袭。
 * 本模块只产出候选与相似度信号（SIMILARITY_FLAGGED），
 * 是否构成抄袭必须由人工评审通过 REVIEW_DECIDED（adjudicates_event_id 指向该提示）裁定。
 */

/** 中文/英文混合分词：抽取字符二元组与关键词，避免依赖外部分词库。 */
function features(text) {
  const normalized = String(text ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, "");
  const grams = new Set();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function proposalFingerprint(thesisEvent) {
  const p = thesisEvent?.payload ?? {};
  const text = [p.proposition, p.title, ...(p.keywords ?? []), ...(p.core_questions ?? [])]
    .filter(Boolean)
    .join(" ");
  return {
    proposition: features(p.proposition),
    whole: features(text),
    keywords: new Set((p.keywords ?? []).map((k) => String(k).toLowerCase())),
  };
}

/**
 * 计算一个命题与其他命题的雷同信号。
 * @returns 达到阈值的候选列表（按相似度降序），不给出任何是否抄袭的结论。
 */
export function findSimilarProposals(targetThesisEvent, otherThesisEvents, { threshold = 0.55 } = {}) {
  const target = proposalFingerprint(targetThesisEvent);
  const candidates = [];

  for (const other of otherThesisEvents) {
    if (other.event_id === targetThesisEvent.event_id) continue;
    const otherFp = proposalFingerprint(other);

    const propositionScore = jaccard(target.proposition, otherFp.proposition);
    const overallScore = jaccard(target.whole, otherFp.whole);
    const sharedKeywords = [...target.keywords].filter((k) => otherFp.keywords.has(k));
    const keywordScore =
      target.keywords.size === 0 ? 0 : sharedKeywords.length / target.keywords.size;

    // 综合分：命题正文权重最高，整体表述与关键词为辅。
    const score = propositionScore * 0.6 + overallScore * 0.25 + keywordScore * 0.15;

    if (score >= threshold) {
      candidates.push({
        other_proposal_id: other.payload?.proposal_id,
        other_thesis_event_id: other.event_id,
        other_title: other.payload?.title,
        score: Number(score.toFixed(3)),
        signals: {
          proposition: Number(propositionScore.toFixed(3)),
          overall: Number(overallScore.toFixed(3)),
          shared_keywords: sharedKeywords,
        },
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * 构造一条 SIMILARITY_FLAGGED 事件数据（不含信封版本号，由平台层补齐）。
 * 注意 note 明确声明这只是提示。
 */
export function buildSimilarityFlag(targetThesisEvent, candidates, threshold) {
  return {
    event_type: "SIMILARITY_FLAGGED",
    aggregate_type: "experience_proposal",
    summary: `发现 ${candidates.length} 个可能雷同的候选方案（仅提示，须人工裁定，不构成抄袭判定）`,
    payload: {
      proposal_id: targetThesisEvent.payload.proposal_id,
      threshold,
      candidates,
      note: "本记录为系统自动提示，不构成抄袭结论；是否雷同须由人工评审裁定。",
    },
  };
}

/** 一条雷同提示是否已被人工裁定。 */
export function isAdjudicated(flagEvent, decisions) {
  return decisions.some(
    (d) => d.event_type === "REVIEW_DECIDED" && d.payload?.adjudicates_event_id === flagEvent.event_id,
  );
}
