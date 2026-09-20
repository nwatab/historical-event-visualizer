// SPARQL の行（1項目が複数行に展開されたもの）を、項目ごとにまとめる。純粋関数のみ。
import { parsePoint, parseYear, qidOf } from "./sparql.mjs";

/**
 * チャンクに保存する行。SPARQL の binding から必要な値だけ抜いたもの。
 * coord は war のクエリでは無いことがある。parent（P361）は engagement / war のクエリだけが返す。
 * @typedef {{ qid: string, links: number, coord?: string, prop: "P585" | "P580" | "P582",
 *   t: string, prec: number, p31?: string, ja?: string, en?: string, parent?: string }} Row
 */

/**
 * warloc のクエリの行。P276（場所）と、その先の座標。
 * @typedef {{ qid: string, loc: string, locCoord?: string }} LocRow
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
 *   locations: readonly { qid: string, lon: number, lat: number }[],
 *   locationsWithoutCoord: readonly string[],
 *   parents: readonly string[],
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
  ...(b.coord ? { coord: b.coord.value } : {}),
  prop: /** @type {Row["prop"]} */ (b.prop.value),
  t: b.t.value,
  prec: Number(b.prec.value),
  ...(b.p31 ? { p31: qidOf(b.p31.value) } : {}),
  ...(b.ja ? { ja: b.ja.value } : {}),
  ...(b.en ? { en: b.en.value } : {}),
  ...(b.parent ? { parent: qidOf(b.parent.value) } : {}),
});

/**
 * @param {Record<string, { value: string }>} b
 * @returns {LocRow}
 */
export const toLocRow = (b) => ({
  qid: qidOf(b.item.value),
  loc: qidOf(b.loc.value),
  ...(b.locCoord ? { locCoord: b.locCoord.value } : {}),
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
 * @param {readonly LocRow[]} [locRows] warloc のチャンクの行
 * @returns {RawItem[]} 座標の有無では絞らない（war は座標なしも分母として残す）。地球以外の座標は捨てる
 */
export const mergeChunks = (chunks, locRows = []) => {
  const tagged = chunks.flatMap((c) => c.rows.map((row) => ({ row, rootQid: c.rootQid })));
  const groups = Map.groupBy(tagged, (x) => x.row.qid);
  const locsByItem = Map.groupBy(locRows, (r) => r.qid);
  return [...groups.entries()]
    .map(([qid, group]) => {
      const rows = group.map((x) => x.row);
      const first = rows[0];
      const locs = uniqueBy(locsByItem.get(qid) ?? [], (r) => r.loc);
      return {
        qid,
        labels: {
          ...(rows.find((r) => r.ja) ? { ja: rows.find((r) => r.ja)?.ja } : {}),
          ...(rows.find((r) => r.en) ? { en: rows.find((r) => r.en)?.en } : {}),
        },
        p31: [...new Set(rows.flatMap((r) => (r.p31 ? [r.p31] : [])))].sort(),
        coords: uniqueBy(
          rows.flatMap((r) => (r.coord ? [parsePoint(r.coord)] : [])).filter((p) => p !== null),
          (p) => `${p.lon},${p.lat}`,
        ),
        locations: locs.flatMap((r) => {
          const p = r.locCoord ? parsePoint(r.locCoord) : null;
          return p ? [{ qid: r.loc, ...p }] : [];
        }),
        locationsWithoutCoord: locs.filter((r) => !r.locCoord || !parsePoint(r.locCoord)).map((r) => r.loc),
        parents: [...new Set(rows.flatMap((r) => (r.parent ? [r.parent] : [])))].sort(),
        times: { P585: timesOf(rows, "P585"), P580: timesOf(rows, "P580"), P582: timesOf(rows, "P582") },
        sitelinks: first.links,
        roots: [...new Set(group.map((x) => x.rootQid))].sort(),
      };
    })
    .sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid));
};
