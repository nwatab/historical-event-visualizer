// SPARQL の行（1項目が複数行に展開されたもの）を、項目ごとにまとめる。純粋関数のみ。
import { parsePoint, parseYear, qidOf } from "./sparql.mjs";

/**
 * チャンクに保存する行。SPARQL の binding から必要な値だけ抜いたもの。
 * @typedef {{ qid: string, links: number, coord: string, prop: "P585" | "P580" | "P582",
 *   t: string, prec: number, p31?: string, ja?: string, en?: string }} Row
 */

/**
 * 結合後の項目。取得した値をそのまま持ち、開始年・分類・地域などの導出値は持たない
 * （analyze.mjs が都度計算する）。
 * @typedef {{ year: number, precision: number }} TimeValue
 * @typedef {{
 *   qid: string,
 *   labels: { ja?: string, en?: string },
 *   p31: readonly string[],
 *   coords: readonly { lon: number, lat: number }[],
 *   times: { P585: readonly TimeValue[], P580: readonly TimeValue[], P582: readonly TimeValue[] },
 *   sitelinks: number,
 *   roots: readonly string[],
 * }} RawItem
 */

/**
 * @param {Record<string, { value: string }>} b
 * @returns {Row}
 */
export const toRow = (b) => ({
  qid: qidOf(b.item.value),
  links: Number(b.links.value),
  coord: b.coord.value,
  prop: /** @type {Row["prop"]} */ (b.prop.value),
  t: b.t.value,
  prec: Number(b.prec.value),
  ...(b.p31 ? { p31: qidOf(b.p31.value) } : {}),
  ...(b.ja ? { ja: b.ja.value } : {}),
  ...(b.en ? { en: b.en.value } : {}),
});

/** @template T @param {readonly T[]} xs @param {(x: T) => string} key */
const uniqueBy = (xs, key) => [...new Map(xs.map((x) => [key(x), x])).values()];

/** @param {readonly Row[]} rows @param {Row["prop"]} prop @returns {TimeValue[]} */
const timesOf = (rows, prop) =>
  uniqueBy(
    rows
      .filter((r) => r.prop === prop)
      .map((r) => ({ year: parseYear(r.t), precision: r.prec }))
      .filter(/** @returns {t is TimeValue} */ (t) => t.year !== null),
    (t) => `${t.year}|${t.precision}`,
  ).sort((a, b) => a.year - b.year);

/**
 * @param {readonly { rootQid: string, rows: readonly Row[] }[]} chunks
 * @returns {RawItem[]} 地球上の座標を1つも持たない項目（月面など）は含めない
 */
export const mergeChunks = (chunks) => {
  const tagged = chunks.flatMap((c) => c.rows.map((row) => ({ row, rootQid: c.rootQid })));
  const groups = Map.groupBy(tagged, (x) => x.row.qid);
  return [...groups.entries()]
    .map(([qid, group]) => {
      const rows = group.map((x) => x.row);
      const first = rows[0];
      return {
        qid,
        labels: {
          ...(rows.find((r) => r.ja) ? { ja: rows.find((r) => r.ja)?.ja } : {}),
          ...(rows.find((r) => r.en) ? { en: rows.find((r) => r.en)?.en } : {}),
        },
        p31: [...new Set(rows.flatMap((r) => (r.p31 ? [r.p31] : [])))].sort(),
        coords: uniqueBy(
          rows.map((r) => parsePoint(r.coord)).filter((p) => p !== null),
          (p) => `${p.lon},${p.lat}`,
        ),
        times: { P585: timesOf(rows, "P585"), P580: timesOf(rows, "P580"), P582: timesOf(rows, "P582") },
        sitelinks: first.links,
        roots: [...new Set(group.map((x) => x.rootQid))].sort(),
      };
    })
    .filter((item) => item.coords.length > 0)
    .sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid));
};
