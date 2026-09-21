// 取得した OpenHistoricalMap の relation と way から、国境の線を作る規則。純粋関数のみ（build-borders.mjs が使う）。
import { parseOhmYear } from "./dates.mjs";

/** @typedef {{ id: number, tags: Record<string, string>, members: { ref: number, role: string }[] }} RawRelation */
/** @typedef {{ id: number, tags: Record<string, string>, coords: [number, number][] }} RawWay */

/**
 * その way を落とす理由。落とさないなら null。license では落とさない（licenses.mjs。受け入れない license があれば、生成そのものを止める）。
 * - coastline: natural=coastline。OSM 由来（CC BY-SA）の海岸線を混ぜないため。海岸線は Natural Earth で描いてある
 * - maritime:  maritime=yes / boundary_type=maritime。領海の線で、陸の国境ではない
 * @param {RawWay} way
 * @returns {"coastline" | "maritime" | null}
 */
export const dropReason = (way) =>
  way.tags.natural === "coastline"
    ? "coastline"
    : way.tags.maritime === "yes" || way.tags.boundary_type === "maritime"
      ? "maritime"
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
 * way ごとに、「その way を国境に持つ国の名前の組」が変わらない期間に分ける。
 *
 * OHM は国境が変わるたびに別の relation を作るので（アメリカ合衆国が 52 件）、relation ごとに線を出力すると、同じ way が版の数だけ重複する
 * （全 relation をそのまま出すと、許容 0.1° でも合計 17.5 MB。2026-09-21 の実測）。そこで、線は way の単位で 1 回だけ持ち、
 * 各年にその way を使っている relation の名前の組を求めて、組が同じ年が続くあいだを 1 つの期間にまとめる。
 * 同じ国の版どうしは名前が同じなので、版が替わっても期間は切れない。名前が変わる（王国 → 共和国）と、そこで切れる。
 *
 * @param {readonly { properties: NonNullable<ReturnType<typeof borderProperties>>, wayIds: readonly number[] }[]} relations
 * @param {number} yearMin @param {number} yearMax 出力する期間（両端を含む）
 * @returns {Map<number, { start: number, end: number, names: readonly { name: string, nameJa?: string }[] }[]>}
 *   way の id → 期間の列。end は「その年にはもう無い」年（表示の条件は start ≤ 現在年 < end）。yearMax まで続くものは end = yearMax + 1
 */
export const waySpans = (relations, yearMin, yearMax) => {
  /** @type {Map<number, NonNullable<ReturnType<typeof borderProperties>>[]>} */
  const byWay = new Map();
  relations.forEach((r) => r.wayIds.forEach((id) => byWay.set(id, [...(byWay.get(id) ?? []), r.properties])));
  return new Map(
    [...byWay.entries()].map(([wayId, users]) => {
      // 名前の組が変わりうる年（各 relation の start と end）だけを見る
      const years = [...new Set(users.flatMap((u) => [u.start, u.end ?? yearMax + 1]).map((y) => Math.min(Math.max(y, yearMin), yearMax + 1)))].sort((a, b) => a - b);
      const pieces = years.slice(0, -1).flatMap((from, i) => {
        const active = users.filter((u) => u.start <= from && from < (u.end ?? Infinity));
        if (active.length === 0) return [];
        const names = [...new Map(active.map((u) => [u.name, { name: u.name, ...(u.nameJa ? { nameJa: u.nameJa } : {}) }])).values()].sort((a, b) => a.name.localeCompare(b.name));
        return [{ start: from, end: years[i + 1], names, key: names.map((n) => n.name).join("|") }];
      });
      // 隣り合う期間で名前の組が同じなら、つなげる
      const merged = pieces.reduce((acc, piece) => {
        const last = acc[acc.length - 1];
        return last && last.end === piece.start && last.key === piece.key ? [...acc.slice(0, -1), { ...last, end: piece.end }] : [...acc, piece];
      }, /** @type {typeof pieces} */ ([]));
      return [wayId, merged.map(({ start, end, names }) => ({ start, end, names }))];
    }),
  );
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
