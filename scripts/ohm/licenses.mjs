// OpenHistoricalMap の license タグの扱い（人が編集する表と、純粋関数）。
//
// 方針（2026-09-21、人の判断）: **CC0 と CC BY は受け入れ、SA（継承）と NC（非商用）は拒否する。**
// - CC BY の条件は表示だけで、利用者に何も課さない（CShapes を避けた理由は NC と SA のほうで、BY ではない）
// - 一部の way だけを落とすと線が途切れ、途切れた国境は「そこに境界が無い」という誤情報になる
// - 表示は、README の出典と凡例の注記の「© OpenHistoricalMap contributors（CC0 / CC BY 4.0）」
// 受け入れると決めていない値（SA / NC / 読めない値）が 1 つでもあれば、生成を止めて報告する。黙って落とさないし、黙って通さない。

/** 受け入れるライセンス（正規化した名前）。 */
export const ACCEPTED_LICENSES = ["CC0", "CC BY 4.0"];

/**
 * license タグの値 → 正規化した名前。表記ゆれだけを吸収する。読めない値は null（呼び出し側で止める）。
 * - タグ無しは、OHM の既定の CC0（https://www.openhistoricalmap.org/copyright）
 * - "CC0" / "CC0-1.0" / "CC0 / public domain" → "CC0"
 * - "CC-BY 4.0" / "CC-BY-4.0" / "CC BY 4.0" / "Creative Commons Attribution 4.0 International license" → "CC BY 4.0"
 * SA・NC・ND を含む値は、ここでは正規化しない（null になって止まる）。
 * @param {string | undefined} raw
 * @returns {string | null}
 */
export const normalizeLicense = (raw) => {
  if (raw === undefined) return "CC0";
  const value = raw.trim().toLowerCase();
  if (/\b(sa|nc|nd|sharealike|noncommercial|noderiv)/.test(value.replace(/[-_]/g, " "))) return null;
  if (/^cc0(-1\.0)?( \/ public domain)?$/.test(value)) return "CC0";
  if (/^cc[- ]by[- ]4\.0$/.test(value) || value === "creative commons attribution 4.0 international license") return "CC BY 4.0";
  return null;
};

/**
 * 人が確認して、受け入れる／拒否すると決めた「読めない値」（表記ゆれでは済まないもの）。
 * 値はタグの文字列そのまま。as は、受け入れる場合の正規化した名前（ACCEPTED_LICENSES のどれか）、拒否なら null。根拠を reason に書く。
 * @type {readonly { value: string, as: string | null, reason: string }[]}
 */
export const REVIEWED_LICENSE_VALUES = [];

/**
 * その値を受け入れるなら正規化した名前、拒否または未判断なら null。
 * @param {string | undefined} raw
 */
export const acceptedLicense = (raw) => {
  const reviewed = REVIEWED_LICENSE_VALUES.find((r) => r.value === raw);
  const normalized = reviewed ? reviewed.as : normalizeLicense(raw);
  return normalized !== null && ACCEPTED_LICENSES.includes(normalized) ? normalized : null;
};
