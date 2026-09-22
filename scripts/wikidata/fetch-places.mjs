// 場所の項目（戦争の P276、リスト項目の P189 / P276 / P159 / P740 / P291 / P495 / P17 の先、place-overrides.json の根拠の項目、
// data/diffusion/*.json の起点・到達点、data/first-records.json の場所）の P31 を取得して
// data/raw/app/place-classes.json に保存する。場所の粒度（place-granularity.mjs）の判定に使う。
//
//   pnpm wikidata:fetch-places
//
// SPARQL ではなく Wikidata の API（wbgetentities、50 件ずつ）を使う。WDQS は混雑でタイムアウトが続くことがあり
// （2026-09-20）、QID を指定して項目を引くだけなら API のほうが確実なため。
// wbgetentities はプロパティを絞れないので、項目のクレーム全体が返る（50 件で圧縮後 1MB 強）。保存するのは P31 とラベルだけ。
// 直列で間隔を空け、取得済みの分は問い合わせない。P31 に現れたクラスの英語ラベルも、同じ方法で取る。
import { mkdir, writeFile } from "node:fs/promises";
import {
  APP_RAW_DIR,
  EVENTS_PATH,
  LIST_ATTRS_PATH,
  PLACE_CLASSES_PATH,
  PLACE_CLASS_LABELS_PATH,
  PLACE_OVERRIDES_PATH,
  RETRY_DELAYS_MS,
  USER_AGENT,
  WIKIDATA_API,
} from "./config.mjs";
import { loadDiffusionFiles } from "./diffusion.mjs";
import { loadFirstRecords } from "./first-records.mjs";
import { readJson, readJsonOr } from "./load-analysis.mjs";
import { sleep } from "./sparql.mjs";

const PAUSE_MS = 1_000;
const BATCH = 50;

/** @template T @param {readonly T[]} xs @param {number} size @returns {T[][]} */
const chunksOf = (xs, size) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

/**
 * @param {readonly string[]} ids @param {string} props
 * @param {readonly number[]} [delays]
 * @returns {Promise<Record<string, any>>} entities
 */
const getEntities = async (ids, props, delays = RETRY_DELAYS_MS) => {
  await sleep(PAUSE_MS);
  const url = new URL(WIKIDATA_API);
  url.search = new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props, languages: "ja|en|mul", format: "json", maxlag: "5" }).toString();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) }).catch(() => null);
  const body = res?.ok ? await res.json().catch(() => null) : null;
  if (body?.entities) return body.entities;
  if (delays.length === 0) throw new Error(`wbgetentities: ${body?.error?.code ?? res?.status ?? "接続できない"}`);
  console.warn(`  wbgetentities: ${body?.error?.code ?? res?.status ?? "接続できない"} — ${delays[0] / 1000}s 待って再試行`);
  await sleep(delays[0]);
  return getEntities(ids, props, delays.slice(1));
};

/** @param {any} entity @param {"ja" | "en"} lang */
const labelOf = (entity, lang) => entity.labels?.[lang]?.value ?? (lang === "en" ? entity.labels?.mul?.value : undefined);

/**
 * 足りない QID の分だけ取得して path に貯める。
 * @param {string} path @param {readonly string[]} qids @param {string} props
 * @param {(entity: any) => unknown} pick 保存する値
 */
const fill = async (path, qids, props, pick) => {
  /** @type {Record<string, unknown>} */
  const known = await readJsonOr(path, {});
  const batches = chunksOf(qids.filter((q) => !(q in known)).sort(), BATCH);
  return batches.reduce(async (accP, batch, i) => {
    const acc = await accP;
    const entities = await getEntities(batch, props);
    // 項目が無い（削除・統合された）QID も「問い合わせ済み」として null で記録する
    const next = { ...acc, ...Object.fromEntries(batch.map((q) => [q, entities[q] && !("missing" in entities[q]) ? pick(entities[q]) : null])) };
    if (i % 10 === 9 || i === batches.length - 1) {
      await writeFile(path, JSON.stringify(next));
      console.log(`  ${Math.min((i + 1) * BATCH, batches.length * BATCH)} / ${batches.length * BATCH}`);
    }
    return next;
  }, Promise.resolve(known));
};

await mkdir(APP_RAW_DIR, { recursive: true });
const [events, attrs, placeOverrides, diffusionFiles, firstRecords] = await Promise.all([
  readJson(EVENTS_PATH),
  readJsonOr(LIST_ATTRS_PATH, {}),
  readJson(PLACE_OVERRIDES_PATH),
  loadDiffusionFiles(),
  loadFirstRecords(),
]);
const placeQids = [
  ...new Set([
    ...events.flatMap((/** @type {any} */ e) => [...(e.locations ?? []).map((/** @type {any} */ l) => l.qid), ...(e.locationsWithoutCoord ?? [])]),
    ...Object.values(attrs).flatMap((/** @type {any} */ a) => a.places.flatMap((/** @type {any} */ p) => (p.loc ? [p.loc] : []))),
    // 人が決めた場所のうち、根拠の項目そのものの座標を使うもの（本部所在地の先の座標は fine として扱うので要らない）
    ...placeOverrides.overrides.flatMap((/** @type {import("./place-overrides.mjs").PlaceOverride} */ o) =>
      (o.places ?? []).flatMap((p) => (p.path === "P625" ? [p.from] : [])),
    ),
    // 広がる出来事（diffusion）の起点・到達点（下書きのぶんも取る）
    ...diffusionFiles.flatMap(({ data }) => [data.origin, ...data.stages].map((p) => p.qid)),
    // 初出の記録（data/first-records.json）の場所（下書きのぶんも取る）
    ...firstRecords.records.map((r) => r.place.qid),
  ]),
];
console.log(`[1/2] 場所の項目の P31（${placeQids.length} 件）`);
const places = await fill(PLACE_CLASSES_PATH, placeQids, "claims|labels", (entity) => {
  const ja = labelOf(entity, "ja");
  const en = labelOf(entity, "en");
  return {
    // 非推奨ランクの値は除く
    p31: (entity.claims?.P31 ?? [])
      .filter((/** @type {any} */ s) => s.rank !== "deprecated" && s.mainsnak?.datavalue?.value?.id)
      .map((/** @type {any} */ s) => s.mainsnak.datavalue.value.id),
    ...(ja ? { ja } : {}),
    ...(en ? { en } : {}),
  };
});

const classQids = [...new Set(Object.values(places).flatMap((/** @type {any} */ p) => p?.p31 ?? []))];
console.log(`[2/2] P31 のクラスのラベル（${classQids.length} 件）`);
await fill(PLACE_CLASS_LABELS_PATH, classQids, "labels", (entity) => labelOf(entity, "en") ?? "");
console.log(`完了。出力先: ${APP_RAW_DIR}`);
