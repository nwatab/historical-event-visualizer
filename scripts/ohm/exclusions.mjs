// 国境のデータから除く OpenHistoricalMap の relation（人が編集する表）。
// 除くのは「日付が異常なもの」に限る（紀元前から続くスルターン朝、など）。名目上だけ続いた国、小さい国、階層の違うもの（帝国とその地方）は、
// OHM がそう描いているとおりに出す。Kingdom of Leinster の 2875840（800〜1603 年）は、レンスター王国が名目上 1603 年まで続いたという事実に合っているので、除かない。
// 足すときは、id・名前・日付を Overpass の出力で確かめ、理由を書く。

/**
 * @typedef {{ id: number, name: string, dates: string, reason: string }} Exclusion
 *   dates は、確かめた時点の start_date〜end_date（タグの値そのまま）
 */

/**
 * 初期値は、R3b-2 の調査（scripts/research/borders.md「データの質で気づいたこと」）で見つかった 4 件。
 * どれも、start_date が極端に早く、紀元前 500 年・1 年・800 年のどのスナップショットにも入っていた。
 * id と日付は、2026-09-21 に Overpass で取ったタグ（admin_level=2 の全 4,041 relation）から。
 * @type {readonly Exclusion[]}
 */
export const EXCLUDED_RELATIONS = [
  {
    id: 2847907,
    name: "Sindh Sultanate",
    dates: "-0500〜1843",
    reason: "start_date が異常（スルターン朝が紀元前 501 年から続いていることになっている）。1500〜1843 年の国境に入ってしまう",
  },
  {
    id: 2888181,
    name: "Catawba",
    dates: "-3999〜1763",
    reason: "start_date が異常（紀元前 4000 年から）。北米の先住民の領域で、国境（admin_level=2）として 1500〜1763 年に入ってしまう",
  },
  {
    id: 2875841,
    name: "Kingdom of Leinster",
    dates: "-0600〜0800",
    reason: "start_date が異常（紀元前 601 年から）。1500 年より前に終わるので、いまの対象期間（1500 年〜）には元から入らない。期間を広げたときのために記録しておく",
  },
  {
    id: 2874062,
    name: "Uaxactún",
    dates: "-0600〜0378",
    reason: "調査でどのスナップショットにも入っていた 1 件。1500 年より前に終わるので、いまの対象期間には元から入らない。期間を広げたときのために記録しておく",
  },
];
