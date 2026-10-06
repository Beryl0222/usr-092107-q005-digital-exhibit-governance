/**
 * 方案雷同提示（advisory only）。
 *
 * 输出相似度分数与逐段匹配，仅供评审人员参考；
 * 平台任何路径都不会把分数映射成"抄袭"结论——成立与否只能人工裁定
 * （SIMILARITY_ADJUDICATED），且相似性事件的 advisory_only 恒为 true。
 */

const DEFAULT_THRESHOLD = 0.45;
const SEGMENT_THRESHOLD = 0.35;

/** 归一化：去除空白与标点，保留中英文与数字。 */
function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

/** 混合切词：连续 ASCII 词 + 非 ASCII 字符二元组（适配中文命题文本）。 */
function tokens(text) {
  const normalized = String(text ?? "").toLowerCase();
  const words = normalized.match(/[a-z0-9]{2,}/gu) ?? [];
  const cjk = normalize(normalized).replace(/[a-z0-9]+/g, " ");
  const grams = [];
  for (const run of cjk.split(/\s+/)) {
    for (let i = 0; i < run.length - 1; i += 1) grams.push(run.slice(i, i + 2));
    if (run.length === 1) grams.push(run);
  }
  return [...words, ...grams];
}

/** Jaccard 相似度 [0,1]。 */
export function jaccard(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function textSimilarity(a, b) {
  return jaccard(tokens(a), tokens(b));
}

/** 提取用于比对的命题与论证文本（不含素材版权信息、预算等商业字段）。 */
export function comparableSegments(state, proposal) {
  const thesis = state.theses.get(proposal.thesis_id);
  const segments = [];
  if (thesis) {
    segments.push({ segment: "命题表述", text: `${thesis.title} ${thesis.cultural_claim}` });
    if (thesis.keywords?.length) segments.push({ segment: "关键词", text: thesis.keywords.join(" ") });
  }
  const proto = proposal.prototypes.reduce((acc, x) => (!acc || x.version > acc.version ? x : acc), null);
  if (proto) {
    for (const scene of proto.scenes) {
      segments.push({ segment: `演示论证：${scene.title}`, text: `${scene.title} ${scene.claim}` });
    }
  }
  return segments;
}

/**
 * 对一个方案与其他方案做两两提示比对。
 * @returns {{compared_proposal_ids: string[], score: number, matched_segments: Array}} 或 null（无可比对文本）
 */
export function compareProposal(state, proposal, { threshold = DEFAULT_THRESHOLD } = {}) {
  const mine = comparableSegments(state, proposal);
  if (!mine.length) return null;

  let best = null;
  for (const other of state.proposals.values()) {
    if (other.proposal_id === proposal.proposal_id) continue;
    const theirs = comparableSegments(state, other);
    if (!theirs.length) continue;

    const matched = [];
    const scores = [];
    for (const a of mine) {
      for (const b of theirs) {
        const score = textSimilarity(a.text, b.text);
        if (score >= SEGMENT_THRESHOLD) {
          matched.push({ segment: `${a.segment} ↔ ${b.segment}`, score: Number(score.toFixed(3)) });
          scores.push(score);
        }
      }
    }
    if (!scores.length) continue;
    // 汇总分：匹配段均值与段覆盖率的折中，仅用于排序提示。
    const coverage = scores.length / mine.length;
    const score = Math.max(...scores) * 0.7 + Math.min(coverage, 1) * 0.3;
    if (!best || score > best.score) {
      best = {
        compared_proposal_ids: [other.proposal_id],
        score: Number(score.toFixed(3)),
        matched_segments: matched.sort((x, y) => y.score - x.score).slice(0, 8),
      };
    }
  }

  if (!best || best.score < threshold) return null;
  return best;
}

export { DEFAULT_THRESHOLD };
