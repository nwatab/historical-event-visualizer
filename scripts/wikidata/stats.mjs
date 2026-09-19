// 集計用の小さな純粋関数。

/**
 * 分位点。線形補間（R の type 7、NumPy の既定と同じ）。
 * @param {readonly number[]} sortedAsc 昇順に並んだ値
 * @param {number} p 0〜1
 */
export const quantileSorted = (sortedAsc, p) => {
  if (sortedAsc.length === 0) return NaN;
  const h = (sortedAsc.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (h - lo);
};

/** @param {readonly number[]} values */
export const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0] ?? NaN,
    q1: quantileSorted(sorted, 0.25),
    median: quantileSorted(sorted, 0.5),
    q3: quantileSorted(sorted, 0.75),
    p90: quantileSorted(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? NaN,
  };
};

/**
 * @template T
 * @param {readonly T[]} xs
 * @param {(x: T) => string} key
 * @returns {Map<string, number>} 件数の多い順
 */
export const countBy = (xs, key) =>
  new Map(
    [...Map.groupBy(xs, key).entries()]
      .map(([k, group]) => /** @type {[string, number]} */ ([k, group.length]))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );

/**
 * 下限の並びで区切ったヒストグラム。bins[i] 以上 bins[i+1] 未満。最後の区間は上限なし。
 * @param {readonly number[]} values
 * @param {readonly number[]} lowerBounds 昇順
 * @returns {{ from: number, to: number | null, count: number }[]}
 */
export const histogram = (values, lowerBounds) =>
  lowerBounds.map((from, i) => {
    const to = lowerBounds[i + 1] ?? null;
    return { from, to, count: values.filter((v) => v >= from && (to === null || v < to)).length };
  });

/** @param {number} part @param {number} whole */
export const percent = (part, whole) => (whole === 0 ? "–" : `${((part / whole) * 100).toFixed(1)}%`);

/** @param {number} x 分位点の表示用。整数ならそのまま、そうでなければ小数1桁。 */
export const fmt = (x) => (Number.isNaN(x) ? "–" : Number.isInteger(x) ? String(x) : x.toFixed(1));

/**
 * Markdown の表。
 * @param {readonly string[]} header
 * @param {readonly (readonly (string | number)[])[]} rows
 * @param {readonly ("l" | "r")[]} [align]
 */
export const mdTable = (header, rows, align = []) =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map((_, i) => ((align[i] ?? (i === 0 ? "l" : "r")) === "r" ? "---:" : "---")).join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
