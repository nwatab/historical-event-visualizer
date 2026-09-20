// アプリ用データの生成に追加で要るものを取得して data/raw/app/ に保存する。
//
//   pnpm wikidata:fetch-app-extras
//
//   1. 母集団の各項目の、日本語版・英語版 Wikipedia の記事名（出典 URL 用。SPARQL の schema:about）
//   2. places の場所（P276 などの先の項目）のラベル（地名の表示用）
// 取得済みの分は問い合わせない。クエリは直列で、間隔を空ける（sparql.mjs の runQuery）。
import { mkdir, writeFile } from "node:fs/promises";
import { APP_RAW_DIR, ARTICLES_PATH, PLACE_LABELS_PATH } from "./config.mjs";
import { loadAnalysis, readJsonOr } from "./load-analysis.mjs";
import { buildArticlesQuery, buildLabelsQuery, qidOf, runQuery } from "./sparql.mjs";

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

console.log(`[1/2] Wikipedia の記事名（${population.length} 件）`);
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
console.log(`[2/2] 場所のラベル（${locQids.length} 件）`);
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
console.log(`完了。出力先: ${APP_RAW_DIR}`);
