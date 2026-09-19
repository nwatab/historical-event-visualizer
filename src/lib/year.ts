import type { Year } from "@/types/event";

// 年は常に天文年方式の整数で扱う（紀元前1年 = 0、紀元前2年 = -1）。
// JavaScript の Date は紀元前や 0〜99 年の扱いが破綻するため使わない。

/** 「紀元前 n 年」を天文年に変換する。bce(1) === 0, bce(490) === -489。 */
export const bce = (n: number): Year => {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`bce() expects a positive integer, got ${n}`);
  }
  return 1 - n;
};

/** 天文年を表示用文字列にする。-499 → 「紀元前500年」、1687 → 「1687年」。 */
export const formatYear = (year: Year): string =>
  year <= 0 ? `紀元前${1 - year}年` : `${year}年`;

/** 整数に丸めたうえで [min, max] に収める。 */
export const clampYear = (year: number, min: Year, max: Year): Year =>
  Math.min(max, Math.max(min, Math.round(year)));

/** 期間を表示用文字列にする。(1347, 1351) → 「1347年〜1351年」。 */
export const formatYearRange = (start: Year, end: Year): string =>
  `${formatYear(start)}〜${formatYear(end)}`;
