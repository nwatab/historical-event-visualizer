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
  WORK_CLASSES,
} from "./lists.mjs";
import { granularityOf, isCityOverRegion } from "./place-granularity.mjs";
import { regionOf } from "./regions.mjs";
import { isChemicalElement } from "./title-predicates.mjs";
import { ROOTS } from "./roots.mjs";

/** @typedef {import("./merge.mjs").RawItem} RawItem */
/** @typedef {import("./fetch-lists.mjs").ListAttrs} ListAttrs */
/** @typedef {import("./p31-domain-map.mjs").Domain} Domain */
/** @typedef {import("./regions.mjs").Region} Region */
/** @typedef {import("./place-granularity.mjs").Granularity} Granularity */
/** @typedef {{ lon: number, lat: number, via: string, loc?: string }} Place */
/** 粒度を付けた場所。 @typedef {Place & { granularity: Granularity }} GradedPlace */
/** @typedef {{ labels: { ja?: string, en?: string }, p31: string[], parents: string[], sitelinks: number, isWar?: boolean }} Parent */

/** これ未満の sitelinks の項目は母集団に入れない（R4b-2 の決定4）。 */
export const MIN_SITELINKS = 2;

/** 地図に置く場所の粒度。細かい順（places の並び順）。 @type {readonly Exclude<Granularity, "coarse">[]} */
const USABLE_FINEST_FIRST = Object.freeze(["fine", "region", "country"]);

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
 * リストの1項目（出典 × 記事）の状態。QID・年・場所のどこまで取れたか。
 * @param {{ source: string, domain: Domain | null, title: string, level: number }} ref
 * @param {string | null} qid
 * @param {ListAttrs | undefined} attrs
 */
export const listRecord = (ref, qid, attrs) => {
  const start = attrs ? listStart(attrs, LIST_TIME_PROPS) : null;
  const places = attrs ? listPlaces(attrs, LIST_PLACE_PROPS) : [];
  return {
    ...ref,
    qid,
    attrs,
    start,
    places,
    startSpecOnly: attrs ? listStart(attrs, LIST_TIME_PROPS_SPEC) : null,
    placesSpecOnly: attrs ? listPlaces(attrs, LIST_PLACE_PROPS_SPEC) : [],
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
 *   excludedQids?: readonly string[],
 *   placeClasses?: Readonly<Record<string, { p31: readonly string[] } | null>>,
 * }} input placeClasses は、場所の項目（P276 などの先）の P31（fetch-places.mjs）。
 *   excludedQids は、人が誤データと判断した項目（place-overrides.json の exclude）
 */
export const buildItems = ({ rawItems, outsideParents, listRecords, countryIndex, excludedQids = [], placeClasses = {} }) => {
  const itemsByQid = new Map(rawItems.map((i) => [i.qid, i]));
  const usable = listRecords.filter((r) => r.qid && r.start && r.places.length > 0);
  const listsByQid = Map.groupBy(usable, (r) => /** @type {string} */ (r.qid));
  // 年・場所が取れていなくても、Vital articles に載っていれば「選抜済み」
  const vitalLevelByQid = new Map(
    [...Map.groupBy(listRecords.filter((r) => r.qid), (r) => /** @type {string} */ (r.qid)).entries()].map(([qid, rs]) => [
      qid,
      Math.min(...rs.map((r) => r.level)),
    ]),
  );

  /** @param {string} qid @param {RawItem | undefined} raw @param {readonly ListRecord[]} lists */
  const unify = (qid, raw, lists) => {
    const first = lists[0];
    const rawPlaces = raw ? placesOfRaw(raw) : [];
    const rawStart = raw ? startOfRaw(raw) : null;
    // 年と場所は、P31 ベースの取得で取れていればそちら（出来事としての年・場所）を優先し、無ければリスト側
    const start = rawStart ?? first?.start ?? null;
    // 場所の粒度（place-granularity.mjs）。項目自身の座標（P625）は fine。P495 / P17 は値が必ず国なので country。
    // それ以外は、場所の項目の P31 から決める。
    /** @type {GradedPlace[]} */
    const allPlaces = (rawPlaces.length > 0 ? rawPlaces : (first?.places ?? [])).map((p) => ({
      ...p,
      granularity: COUNTRY_LEVEL_PLACE_PROPS.includes(p.via)
        ? "country"
        : p.loc
          ? granularityOf(placeClasses[p.loc]?.p31 ?? [])
          : "fine",
    }));
    // 地図に置くのは「そこで起きた」と言っている場所だけ（R4e）:
    // - coarse（大陸・海洋）は外す
    // - P495（原産国）/ P17（国）は外す。「そこで起きた」とは言っていないため（R4b-2 の決定2）
    // - P276 / P189 などの先が国（country）の場所は残す。「そこで起きた」という主張で、粒度が粗いだけなので。
    //   粒度は JSON に出し、アプリが拡大時に country のマーカーを消す（mapFilters.ts）
    // 並びは fine → region → country（ラベルを付ける最初の1点を、いちばん細かい場所にするため）。
    // fine の中では、都市の規則で fine になった場所（行政区画でもある大都市。isCityOverRegion）を後ろに置く。
    // 以前は region だった場所で、建物や区のような本当に細かい場所より先にラベルが付かないようにするため（R4e-2）
    const onMap = allPlaces.filter((p) => p.granularity !== "coarse" && !COUNTRY_LEVEL_PLACE_PROPS.includes(p.via));
    const cityOverRegion = (/** @type {GradedPlace} */ p) => p.loc !== undefined && isCityOverRegion(placeClasses[p.loc]?.p31 ?? []);
    const usable = USABLE_FINEST_FIRST.flatMap((g) =>
      g === "fine"
        ? [...onMap.filter((p) => p.granularity === g && !cityOverRegion(p)), ...onMap.filter((p) => p.granularity === g && cityOverRegion(p))]
        : onMap.filter((p) => p.granularity === g),
    );
    // 地域の集計には、置ける場所が無い項目でも元の場所を使う（国の代表点でも地域は分かる）
    const places = usable.length > 0 ? usable : allPlaces;
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
      allPlaces,
      // 地図に置ける場所が無い項目（P495 / P17 の国の代表点しか無い、または大陸・海洋しか無い）。
      // データには残すが、地図には出さない（R4b-2 の決定2。R4e で、大陸・海洋しか無い項目にも広げた）
      countryLevelPlace: allPlaces.length > 0 && usable.length === 0,
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

  // 母集団: 年がアプリの表示範囲内で、場所があり、7分類のどれかに入り、sitelinks が MIN_SITELINKS 以上の項目。
  // sitelinks 0〜1 の項目は、個々の核実験や一括登録されたデータセットが大半なので除く（R4b-2 の決定4）。
  const candidates = all.filter(
    (i) => i.inAppRange && i.places.length > 0 && i.classification.status === "mapped" && i.sitelinks >= MIN_SITELINKS,
  );
  // そこから、場所が国の代表点しか無い作品（lists.mjs の WORK_CLASSES）と、人が誤データと判断した項目を除く
  const isCountryOnlyWork = (/** @type {(typeof all)[number]} */ i) => i.countryLevelPlace && i.p31.some((c) => WORK_CLASSES.includes(c));
  const dropped = {
    countryOnlyWorks: candidates.filter(isCountryOnlyWork),
    excludedByHand: candidates.filter((i) => excludedQids.includes(i.qid)),
  };
  const population = candidates.filter((i) => !isCountryOnlyWork(i) && !excludedQids.includes(i.qid));
  // importance のパーセンタイルは由来別に取る（R4b-2 の決定1）。出来事の記事（P31 で分類）と、
  // 物・作品・組織の記事（Vital articles の節で分類）とでは sitelinks の水準が一桁違い、混ぜると後者が上位を占めるため。
  /** @param {"p31" | "list"} by */
  const thresholdsOf = (by) =>
    importanceThresholds(
      population
        .filter((i) => i.classification.by === by)
        .map((i) => ({ year: /** @type {NonNullable<typeof i.start>} */ (i.start).year, sitelinks: i.sitelinks })),
    );
  const thresholds = { p31: thresholdsOf("p31"), list: thresholdsOf("list") };
  const withImportance = population.map((i) => ({
    ...i,
    ...importanceOf(
      {
        year: /** @type {NonNullable<typeof i.start>} */ (i.start).year,
        sitelinks: i.sitelinks,
        cappedAt2: (i.kind === "engagement" && i.parentWar !== null) || isChemicalElement(i.p31),
        vital: i.vital,
      },
      thresholds[i.classification.by],
    ),
  }));
  return { all, population: withImportance, thresholds, dropped };
};

/** @typedef {ReturnType<typeof buildItems>["all"][number]} AnyItem */
/** @typedef {ReturnType<typeof buildItems>["population"][number]} Item */
