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
import { APP_DATA_DIR, APP_YEAR_MAX, APP_YEAR_MIN, ARTICLES_PATH, PLACE_LABELS_PATH } from "./config.mjs";
import { loadAnalysis, readJsonOr } from "./load-analysis.mjs";
import { loadSampleEvents } from "./load-ts.mjs";

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
 * @param {Item} item
 * @param {Readonly<Record<string, { ja?: string, en?: string }>>} articles
 * @param {Readonly<Record<string, { ja?: string, en?: string }>>} placeLabels
 * @returns {Record<string, unknown> | null} HistEvent。日本語・英語のどちらのラベルも無ければ null
 */
export const toHistEvent = (item, articles, placeLabels) => {
  const title = item.labels.ja ?? item.labels.en;
  if (!title || item.start === null || item.classification.status !== "mapped") return null;
  const start = item.start.year;
  // 国の代表点しか無い項目（P495 / P17）。places は残し、印を付ける。地点を人が決めるまでは placeKind: "none"
  // （place-overrides の承認後に point / origin へ付け直す）。
  const countryOnly = item.countryLevelPlace;
  return {
    id: item.qid,
    title: { ja: title, ...(item.labels.ja && item.labels.en ? { en: item.labels.en } : {}) },
    domain: item.classification.domain,
    tags: item.classification.tags,
    ...temporalOf(item, start),
    start,
    places: item.places.map((p) => {
      const label = p.loc ? (placeLabels[p.loc]?.ja ?? placeLabels[p.loc]?.en) : undefined;
      return { lon: roundCoord(p.lon), lat: roundCoord(p.lat), ...(label ? { label } : {}) };
    }),
    ...(countryOnly ? { placeKind: "none", placeQuality: "country" } : {}),
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

const { population, fetchLog, listPages } = await loadAnalysis();
const [articles, placeLabels, sample] = await Promise.all([
  readJsonOr(ARTICLES_PATH, null),
  readJsonOr(PLACE_LABELS_PATH, null),
  loadSampleEvents(),
]);
if (!articles || !placeLabels) throw new Error("data/raw/app/ がありません。先に pnpm wikidata:fetch-app-extras を実行してください。");

const generated = population.flatMap((item) => {
  const event = toHistEvent(item, articles, placeLabels);
  return event ? [event] : [];
});
const noLabel = population.length - generated.length;

// 手書きのサンプルとの統合: QID が同じ項目は手書きを優先し（座標と説明が正確）、手書きにしか無い項目（slug の id）はそのまま足す
const sampleIds = new Set(sample.map((e) => e.id));
const duplicates = generated.filter((e) => sampleIds.has(/** @type {string} */ (e.id)));
const events = [...sample, ...generated.filter((e) => !sampleIds.has(/** @type {string} */ (e.id)))].sort(
  (a, b) => a.start - b.start || b.importance - a.importance || String(a.id).localeCompare(String(b.id)),
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
  },
  // period は重なる区間すべてに入るので、files の count の合計は total より大きい
  total: events.length,
  byDomain: countBy(events, (e) => e.domain),
  byImportance: countBy(events, (e) => e.importance),
  byPlaceKind: countBy(events, (e) => e.placeKind ?? "point"),
  // 年スライダーの目盛り用の要約。全区間のファイルを読まなくても目盛りを出せるように、importance 3 の項目だけを入れる
  // （全件だとほぼ毎年に目盛りが付き、目盛りの意味が無くなる）。地図に出さない項目は除く。
  ticks: events
    .filter((e) => e.importance === 3 && (e.placeKind ?? "point") !== "none")
    .map((e) => ({ kind: e.kind, start: e.start, ...(e.end !== undefined ? { end: e.end } : {}), domain: e.domain })),
  files: files.map((f) => ({ file: f.file, from: f.bin.from, to: f.bin.to, count: f.events.length, bytes: Buffer.byteLength(f.json) })),
};
await writeFile(join(APP_DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));

console.log(`母集団 ${population.length} 件 → ラベルなしで除外 ${noLabel} 件 → Wikidata 由来 ${generated.length} 件`);
console.log(`手書きサンプル ${sample.length} 件（うち Wikidata 由来と QID が重複 ${duplicates.length} 件、手書きを優先）→ 合計 ${events.length} 件`);
console.log("分類別:", JSON.stringify(manifest.byDomain));
console.log("importance 別:", JSON.stringify(manifest.byImportance), " placeKind 別:", JSON.stringify(manifest.byPlaceKind));
console.log("kind 別:", JSON.stringify(countBy(events, (e) => e.kind)));
console.log("出典別:", JSON.stringify(countBy(events, (e) => (e.source ?? "").replace(/^https:\/\/([^/]+)\/.*$/, "$1") || "なし")));
console.log(manifest.files.map((f) => `  ${f.file.padStart(10)}  ${String(f.count).padStart(5)} 件  ${(f.bytes / 1024).toFixed(0).padStart(5)} KB`).join("\n"));
console.log(`合計 ${(manifest.files.reduce((s, f) => s + f.bytes, 0) / 1024 / 1024).toFixed(2)} MB、${files.length} ファイル → ${APP_DATA_DIR}`);
