// OpenHistoricalMap の license タグの扱い（人が編集する表と、純粋関数）。
//
// 方針（2026-09-21、人の判断）: **CC0 と CC BY は受け入れ、SA（継承）と NC（非商用）は拒否する。**
// - CC BY の条件は表示だけで、利用者に何も課さない（CShapes を避けた理由は NC と SA のほうで、BY ではない）
// - 一部の way だけを落とすと線が途切れ、途切れた国境は「そこに境界が無い」という誤情報になる
// - 表示は、README の出典（内訳つき）と、凡例の注記の「出典: OpenHistoricalMap（CC0 / CC BY）」
// 受け入れると決めていない値（SA / NC / 読めない値）が 1 つでもあれば、生成を止めて報告する。黙って落とさないし、黙って通さない。

/**
 * 受け入れるライセンス（正規化した名前）。どれも、条件は表示だけ（SA・NC を含まない）。
 * "CC BY-IGO" と "CC BY"（版の番号が分からないもの）は、タグの値からは正規化されない。人が確認した値（REVIEWED_LICENSE_VALUES）だけが、この名前になる。
 */
export const ACCEPTED_LICENSES = ["CC0", "CC BY 4.0", "CC BY-IGO", "CC BY"];

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
export const REVIEWED_LICENSE_VALUES = [
  {
    value: "CCO 4.0",
    as: "CC BY-IGO",
    reason:
      "受け入れる（2026-09-21、人の判断）。O はアルファベットで、編集者の書き間違いとみられる。この値を持つ way（国境に使われている 105 本。ペルー・エクアドル・コロンビアと、南アフリカ周辺）の出典タグ" +
      "（source / source:geometry）は、HDX の https://data.humdata.org/dataset/cod-ab-ecu と cod-ab-zaf だけ。HDX の API（/api/3/action/package_show）で 2026-09-21 に確かめると、" +
      "どちらのデータセットも license_id が cc-by-igo（Creative Commons Attribution for Intergovernmental Organisations）だった（cod-ab-per / cod-ab-col / cod-ab-moz も同じ）。" +
      "CC BY-IGO の条件は表示で、SA・NC を含まない。README の出典に「HDX（CC BY-IGO）」と書く。",
  },
  {
    value: "CC-BY (NLS): Reproduced with the permission of the National Library of Scotland",
    as: "CC BY",
    reason:
      "受け入れる（2026-09-21、人の判断）。値そのものが CC BY だと言っている（版の番号は書かれていない）。この値を持つ way は 21 本で、イングランドとスコットランドの国境。" +
      "source タグは、スコットランド国立図書館（NLS）の陸地測量部地図（OS 25-inch / 6-inch）。NLS の側の利用条件のページは確かめていない（タグの値だけが根拠）。" +
      "README の出典に「National Library of Scotland（CC BY）」と書く。",
  },
];

/**
 * その値を受け入れるなら正規化した名前、拒否または未判断なら null。
 * @param {string | undefined} raw
 */
export const acceptedLicense = (raw) => {
  const reviewed = REVIEWED_LICENSE_VALUES.find((r) => r.value === raw);
  const normalized = reviewed ? reviewed.as : normalizeLicense(raw);
  return normalized !== null && ACCEPTED_LICENSES.includes(normalized) ? normalized : null;
};
