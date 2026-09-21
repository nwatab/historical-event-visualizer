// 取得した OpenHistoricalMap の relation と way から、国境の線を作る規則。純粋関数のみ（build-borders.mjs が使う）。
import { parseOhmYear } from "./dates.mjs";

/** @typedef {{ id: number, tags: Record<string, string>, members: { ref: number, role: string }[] }} RawRelation */
/** @typedef {{ id: number, tags: Record<string, string>, coords: [number, number][] }} RawWay */

/** license タグの値が CC0 か（無ければ、OHM の既定の CC0）。 @param {string | undefined} license */
export const isCc0 = (license) => license === undefined || /^cc0(-1\.0)?$/i.test(license.trim());

/**
 * その way を落とす理由。落とさないなら null。
 * - coastline: natural=coastline。OSM 由来（CC BY-SA）の海岸線を混ぜないため。海岸線は Natural Earth で描いてある
 * - maritime:  maritime=yes / boundary_type=maritime。領海の線で、陸の国境ではない
 * - license:   way の license タグが CC0 以外（CC BY など）。リポジトリのデータを CC0 / パブリックドメインだけに保つため
 * @param {RawWay} way
 * @returns {"coastline" | "maritime" | "license" | null}
 */
export const dropReason = (way) =>
  way.tags.natural === "coastline"
    ? "coastline"
    : way.tags.maritime === "yes" || way.tags.boundary_type === "maritime"
      ? "maritime"
      : !isCc0(way.tags.license)
        ? "license"
        : null;

/**
 * relation → 出力する feature の properties。start が読めなければ null。
 * - start / end は天文年の整数。end は「その年にはもう無い」年（表示の条件は start ≤ 現在年 < end）。end_date が無ければ end を書かない
 * - name は英語名（name:en）、無ければ name。nameJa は name:ja があるときだけ
 * @param {RawRelation} relation
 */
export const borderProperties = (relation) => {
  const start = parseOhmYear(relation.tags.start_date);
  if (start === null) return null;
  const end = parseOhmYear(relation.tags.end_date);
  const name = relation.tags["name:en"] ?? relation.tags.name ?? "";
  return {
    relationId: relation.id,
    name,
    ...(relation.tags["name:ja"] ? { nameJa: relation.tags["name:ja"] } : {}),
    start,
    ...(end === null ? {} : { end }),
  };
};

/**
 * 世紀ごとの区間 [from, from + 100)。最後の区間は yearMax まで。
 * @param {number} yearMin @param {number} yearMax @returns {{ from: number, to: number }[]}
 */
export const centuryBins = (yearMin, yearMax) =>
  Array.from({ length: Math.floor(yearMax / 100) - Math.floor(yearMin / 100) + 1 }, (_, i) => {
    const from = Math.floor(yearMin / 100) * 100 + i * 100;
    return { from, to: from + 100 };
  });

/**
 * その区間に 1 年でも表示される線か（表示の条件は start ≤ 年 < end）。start と end が同じ年の relation（年の途中だけ存在した版）は、どの年にも出ない。
 * @param {{ start: number, end?: number }} p @param {{ from: number, to: number }} bin
 */
export const visibleIn = (p, bin) => {
  const first = Math.max(p.start, bin.from);
  const last = Math.min(p.end === undefined ? Infinity : p.end - 1, bin.to - 1);
  return first <= last;
};
