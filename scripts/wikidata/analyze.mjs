// 取得した生データ（P31 ベースの項目 + 選抜リストの項目）を、レポート用の1つの項目の列にまとめる。純粋関数のみ。
// 開始年・場所・地域・分類・種別（戦争／会戦）・親の戦争・importance は、すべてここで導出する（生データには持たせない）。
import { APP_YEAR_MAX, APP_YEAR_MIN } from "./config.mjs";
import { classify } from "./classify.mjs";
import { importanceOf, importanceThresholds } from "./importance.mjs";
import {
  COUNTRY_LEVEL_PLACE_PROPS,
  LIST_PLACE_PROPS,
  LIST_PLACE_PROPS_SPEC,
  LIST_TIME_PROPS,
  LIST_TIME_PROPS_SPEC,
  NON_SUBJECT_CLASSES,
} from "./lists.mjs";
import { regionOf } from "./regions.mjs";
import { ROOTS } from "./roots.mjs";
import { parseListYear } from "./wikipedia.mjs";

/** @typedef {import("./merge.mjs").RawItem} RawItem */
/** @typedef {import("./fetch-lists.mjs").ListAttrs} ListAttrs */
/** @typedef {import("./p31-domain-map.mjs").Domain} Domain */
/** @typedef {import("./regions.mjs").Region} Region */
/** @typedef {{ lon: number, lat: number, via: string, loc?: string }} Place */
/** @typedef {{ labels: { ja?: string, en?: string }, p31: string[], parents: string[], sitelinks: number, isWar?: boolean }} Parent */

const WAR_ROOTS = new Set(ROOTS.filter((r) => r.group === "war").map((r) => r.qid));
const ENGAGEMENT_ROOTS = new Set(ROOTS.filter((r) => r.group === "engagement").map((r) => r.qid));

// ── P31 ベースの項目 ────────────────────────────────────────

/**
 * 種別。war と engagement の両方のルートから取れた項目は war とする
 * （「反乱」かつ「戦闘」のような項目で、期間を持つ紛争としての側面を優先する。2026-09-20 の取得では 39 件）。
 * @param {RawItem} item @returns {"war" | "engagement" | "other"}
 */
export const kindOf = (item) =>
  item.roots.some((r) => WAR_ROOTS.has(r)) ? "war" : item.roots.some((r) => ENGAGEMENT_ROOTS.has(r)) ? "engagement" : "other";

/**
 * 場所の決め方:
 * - 戦争は P276（場所）の先の座標を使う。P276 が複数あれば places も複数。P276 に座標が無ければ自前の P625。
 * - それ以外は自前の P625。
 * @param {RawItem} item @returns {Place[]}
 */
const placesOfRaw = (item) => {
  const own = item.coords.map((c) => ({ ...c, via: "P625" }));
  const viaLocation = item.locations.map((l) => ({ lon: l.lon, lat: l.lat, via: "P276", loc: l.qid }));
  return kindOf(item) === "war" && viaLocation.length > 0 ? viaLocation : own;
};

/**
 * 開始年: P580（開始）→ P585（時点）→ P582（終了）の順で最初にあるものの最小値。
 * R4a では P585 を先に見ていたが、戦争のような期間を持つ項目で P585 に終結の日が入っていることがあり
 * （南北戦争が 1865、第一次世界大戦が 1918 になった）、R4b-1 で P580 を先にした。
 * @param {RawItem} item
 */
const startOfRaw = (item) => {
  const source = /** @type {const} */ (["P580", "P585", "P582"]).find((p) => item.times[p].length > 0);
  return source ? { ...item.times[source][0], source } : null;
};

/**
 * P361 を辿って親の戦争を探す（会戦 → 戦線・方面作戦 → 戦争 の連鎖を最大 depth 段）。幅優先で、最初に見つかった戦争を返す。
 * @param {readonly string[]} parents
 * @param {ReadonlyMap<string, RawItem>} itemsByQid
 * @param {Readonly<Record<string, Parent>>} outside 取得済みの項目に無い親（parents.json）
 * @param {number} [depth]
 * @param {ReadonlySet<string>} [seen]
 * @returns {string | null}
 */
export const findParentWar = (parents, itemsByQid, outside, depth = 4, seen = new Set()) => {
  const fresh = parents.filter((q) => !seen.has(q));
  if (fresh.length === 0 || depth === 0) return null;
  const war = fresh.find((q) => {
    const item = itemsByQid.get(q);
    return item ? kindOf(item) === "war" : outside[q]?.isWar === true;
  });
  if (war) return war;
  const next = fresh.flatMap((q) => itemsByQid.get(q)?.parents ?? outside[q]?.parents ?? []);
  return findParentWar(next, itemsByQid, outside, depth - 1, new Set([...seen, ...fresh]));
};

/**
 * 項目の地域: places それぞれの地域のうち、過半数を占めるもの。過半数の地域が無ければ "multi"（複数地域にまたがる）。
 * 世界大戦のように P276 に大陸や海洋が並ぶ項目を、P276 の並び順（不定）で1つの地域に押し込まないため。
 * @param {readonly import("./regions.mjs").CountryPolygon[]} countryIndex
 * @param {readonly Place[]} places
 * @returns {{ region: Region | "multi" | null, country: string | null, method: "inside" | "nearest" | "none" }}
 */
const regionOfPlaces = (countryIndex, places) => {
  if (places.length === 0) return { region: null, country: null, method: "none" };
  const located = places.map((p) => regionOf(countryIndex, p));
  const majority = located.find((l) => located.filter((x) => x.region === l.region).length * 2 > located.length);
  return majority ?? { region: "multi", country: null, method: located[0].method };
};

// ── 選抜リストの項目 ────────────────────────────────────────

/** @typedef {ReturnType<typeof import("./list-entries.mjs").vitalEntries>[number]} VitalEntry */
/** @typedef {ReturnType<typeof import("./list-entries.mjs").timelineEntries>[number]} TimelineEntry */

/** @param {ListAttrs} attrs @param {readonly string[]} props */
const listStart = (attrs, props) => {
  const source = props.find((p) => (attrs.times[p] ?? []).length > 0);
  return source ? { ...attrs.times[source][0], source } : null;
};

/** 優先順で最初に値のあるプロパティの場所をすべて使う。 @param {ListAttrs} attrs @param {readonly string[]} props @returns {Place[]} */
const listPlaces = (attrs, props) => {
  const via = props.find((p) => attrs.places.some((x) => x.prop === p));
  return via
    ? attrs.places
        .filter((x) => x.prop === via)
        .map((x) => ({ lon: x.lon, lat: x.lat, via, ...(x.loc ? { loc: x.loc } : {}) }))
    : [];
};

/**
 * 年表の1行の主題: 行頭から順に、人でも場所でもない最初のリンク。
 * 場所の判定は、P31 が NON_SUBJECT_CLASSES に当たるか、人口（P1082）を持つか、
 * 「自分の P625 を持ち、年のプロパティを1つも持たない」か。
 * 主題にあたる記事が無い行では、行内の別のリンク（組織名など）を主題と誤ることがある。
 * @param {TimelineEntry} entry
 * @param {Readonly<Record<string, { qid: string | null }>>} titles
 * @param {Readonly<Record<string, ListAttrs>>} attrs
 * @param {Readonly<Record<string, boolean>>} populated
 * @returns {{ title: string, qid: string } | null}
 */
export const timelineSubject = (entry, titles, attrs, populated) => {
  const hit = entry.links.find((title) => {
    const qid = titles[title]?.qid;
    const a = qid ? attrs[qid] : undefined;
    if (!qid || !a) return false;
    const isNonSubject = a.p31.some((c) => NON_SUBJECT_CLASSES.includes(c));
    const isPlaceLike = a.places.some((p) => p.prop === "P625") && LIST_TIME_PROPS.every((p) => (a.times[p] ?? []).length === 0);
    return !isNonSubject && !isPlaceLike && populated[qid] !== true;
  });
  return hit ? { title: hit, qid: /** @type {string} */ (titles[hit].qid) } : null;
};

/**
 * リストの1項目（出典 × 記事）の状態。QID・年・場所のどこまで取れたか。
 * @param {{ source: string, domain: Domain | null, title: string, listKind: "vital" | "timeline", level?: number, yearLabel?: string, text?: string }} ref
 * @param {string | null} qid
 * @param {ListAttrs | undefined} attrs
 */
export const listRecord = (ref, qid, attrs) => {
  const start = attrs ? listStart(attrs, LIST_TIME_PROPS) : null;
  const places = attrs ? listPlaces(attrs, LIST_PLACE_PROPS) : [];
  const listYear = ref.yearLabel ? parseListYear(ref.yearLabel) : null;
  return {
    ...ref,
    qid,
    attrs,
    start,
    places,
    startSpecOnly: attrs ? listStart(attrs, LIST_TIME_PROPS_SPEC) : null,
    placesSpecOnly: attrs ? listPlaces(attrs, LIST_PLACE_PROPS_SPEC) : [],
    listYear,
    reasons: [
      ...(qid && attrs ? [] : ["QID に解決できない"]),
      ...(qid && attrs && !start ? [`年が無い（${LIST_TIME_PROPS.join("/")}）`] : []),
      ...(qid && attrs && places.length === 0 ? [`場所が無い（${LIST_PLACE_PROPS.join("/")}）`] : []),
    ],
  };
};

/** @typedef {ReturnType<typeof listRecord>} ListRecord */

// ── 統合 ──────────────────────────────────────────────────

/**
 * @param {{
 *   rawItems: readonly RawItem[],
 *   outsideParents: Readonly<Record<string, Parent>>,
 *   listRecords: readonly ListRecord[],
 *   countryIndex: readonly import("./regions.mjs").CountryPolygon[],
 * }} input
 */
export const buildItems = ({ rawItems, outsideParents, listRecords, countryIndex }) => {
  const itemsByQid = new Map(rawItems.map((i) => [i.qid, i]));
  const usable = listRecords.filter((r) => r.qid && r.start && r.places.length > 0);
  const listsByQid = Map.groupBy(usable, (r) => /** @type {string} */ (r.qid));
  // 年・場所が取れていなくても、Vital articles に載っていれば「選抜済み」
  const vitalLevelByQid = new Map(
    [...Map.groupBy(listRecords.filter((r) => r.qid && r.listKind === "vital"), (r) => /** @type {string} */ (r.qid)).entries()].map(
      ([qid, rs]) => [qid, Math.min(...rs.map((r) => r.level ?? 5))],
    ),
  );

  /** @param {string} qid @param {RawItem | undefined} raw @param {readonly ListRecord[]} lists */
  const unify = (qid, raw, lists) => {
    const first = lists[0];
    const rawPlaces = raw ? placesOfRaw(raw) : [];
    const rawStart = raw ? startOfRaw(raw) : null;
    // 年と場所は、P31 ベースの取得で取れていればそちら（出来事としての年・場所）を優先し、無ければリスト側
    const start = rawStart ?? first?.start ?? null;
    const places = rawPlaces.length > 0 ? rawPlaces : (first?.places ?? []);
    const p31 = raw?.p31 ?? first?.attrs?.p31 ?? [];
    const byP31 = classify(p31);
    // 分類は、リストの節で決まるものがあればそれを主分類にする（P31 は使わない）。History のように節で決まらないときだけ P31 の写像表
    const listDomains = [...new Set(lists.flatMap((r) => (r.domain ? [r.domain] : [])))];
    const p31Tags = byP31.status === "mapped" ? byP31.tags : [];
    const classification =
      listDomains.length > 0
        ? { status: /** @type {const} */ ("mapped"), domain: listDomains[0], tags: [...new Set([...listDomains, ...p31Tags])], by: /** @type {const} */ ("list") }
        : byP31.status === "mapped"
          ? { ...byP31, by: /** @type {const} */ ("p31") }
          : { status: byP31.status, by: /** @type {const} */ ("p31") };
    const kind = raw ? kindOf(raw) : "other";
    const place = regionOfPlaces(countryIndex, places);
    const labels = raw?.labels ?? first?.attrs?.labels ?? {};
    return {
      qid,
      labels,
      label: labels.ja ?? labels.en ?? first?.title ?? qid,
      sitelinks: raw?.sitelinks ?? first?.attrs?.sitelinks ?? 0,
      p31,
      roots: raw?.roots ?? [],
      times: raw?.times ?? { P585: [], P580: [], P582: [] },
      kind,
      fromP31: raw !== undefined,
      listSources: [...new Set(lists.map((r) => r.source))],
      vital: vitalLevelByQid.has(qid),
      vitalLevel: vitalLevelByQid.get(qid) ?? null,
      start,
      end: raw && raw.times.P582.length > 0 ? raw.times.P582[raw.times.P582.length - 1].year : null,
      inAppRange: start !== null && start.year >= APP_YEAR_MIN && start.year <= APP_YEAR_MAX,
      places,
      coords: places,
      countryLevelPlace: places.length > 0 && COUNTRY_LEVEL_PLACE_PROPS.includes(places[0].via),
      region: place.region,
      country: place.country,
      regionMethod: place.method,
      classification,
      parents: raw?.parents ?? [],
      parentWar: raw && kind === "engagement" ? findParentWar(raw.parents, itemsByQid, outsideParents) : null,
    };
  };

  const qids = [...new Set([...rawItems.map((i) => i.qid), ...listsByQid.keys()])];
  const all = qids.map((qid) => unify(qid, itemsByQid.get(qid), listsByQid.get(qid) ?? []));

  // 母集団: 年がアプリの表示範囲内で、場所があり、7分類のどれかに入った項目
  const population = all.filter((i) => i.inAppRange && i.places.length > 0 && i.classification.status === "mapped");
  const thresholds = importanceThresholds(
    population.map((i) => ({ year: /** @type {NonNullable<typeof i.start>} */ (i.start).year, sitelinks: i.sitelinks })),
  );
  const withImportance = population.map((i) => ({
    ...i,
    ...importanceOf(
      {
        year: /** @type {NonNullable<typeof i.start>} */ (i.start).year,
        sitelinks: i.sitelinks,
        cappedAsEngagement: i.kind === "engagement" && i.parentWar !== null,
        vital: i.vital,
      },
      thresholds,
    ),
  }));
  return { all, population: withImportance, thresholds };
};

/** @typedef {ReturnType<typeof buildItems>["all"][number]} AnyItem */
/** @typedef {ReturnType<typeof buildItems>["population"][number]} Item */
