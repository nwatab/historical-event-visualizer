// アプリ用データの生成に追加で要るものを取得して data/raw/app/ に保存する。
//
//   pnpm wikidata:fetch-app-extras
//
//   1. 母集団の各項目の、日本語版・英語版 Wikipedia の記事名（出典 URL 用。SPARQL の schema:about）
//   2. places の場所（P276 などの先の項目）のラベル（地名の表示用）
//   3. 日本語・英語のラベルが無い項目の、多言語共通ラベル（mul）
//   4. place-overrides.json（人が承認した地点・起点）の places[].from の座標と、data/diffusion/*.json の起点・到達点の座標
// 取得済みの分は問い合わせない。クエリは直列で、間隔を空ける（sparql.mjs の runQuery）。
import { mkdir, writeFile } from "node:fs/promises";
import {
  APP_RAW_DIR,
  ARTICLES_PATH,
  MUL_LABELS_PATH,
  OVERRIDE_PLACES_PATH,
  PLACE_LABELS_PATH,
  PLACE_OVERRIDES_PATH,
} from "./config.mjs";
import { diffusionPlaceRefs, loadDiffusionFiles } from "./diffusion.mjs";
import { loadAnalysis, readJson, readJsonOr } from "./load-analysis.mjs";
import { placeKey } from "./place-overrides.mjs";
import {
  buildArticlesQuery,
  buildLabelsQuery,
  buildMulLabelsQuery,
  buildOverridePlaceQuery,
  parseYear,
  qidOf,
  runQuery,
} from "./sparql.mjs";

/** @template T @param {readonly T[]} xs @param {number} size @returns {T[][]} */
const chunksOf = (xs, size) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

/**
 * 足りない QID の分だけ、batchSize 件ずつ問い合わせて path に貯める。失敗したバッチは飛ばす（再実行で取り直す）。
 * @param {string} path
 * @param {readonly string[]} qids
 * @param {number} batchSize
 * @param {(batch: readonly string[]) => Promise<[string, unknown][] | null>} fetchBatch
 */
const fillCache = async (path, qids, batchSize, fetchBatch) => {
  /** @type {Record<string, unknown>} */
  const known = await readJsonOr(path, {});
  const batches = chunksOf(qids.filter((q) => !(q in known)).sort(), batchSize);
  return batches.reduce(async (accP, batch, i) => {
    const acc = await accP;
    const rows = await fetchBatch(batch);
    if (!rows) {
      console.warn(`  取得に失敗（${batch.length} 件）。再実行すれば、この分だけ取り直す`);
      return acc;
    }
    const next = { ...acc, ...Object.fromEntries(rows) };
    await writeFile(path, JSON.stringify(next));
    if (i % 10 === 9 || i === batches.length - 1) console.log(`  バッチ ${i + 1} / ${batches.length}`);
    return next;
  }, Promise.resolve(known));
};

const LANG_BY_SITE = /** @type {Record<string, "ja" | "en">} */ ({
  "https://ja.wikipedia.org/": "ja",
  "https://en.wikipedia.org/": "en",
});

await mkdir(APP_RAW_DIR, { recursive: true });
const { population } = await loadAnalysis();

console.log(`[1/4] Wikipedia の記事名（${population.length} 件）`);
await fillCache(ARTICLES_PATH, population.map((i) => i.qid), 300, async (batch) => {
  const result = await runQuery(buildArticlesQuery(batch));
  if (result.status !== "ok") return null;
  const byItem = Map.groupBy(result.bindings, (b) => qidOf(b.item.value));
  // 記事が1つも無い項目も「問い合わせ済み」として空で記録する
  return batch.map((qid) => [
    qid,
    Object.fromEntries((byItem.get(qid) ?? []).map((b) => [LANG_BY_SITE[b.site.value], b.name.value])),
  ]);
});

const locQids = [...new Set(population.flatMap((i) => i.places.flatMap((p) => (p.loc ? [p.loc] : []))))];
console.log(`[2/4] 場所のラベル（${locQids.length} 件）`);
await fillCache(PLACE_LABELS_PATH, locQids, 300, async (batch) => {
  const result = await runQuery(buildLabelsQuery(batch));
  if (result.status !== "ok") return null;
  const byItem = Map.groupBy(result.bindings, (b) => qidOf(b.c.value));
  return batch.map((qid) => {
    const rows = byItem.get(qid) ?? [];
    const ja = rows.find((b) => b.ja)?.ja.value;
    const en = rows.find((b) => b.en)?.en.value;
    return [qid, { ...(ja ? { ja } : {}), ...(en ? { en } : {}) }];
  });
});
const unlabeled = population.filter((i) => !i.labels.ja && !i.labels.en).map((i) => i.qid);
console.log(`[3/4] 多言語共通ラベル（${unlabeled.length} 件）`);
await fillCache(MUL_LABELS_PATH, unlabeled, 300, async (batch) => {
  const result = await runQuery(buildMulLabelsQuery(batch));
  if (result.status !== "ok") return null;
  const byItem = new Map(result.bindings.map((b) => [qidOf(b.item.value), b.mul.value]));
  return batch.map((qid) => [qid, byItem.get(qid) ?? null]);
});

/** @type {import("./place-overrides.mjs").PlaceOverrides} */
const overrides = await readJson(PLACE_OVERRIDES_PATH);
// 広がる出来事（diffusion）の起点・到達点も、同じ方法（QID → P625）で引く。下書き（status: "draft"）のぶんも取る
const diffusionPlaces = (await loadDiffusionFiles()).flatMap(({ data }) => diffusionPlaceRefs(data));
const overridePlaces = [
  ...new Map([...overrides.overrides.flatMap((o) => o.places ?? []), ...diffusionPlaces].map((pl) => [placeKey(pl), pl])).values(),
];
console.log(`[4/4] place-overrides と diffusion の座標（${overridePlaces.length} か所）`);
const placeByKey = new Map(overridePlaces.map((pl) => [placeKey(pl), pl]));
await fillCache(OVERRIDE_PLACES_PATH, [...placeByKey.keys()], 1, async ([key]) => {
  const place = /** @type {import("./place-overrides.mjs").OverridePlace} */ (placeByKey.get(key));
  const result = await runQuery(buildOverridePlaceQuery(place.from, place.path));
  if (result.status !== "ok") return null;
  return [
    [
      key,
      result.bindings.map((b) => ({
        lat: Number(b.lat.value),
        lon: Number(b.lon.value),
        precision: b.prec ? Number(b.prec.value) : null,
        ...(b.hq ? { hq: qidOf(b.hq.value) } : {}),
        from: b.from ? parseYear(b.from.value) : null,
        to: b.to ? parseYear(b.to.value) : null,
        ...(b.ja ? { labelJa: b.ja.value } : {}),
        ...(b.en ? { labelEn: b.en.value } : {}),
      })),
    ],
  ];
});
console.log(`完了。出力先: ${APP_RAW_DIR}`);
