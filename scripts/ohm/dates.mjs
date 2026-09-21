// OpenHistoricalMap の日付（start_date / end_date）の解釈。純粋関数のみ。
//
// OHM の日付は ISO 8601 の文字列（"1803-04-30"、"1905"、"-0500"）で、先発グレゴリオ暦の年をそのまま書く:
// 紀元前 1 年が "0000"、紀元前 2 年が "-0001"（OSM Wiki「OpenHistoricalMap/Tags/Key/start_date」、2026-09-21 に API で取得して確認）。
// つまり、すでに天文年なので、年の部分をそのまま整数にする。bce() は通さない（通すと 1 年ずれる。CLAUDE.md「年の扱い」の SPARQL と同じ）。
// JavaScript の Date は使わない。

/**
 * 日付の文字列 → 天文年の整数。読めなければ null。
 * @param {string | undefined} value
 * @returns {number | null}
 */
export const parseOhmYear = (value) => {
  const m = /^\s*(-?)(\d{1,4})(?:-\d{2}(?:-\d{2})?)?\s*$/.exec(value ?? "");
  return m ? Number(m[2]) * (m[1] === "-" ? -1 : 1) : null;
};

/**
 * 国境を出す期間 [yearMin, yearMax] に存在する relation か。start は必須（読めなければ対象外）。
 * 依頼の条件: start_date < yearMax + 1 かつ（end_date が無い、または end_date ≥ yearMin）。
 * @param {{ start_date?: string, end_date?: string }} tags @param {number} yearMin @param {number} yearMax
 */
export const inBorderPeriod = (tags, yearMin, yearMax) => {
  const start = parseOhmYear(tags.start_date);
  if (start === null || start > yearMax) return false;
  if (tags.end_date === undefined) return true;
  const end = parseOhmYear(tags.end_date);
  return end !== null && end >= yearMin;
};
