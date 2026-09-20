// importance（1〜3）。純粋関数のみ。
//
// 規則（R4b-1 で試算し、R4b-2 で「由来別に取る」と決めた）:
//   1. 年代を5区分に分け、区分ごとに sitelinks の順位で 上位 5% → 3、上位 25% → 2、それ以外 → 1。
//      母集団は由来別（P31 で分類した項目／Vital articles の節で分類した項目）に分ける。分けるのは呼び出し側（analyze.mjs）。
//   2. 会戦は、P361 を辿って親の戦争が見つかった場合、上限を 2 にする（戦争が主、会戦は従）。
//      化学元素も上限を 2 にする（R4d）。元素の記事は sitelinks が一様に高く（中央値 150 前後）、
//      Vital articles で分類した項目の上位 5% を元素の「発見」が占めてしまうため。
//   3. Vital articles 由来の項目は、リストにある時点で選抜済みなので、最低 2 にする。
//
// 「上位 5%」は、区分内の sitelinks の 95% 点（線形補間）以上、として判定する。
// 同じ sitelinks の項目は同じ扱いにしたいので、件数ではなく値で切る。このため 3 の割合は 5% を少し超えることがある。
import { quantileSorted } from "./stats.mjs";

export const ERAS = Object.freeze(["〜499", "500〜1499", "1500〜1799", "1800〜1899", "1900〜"]);

/** @param {number} year 天文年 */
export const eraOfYear = (year) =>
  year < 500 ? ERAS[0] : year < 1500 ? ERAS[1] : year < 1800 ? ERAS[2] : year < 1900 ? ERAS[3] : ERAS[4];

/**
 * @param {readonly { year: number, sitelinks: number }[]} items
 * @returns {Record<string, { n: number, top5: number, top25: number }>} 年代区分ごとの閾値
 */
export const importanceThresholds = (items) =>
  Object.fromEntries(
    ERAS.map((era) => {
      const sorted = items
        .filter((i) => eraOfYear(i.year) === era)
        .map((i) => i.sitelinks)
        .sort((a, b) => a - b);
      return [era, { n: sorted.length, top5: quantileSorted(sorted, 0.95), top25: quantileSorted(sorted, 0.75) }];
    }),
  );

/**
 * @param {{ year: number, sitelinks: number, cappedAt2: boolean, vital: boolean }} item cappedAt2 は上限 2 の対象（親の戦争がある会戦、化学元素）
 * @param {ReturnType<typeof importanceThresholds>} thresholds
 * @returns {{ importance: 1 | 2 | 3, base: 1 | 2 | 3 }} base は規則 1 だけで決めた値
 */
export const importanceOf = (item, thresholds) => {
  const t = thresholds[eraOfYear(item.year)];
  const base = item.sitelinks >= t.top5 ? 3 : item.sitelinks >= t.top25 ? 2 : 1;
  const capped = item.cappedAt2 ? Math.min(base, 2) : base;
  const floored = item.vital ? Math.max(capped, 2) : capped;
  return { importance: /** @type {1 | 2 | 3} */ (floored), base };
};
