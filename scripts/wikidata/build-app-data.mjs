// data/raw/ の取得結果を、アプリが読む HistEvent（src/types/event.ts）の JSON に変換して public/data/events/ に出力する。
//
//   pnpm wikidata:build-app-data
//
// ネットワークには出ない（要るものは fetch.mjs / fetch-lists.mjs / fetch-app-extras.mjs が data/raw/ に保存済み）。
// 出力した JSON はコミットする（取得に1時間かかるので、CI では生成しない）。
//
// 年はすべて SPARQL 由来の天文年なので、bce() を通さない（CLAUDE.md「年の扱い」）。
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  APP_DATA_DIR,
  APP_YEAR_MAX,
  APP_YEAR_MIN,
  ARTICLES_PATH,
  MUL_LABELS_PATH,
  OVERRIDE_PLACES_PATH,
  PLACE_CLASS_LABELS_PATH,
  PLACE_LABELS_PATH,
} from "./config.mjs";
import { COUNTRY_LEVEL_PLACE_PROPS } from "./lists.mjs";
import { loadAnalysis, readJsonOr } from "./load-analysis.mjs";
import { loadSampleEvents } from "./load-ts.mjs";
import { isMappedClass } from "./classify.mjs";
import { granularityOf } from "./place-granularity.mjs";
import { pickResolved, placeKey } from "./place-overrides.mjs";
import { PREDICATE_SUFFIX, predicateFor } from "./title-predicates.mjs";

/** @typedef {import("./analyze.mjs").Item} Item */
/** @typedef {{ from: number, to: number }} Bin 天文年の半開区間 [from, to) */

/** 1ファイルの大きさの上限。超えたら区間を半分に割る。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// ── 変換（純粋関数） ────────────────────────────────────────

/**
 * 出典 URL: 日本語版 Wikipedia → 英語版 → Wikidata の順。
 * 記事名の空白は _ にし、URL の区切りになる文字だけをエスケープする（日本語はそのまま。手書きのサンプルと同じ書き方）。
 * @param {string} qid @param {{ ja?: string, en?: string } | undefined} articles
 */
export const sourceUrl = (qid, articles) => {
  const lang = articles?.ja ? "ja" : articles?.en ? "en" : null;
  if (!lang) return `https://www.wikidata.org/wiki/${qid}`;
  const title = /** @type {string} */ (articles?.[lang])
    .replace(/ /g, "_")
    .replace(/[%?#"<>\\^`{|}]/g, (c) => encodeURIComponent(c));
  return `https://${lang}.wikipedia.org/wiki/${title}`;
};

/**
 * kind と end:
 * - 戦争は、P582（終了）があれば period、無ければ instant
 * - 会戦は instant
 * - それ以外は、P580（開始）と P582 の両方があれば period、無ければ instant
 * 終了が開始より前になっている項目（Wikidata 側の誤り）は instant にする。
 * @param {Item} item @param {number} start
 */
const temporalOf = (item, start) => {
  const end = item.end;
  const hasBoth = item.times.P580.length > 0 && item.times.P582.length > 0;
  const isPeriod = end !== null && end >= start && (item.kind === "war" || (item.kind === "other" && hasBoth));
  return isPeriod ? { kind: /** @type {const} */ ("period"), end } : { kind: /** @type {const} */ ("instant") };
};

/** 小数第4位まで（約 10m）。Wikidata の座標は桁数がまちまちで、そのまま出すとファイルが大きくなる。 @param {number} x */
const roundCoord = (x) => Math.round(x * 1e4) / 1e4;

/**
 * 粒度は、既定値の fine のときは書かない（placeKind の "point" と同じ扱い。全 places に書くとファイルが 0.5MB ほど増える）。
 * @param {import("./place-granularity.mjs").Granularity} granularity
 */
const granularityField = (granularity) => (granularity === "fine" ? {} : { granularity });

/**
 * place-overrides.json の1件ぶんの places を、取得済みの座標に置き換える。
 * 該当する座標が無ければエラーにする（推測で埋めない）。
 * 粒度は、根拠の項目そのものの座標（path: "P625"）ならその項目の P31 から決め、本部所在地（"P159>P625"）なら fine。
 * @param {import("./place-overrides.mjs").PlaceOverride} override
 * @param {number} year その出来事の年（P159 の修飾子から、その年に該当する所在地を選ぶため）
 * @param {Readonly<Record<string, import("./place-overrides.mjs").ResolvedRow[]>>} resolved
 * @param {Readonly<Record<string, { p31: readonly string[] } | null>>} placeClasses
 */
const overridePlaces = (override, year, resolved, placeClasses) =>
  (override.places ?? []).map((place) => {
    const row = pickResolved(resolved[placeKey(place)] ?? [], year);
    if (!row) {
      throw new Error(`place-overrides: ${override.qid} の ${place.from}（${place.path}）から ${year} 年の座標が取れません。pnpm wikidata:fetch-app-extras を実行したか確認してください。`);
    }
    const granularity = place.path === "P625" ? granularityOf(placeClasses[place.from]?.p31 ?? []) : "fine";
    return {
      lon: roundCoord(row.lon),
      lat: roundCoord(row.lat),
      label: place.label ?? row.labelJa ?? row.labelEn ?? place.fromLabel,
      ...granularityField(granularity),
    };
  });

/**
 * @param {Item} item
 * @param {Readonly<Record<string, { ja?: string, en?: string }>>} articles
 * @param {Readonly<Record<string, { ja?: string, en?: string }>>} placeLabels
 * @param {import("./place-overrides.mjs").PlaceOverride | undefined} override 人が承認した地点・起点
 * @param {Readonly<Record<string, import("./place-overrides.mjs").ResolvedRow[]>>} resolved
 * @param {string | null | undefined} mulLabel 多言語共通ラベル（日本語・英語のラベルが無い項目だけ）
 * @param {Readonly<Record<string, { p31: readonly string[] } | null>>} [placeClasses] 場所の項目の P31（人が決めた場所の粒度の判定用）
 * @returns {Record<string, unknown> | null} HistEvent。ラベルが無ければ null
 */
export const toHistEvent = (item, articles, placeLabels, override, resolved, mulLabel, placeClasses = {}) => {
  // 日本語 → 英語 → 多言語共通（mul）。mul は、どの言語でも同じ表記の名前（AK-47 など）で、英語ラベルの代わりに入っている
  const label = item.labels.ja ?? item.labels.en ?? mulLabel;
  if (!label || item.start === null || item.classification.status !== "mapped") return null;
  // 物や組織の名前には述語を足して、出来事として読めるようにする（「ナトリウム」→「ナトリウムの発見」。title-predicates.mjs）。
  // 足すのは表示用の title.ja だけで、英語の title.en は Wikidata のラベルのまま
  const predicate = predicateFor(item.p31, isMappedClass);
  const title = predicate ? `${label}${PREDICATE_SUFFIX[predicate]}` : label;
  const start = override?.start ?? item.start.year;
  const temporal = temporalOf(item, start);
  const end = override?.end ?? ("end" in temporal ? temporal.end : undefined);
  const kind = override?.kind ?? temporal.kind;
  // 場所:
  // - 人が地点・起点を決めた項目は、その places と placeKind（"point" は既定値なので書かない）
  // - 地図に置ける場所が無い項目（P495 / P17 の国の代表点だけ、または大陸・海洋だけ）で、人が決めていないものは、placeKind: "none" で places は空
  // - それ以外は Wikidata の座標（fine → region → country の順。粒度が fine 以外なら granularity を付ける）
  const placeKind = override?.placeKind ?? (item.countryLevelPlace ? "none" : "point");
  const places =
    placeKind === "none"
      ? []
      : override?.places
        ? overridePlaces(override, start, resolved, placeClasses)
        : item.places.map((p) => {
            const label = p.loc ? (placeLabels[p.loc]?.ja ?? placeLabels[p.loc]?.en) : undefined;
            return { lon: roundCoord(p.lon), lat: roundCoord(p.lat), ...(label ? { label } : {}), ...granularityField(p.granularity) };
          });
  return {
    id: item.qid,
    title: { ja: title, ...(item.labels.ja && item.labels.en ? { en: item.labels.en } : {}) },
    domain: item.classification.domain,
    tags: item.classification.tags,
    kind,
    start,
    ...(kind === "period" && end !== undefined ? { end } : {}),
    places,
    ...(placeKind === "point" ? {} : { placeKind }),
    importance: item.importance,
    source: sourceUrl(item.qid, articles[item.qid]),
  };
};

/**
 * 区間の切り方: 紀元前（天文年が負）は 500年ごと、それ以降は 100年ごと。
 * @param {number} min @param {number} max @returns {Bin[]}
 */
export const baseBins = (min, max) => {
  const bce = Array.from({ length: Math.ceil(-min / 500) }, (_, i) => ({ from: min + i * 500, to: Math.min(0, min + (i + 1) * 500) }));
  const ce = Array.from({ length: Math.floor(max / 100) + 1 }, (_, i) => ({ from: i * 100, to: (i + 1) * 100 }));
  return [...bce.filter((b) => b.from < 0), ...ce];
};

/**
 * その区間のファイルに入れる項目: 区間内に「存在する」項目。instant は開始年が区間内、period は [start, end] が区間と重なるもの。
 * period を開始年の区間だけに入れると、アプリが現在年の前後の区間しか読まないので、長く続く項目
 * （ローマ帝国など）が途中の年で表示されなくなる。このため複数の区間に重複して入れ、アプリ側で id の重複を除く。
 * @param {readonly any[]} events @param {Bin} bin
 */
const eventsIn = (events, bin) => events.filter((e) => e.start < bin.to && (e.end ?? e.start) >= bin.from);

/**
 * 大きすぎる区間を半分に割っていく。
 * @param {readonly any[]} events @param {Bin} bin
 * @returns {{ bin: Bin, events: any[], json: string }[]}
 */
const splitToFit = (events, bin) => {
  const mine = eventsIn(events, bin);
  const json = JSON.stringify(mine);
  if (Buffer.byteLength(json) <= MAX_FILE_BYTES || bin.to - bin.from <= 1) return [{ bin, events: mine, json }];
  const mid = Math.floor((bin.from + bin.to) / 2);
  return [...splitToFit(mine, { from: bin.from, to: mid }), ...splitToFit(mine, { from: mid, to: bin.to })];
};

/** @template T @param {readonly T[]} xs @param {(x: T) => string | number} key */
const countBy = (xs, key) =>
  Object.fromEntries([...Map.groupBy(xs, key).entries()].map(([k, g]) => [k, g.length]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

// ── メイン ────────────────────────────────────────────────

const { population, dropped, fetchLog, listPages, placeOverrides, placeClasses } = await loadAnalysis();
const [articles, placeLabels, resolved, mulLabels, sample] = await Promise.all([
  readJsonOr(ARTICLES_PATH, null),
  readJsonOr(PLACE_LABELS_PATH, null),
  readJsonOr(OVERRIDE_PLACES_PATH, null),
  readJsonOr(MUL_LABELS_PATH, {}),
  loadSampleEvents(),
]);
if (!articles || !placeLabels || !resolved) throw new Error("data/raw/app/ がありません。先に pnpm wikidata:fetch-app-extras を実行してください。");

const overrideByQid = new Map(placeOverrides.overrides.map((o) => [o.qid, o]));

const generated = population.flatMap((item) => {
  const event = toHistEvent(item, articles, placeLabels, overrideByQid.get(item.qid), resolved, mulLabels[item.qid], placeClasses);
  return event ? [event] : [];
});
const noLabel = population.length - generated.length;
// 表に書いたのにデータに入らなかった項目は、黙って落とさずに知らせる
const generatedIds = new Set(generated.map((e) => e.id));
const unusedOverrides = placeOverrides.overrides.filter((o) => !generatedIds.has(o.qid));
if (unusedOverrides.length > 0) {
  console.warn(`place-overrides にあるがデータに入らなかった項目: ${unusedOverrides.map((o) => `${o.qid} ${o.title}`).join("、")}`);
}

// 手書きのサンプルとの統合: QID が同じ項目は手書きを優先し（座標と説明が正確）、手書きにしか無い項目（slug の id）はそのまま足す
const sampleIds = new Set(sample.map((e) => e.id));
const duplicates = generated.filter((e) => sampleIds.has(/** @type {string} */ (e.id)));
const events = [...sample, ...generated.filter((e) => !sampleIds.has(/** @type {string} */ (e.id)))].sort(
  (a, b) => a.start - b.start || b.importance - a.importance || String(a.id).localeCompare(String(b.id)),
);

// 場所の粒度（R4e）の影響。R4d までの規則（場所はすべて使う。none は P495 / P17 だけの項目）と比べる。
// 人が場所を決めた項目（place-overrides）は、粒度に関係なくその場所を使うので数えない。
const placeImpact = population
  .filter((i) => !overrideByQid.has(i.qid) && generatedIds.has(i.qid))
  .map((i) => {
    const beforeNone = i.allPlaces.every((p) => COUNTRY_LEVEL_PLACE_PROPS.includes(p.via));
    const afterNone = i.countryLevelPlace;
    const same = (/** @type {{ lon: number, lat: number }} */ a, /** @type {{ lon: number, lat: number }} */ b) => a.lon === b.lon && a.lat === b.lat;
    return {
      item: i,
      becameNone: !beforeNone && afterNone,
      reduced: !afterNone && i.places.length < i.allPlaces.length,
      primaryChanged: !beforeNone && !afterNone && !same(i.places[0], i.allPlaces[0]),
      // 拡大すると（COUNTRY_MAX_ZOOM 以上で）地図から消える項目: 置ける場所が国だけ
      countryOnly: !afterNone && i.places.every((p) => p.granularity === "country"),
      hasCountry: !afterNone && i.places.some((p) => p.granularity === "country"),
    };
  });
const granularityCounts = countBy(
  population.flatMap((i) => i.allPlaces.filter((p) => p.loc).map((p) => p.granularity)),
  (g) => g,
);

// 述語を足した件数（手書きを優先して置き換えた項目は数えない）
const keptIds = new Set(events.map((e) => e.id).filter((id) => !sampleIds.has(id)));
const byPredicate = countBy(
  population.filter((i) => keptIds.has(i.qid)).flatMap((i) => predicateFor(i.p31, isMappedClass) ?? []),
  (p) => p,
);

const files = baseBins(APP_YEAR_MIN, APP_YEAR_MAX)
  .flatMap((bin) => splitToFit(events, bin))
  .filter((f) => f.events.length > 0)
  .map((f) => ({ ...f, file: `${f.bin.from}.json` }));

// 出力先を作り直す（区間の切り方が変わったときに古いファイルが残らないように、*.json だけ消す）
await mkdir(APP_DATA_DIR, { recursive: true });
await Promise.all((await readdir(APP_DATA_DIR)).filter((f) => f.endsWith(".json")).map((f) => rm(join(APP_DATA_DIR, f))));
await Promise.all(files.map((f) => writeFile(join(APP_DATA_DIR, f.file), f.json)));

const okLog = fetchLog.filter((c) => c.status === "ok").map((c) => c.fetchedAt).sort();
const listFetched = listPages.map((p) => p.fetchedAt).sort();
const manifest = {
  generatedAt: new Date().toISOString(),
  // 使った取得データの日時（UTC）。Wikidata は SPARQL のチャンクを取得した時刻の幅、Wikipedia はリストのページを取得した時刻の幅
  sources: {
    wikidata: { license: "CC0", fetchedFrom: okLog[0], fetchedTo: okLog[okLog.length - 1] },
    wikipediaVitalArticles: {
      license: "CC BY-SA 4.0",
      fetchedFrom: listFetched[0],
      fetchedTo: listFetched[listFetched.length - 1],
      pages: listPages.map((p) => ({ page: p.page, revid: p.revid })),
    },
    handwritten: { file: "src/data/events.sample.ts", count: sample.length },
    placeOverrides: { file: "scripts/wikidata/place-overrides.json", applied: placeOverrides.overrides.length - unusedOverrides.length },
  },
  // period は重なる区間すべてに入るので、files の count の合計は total より大きい
  total: events.length,
  byDomain: countBy(events, (e) => e.domain),
  byImportance: countBy(events, (e) => e.importance),
  byPlaceKind: countBy(events, (e) => e.placeKind ?? "point"),
  // title に述語（〜の発見 / 〜の導入 / 〜の設立 / 〜の完成）を足した件数
  byTitlePredicate: byPredicate,
  // 場所の項目（P276 などの先）の粒度別の数（place-granularity.mjs）。coarse は使わない。country は使うが、アプリが拡大時に消す
  placeGranularity: granularityCounts,
  // 出力した places の粒度別の数（手書きのサンプルと、人が決めた場所も含む。granularity の無い場所は fine）
  placesByGranularity: countBy(events.flatMap((e) => e.places), (p) => p.granularity ?? "fine"),
  // 置ける場所が国だけの項目の数（世界全体の表示には出て、拡大すると消える）
  countryOnlyEvents: events.filter((e) => e.places.length > 0 && e.places.every((/** @type {any} */ p) => p.granularity === "country")).length,
  // 年スライダーの目盛り用の要約。全区間のファイルを読まなくても目盛りを出せるように、importance 3 の項目だけを入れる
  // （全件だとほぼ毎年に目盛りが付き、目盛りの意味が無くなる）。地図に出ない項目（places が空）は除く。
  ticks: events
    .filter((e) => e.importance === 3 && e.places.length > 0)
    .map((e) => ({ kind: e.kind, start: e.start, ...(e.end !== undefined ? { end: e.end } : {}), domain: e.domain })),
  files: files.map((f) => ({ file: f.file, from: f.bin.from, to: f.bin.to, count: f.events.length, bytes: Buffer.byteLength(f.json) })),
};
await writeFile(join(APP_DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));

console.log(
  `除外: 場所が国の代表点しか無い作品 ${dropped.countryOnlyWorks.length} 件、人が誤データと判断した項目 ${dropped.excludedByHand.length} 件`,
);
console.log(`母集団 ${population.length} 件 → ラベルなしで除外 ${noLabel} 件 → Wikidata 由来 ${generated.length} 件`);
console.log(`手書きサンプル ${sample.length} 件（うち Wikidata 由来と QID が重複 ${duplicates.length} 件、手書きを優先）→ 合計 ${events.length} 件`);
console.log("分類別:", JSON.stringify(manifest.byDomain));
console.log("importance 別:", JSON.stringify(manifest.byImportance), " placeKind 別:", JSON.stringify(manifest.byPlaceKind));
const describePlace = (/** @type {import("./analyze.mjs").GradedPlace} */ p) =>
  `${p.loc ? (placeLabels[p.loc]?.ja ?? placeLabels[p.loc]?.en ?? p.loc) : "自身の座標"}[${p.granularity}]`;
console.log("場所の項目（P276 などの先）の粒度:", JSON.stringify(granularityCounts));
console.log(
  `場所の粒度の影響: places が減った ${placeImpact.filter((x) => x.reduced).length} 件、none に変わった ${placeImpact.filter((x) => x.becameNone).length} 件` +
    `（うち戦争 ${placeImpact.filter((x) => x.becameNone && x.item.kind === "war").length} 件）、primary が変わった ${placeImpact.filter((x) => x.primaryChanged).length} 件`,
);
console.log(
  `country の場所を持つ ${placeImpact.filter((x) => x.hasCountry).length} 件、うち置ける場所が country だけ ${placeImpact.filter((x) => x.countryOnly).length} 件` +
    `（うち戦争 ${placeImpact.filter((x) => x.countryOnly && x.item.kind === "war").length} 件。世界全体の表示には出て、拡大すると消える）`,
);
console.log(
  placeImpact
    .filter((x) => x.becameNone || x.reduced || x.primaryChanged)
    .sort((a, b) => b.item.sitelinks - a.item.sitelinks)
    .slice(0, 20)
    .map(
      (x) =>
        `  ${x.item.label}（${x.item.sitelinks}）: ${x.item.allPlaces.map(describePlace).join("、").slice(0, 160)} → ` +
        (x.becameNone ? "none" : `${x.item.places.map(describePlace).join("、").slice(0, 100)}${x.primaryChanged ? "（primary 変更）" : ""}`),
    )
    .join("\n"),
);
/** @type {Record<string, string>} */
const placeClassLabels = await readJsonOr(PLACE_CLASS_LABELS_PATH, {});
const fineClasses = countBy(
  population.flatMap((i) => i.allPlaces.filter((p) => p.loc && p.granularity === "fine").flatMap((p) => placeClasses[/** @type {string} */ (p.loc)]?.p31 ?? ["(P31 なし)"])),
  (q) => q,
);
console.log(
  "fine と判定された場所のクラス（上位。広い範囲のものがあれば place-granularity.mjs に足す）:",
  Object.entries(fineClasses).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([q, n]) => `${placeClassLabels[q] ?? q}(${n})`).join("、"),
);
console.log("title に述語を足した件数:", JSON.stringify(byPredicate));
console.log("kind 別:", JSON.stringify(countBy(events, (e) => e.kind)));
console.log("出典別:", JSON.stringify(countBy(events, (e) => (e.source ?? "").replace(/^https:\/\/([^/]+)\/.*$/, "$1") || "なし")));
console.log(manifest.files.map((f) => `  ${f.file.padStart(10)}  ${String(f.count).padStart(5)} 件  ${(f.bytes / 1024).toFixed(0).padStart(5)} KB`).join("\n"));
console.log(`合計 ${(manifest.files.reduce((s, f) => s + f.bytes, 0) / 1024 / 1024).toFixed(2)} MB、${files.length} ファイル → ${APP_DATA_DIR}`);
