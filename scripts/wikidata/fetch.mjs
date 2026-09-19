// R4a: Wikidata からイベント候補を取得して data/raw/wikidata/ に保存する。
//
//   pnpm wikidata:fetch                 全ルートを取得（取得済みチャンクは再利用）
//   pnpm wikidata:fetch --only=Q178561  指定ルートだけ取得して結合し直す
//
// 設計:
// - 時点（P585 など）の範囲フィルタはインデックスが効かず、年代だけで分割しても毎回 30〜50 秒かかる
//   （2026-09-20 に実測）。そこで、まずクラス（roots.mjs）で分割し、タイムアウトしたルートだけを
//   年代で二分割していく。
// - クエリは直列で、間隔を空ける（sparql.mjs の runQuery）。
// - チャンク単位で結果を保存し、再実行時は取得済みのチャンクを問い合わせない。
//   タイムアウトしたという結果も保存して、再実行時に同じ重いクエリを投げ直さない。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CHUNK_DIR,
  CLASS_LABELS_PATH,
  COORD_LOSS_PATH,
  EVENTS_PATH,
  FETCH_LOG_PATH,
  FIRST_SPLIT_YEAR,
  MANUAL_ITEMS,
  MANUAL_ITEMS_PATH,
  RAW_DIR,
  SLICE_RANGE,
} from "./config.mjs";
import { mergeChunks, toRow } from "./merge.mjs";
import { ROOTS } from "./roots.mjs";
import {
  buildCoordLossQuery,
  buildItemsQuery,
  buildLabelsQuery,
  buildManualItemsQuery,
  parseYear,
  qidOf,
  runQuery,
} from "./sparql.mjs";

/** @typedef {import("./sparql.mjs").Slice} Slice */
/** @typedef {import("./roots.mjs").Root} Root */
/**
 * @typedef {{ rootQid: string, slice: Slice | null, status: "ok" | "timeout" | "error",
 *   ms: number, fetchedAt: string, detail?: string, rows: readonly import("./merge.mjs").Row[] }} Chunk
 */

// ── 小道具 ────────────────────────────────────────────────

/** @param {string} path @returns {Promise<any | null>} */
const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
};

/** @param {string} path @param {unknown} value */
const writeJson = (path, value) => writeFile(path, JSON.stringify(value));

/**
 * 配列を順番に（直列に）処理する。エンドポイントに並列で投げないため。
 * @template T, U
 * @param {readonly T[]} items
 * @param {(item: T) => Promise<U>} fn
 * @returns {Promise<U[]>}
 */
const sequentially = (items, fn) =>
  items.reduce(
    async (acc, item) => [...(await acc), await fn(item)],
    /** @type {Promise<U[]>} */ (Promise.resolve([])),
  );

/** @template T @param {readonly T[]} xs @param {number} size @returns {T[][]} */
const chunksOf = (xs, size) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

/** @param {Slice | null} slice */
const sliceName = (slice) => (slice ? `${slice.from}_${slice.to}` : "all");

/** @param {Slice | null} slice @returns {Slice[]} 空配列ならこれ以上分割できない */
const splitSlice = (slice) => {
  if (!slice) {
    return [
      { from: SLICE_RANGE.from, to: FIRST_SPLIT_YEAR },
      { from: FIRST_SPLIT_YEAR, to: SLICE_RANGE.to },
    ];
  }
  if (slice.to - slice.from <= 1) return [];
  const mid = Math.floor((slice.from + slice.to) / 2);
  return [
    { from: slice.from, to: mid },
    { from: mid, to: slice.to },
  ];
};

// ── 取得 ──────────────────────────────────────────────────

/**
 * 1チャンクを取得する（取得済みならファイルから読む）。
 * @param {Root} root @param {Slice | null} slice @returns {Promise<Chunk>}
 */
const fetchChunk = async (root, slice) => {
  const path = join(CHUNK_DIR, `${root.qid}__${sliceName(slice)}.json`);
  /** @type {Chunk | null} */
  const cached = await readJson(path);
  if (cached && cached.status !== "error") return cached;

  const result = await runQuery(buildItemsQuery(root, slice));
  /** @type {Chunk} */
  const chunk = {
    rootQid: root.qid,
    slice,
    status: result.status,
    ms: result.ms,
    fetchedAt: new Date().toISOString(),
    ...(result.status === "error" ? { detail: result.detail } : {}),
    rows: result.status === "ok" ? result.bindings.map(toRow) : [],
  };
  await writeJson(path, chunk);
  console.log(
    `  ${root.qid} ${root.label} [${sliceName(slice)}] ${chunk.status} ` +
      `${chunk.rows.length} rows ${(chunk.ms / 1000).toFixed(1)}s`,
  );
  return chunk;
};

/**
 * 1ルート分を取得する。タイムアウトしたら年代を二分割して再帰する。
 * @param {Root} root @param {Slice | null} slice @returns {Promise<Chunk[]>}
 */
const fetchRoot = async (root, slice = null) => {
  const chunk = await fetchChunk(root, slice);
  if (chunk.status !== "timeout") return [chunk];
  const parts = splitSlice(slice);
  if (parts.length === 0) return [chunk]; // 1年幅でもタイムアウト。失敗として記録に残す
  return [chunk, ...(await sequentially(parts, (part) => fetchRoot(root, part))).flat()];
};

/**
 * P31 に現れたクラスのラベルを取る（取得済みの分は問い合わせない）。
 * @param {readonly string[]} qids
 * @returns {Promise<Record<string, { ja?: string, en?: string }>>}
 */
const fetchClassLabels = async (qids) => {
  /** @type {Record<string, { ja?: string, en?: string }>} */
  const known = (await readJson(CLASS_LABELS_PATH)) ?? {};
  const missing = qids.filter((q) => !(q in known));
  const batches = await sequentially(chunksOf(missing, 300), async (batch) => {
    const result = await runQuery(buildLabelsQuery(batch));
    if (result.status !== "ok") {
      console.warn(`  クラスのラベル取得に失敗（${batch.length} 件）: ${result.status}`);
      return [];
    }
    const found = result.bindings.map((b) => [
      qidOf(b.c.value),
      { ...(b.ja ? { ja: b.ja.value } : {}), ...(b.en ? { en: b.en.value } : {}) },
    ]);
    // ラベルが1つも無いクラスも「問い合わせ済み」として記録する
    return [...batch.map((q) => [q, {}]), ...found];
  });
  const labels = { ...known, ...Object.fromEntries(batches.flat()) };
  await writeJson(CLASS_LABELS_PATH, labels);
  return labels;
};

/**
 * ルートごとに「年はあるが座標が無くて落ちる件数」を数える。
 * @param {readonly Root[]} roots
 */
const fetchCoordLoss = async (roots) => {
  /** @type {Record<string, { withTime: number, withCoord: number, viaLocation: number } | { status: string }>} */
  const known = (await readJson(COORD_LOSS_PATH)) ?? {};
  const added = await sequentially(
    roots.filter((r) => !(r.qid in known)),
    async (root) => {
      const result = await runQuery(buildCoordLossQuery(root));
      const b = result.status === "ok" ? result.bindings[0] : null;
      const value = b
        ? {
            withTime: Number(b.withTime.value),
            withCoord: Number(b.withCoord.value),
            viaLocation: Number(b.viaLocation.value),
          }
        : { status: result.status };
      console.log(`  ${root.qid} ${root.label}: ${JSON.stringify(value)}`);
      return [root.qid, value];
    },
  );
  const counts = { ...known, ...Object.fromEntries(added) };
  await writeJson(COORD_LOSS_PATH, counts);
  return counts;
};

/**
 * 手動追加した項目を、取得条件（座標あり・年あり）と無関係に直接引く。
 * sitelinks 数と、取得条件のどれを満たしていないかを知るため。
 */
const fetchManualItems = async () => {
  const result = await runQuery(buildManualItemsQuery(MANUAL_ITEMS.map((m) => m.qid)));
  if (result.status !== "ok") {
    console.warn(`  手動追加項目の取得に失敗: ${result.status}`);
    return;
  }
  const rows = result.bindings;
  const items = MANUAL_ITEMS.map((m) => {
    const mine = rows.filter((b) => qidOf(b.item.value) === m.qid);
    /** @param {string} prop */
    const years = (prop) => [
      ...new Set(mine.filter((b) => b.prop?.value === prop).map((b) => parseYear(b.t.value))),
    ];
    return {
      ...m,
      sitelinks: Number(mine[0]?.links.value ?? 0),
      p31: [...new Set(mine.flatMap((b) => (b.p31 ? [qidOf(b.p31.value)] : [])))],
      hasCoord: mine.some((b) => b.coord),
      P585: years("P585"),
      P580: years("P580"),
      P582: years("P582"),
      P571: years("P571"),
    };
  });
  await writeJson(MANUAL_ITEMS_PATH, items);
};

// ── メイン ────────────────────────────────────────────────

const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const targets = only ? ROOTS.filter((r) => only.split(",").includes(r.qid)) : ROOTS;

await mkdir(CHUNK_DIR, { recursive: true });

console.log(`[1/4] 項目の取得（${targets.length} ルート）`);
await sequentially(targets, (root) => fetchRoot(root));

// 結合は --only に関係なく、保存済みの全ルートのチャンクから作り直す
console.log("[2/4] 結合");
const allChunks = (await sequentially(ROOTS, (root) => fetchRootFromCache(root))).flat();
const items = mergeChunks(allChunks.filter((c) => c.status === "ok"));
await writeJson(EVENTS_PATH, items);
await writeJson(
  FETCH_LOG_PATH,
  allChunks.map(({ rows, ...meta }) => ({ ...meta, rowCount: rows.length })),
);
console.log(`  ${items.length} 項目 → ${EVENTS_PATH}`);

console.log("[3/4] P31 クラスのラベル");
const classQids = [...new Set(items.flatMap((i) => i.p31))].sort();
await fetchClassLabels(classQids);
console.log(`  ${classQids.length} クラス`);

console.log("[4/4] 座標が無くて落ちる件数・手動追加4件");
await fetchCoordLoss(targets);
await fetchManualItems();
console.log(`完了。出力先: ${RAW_DIR}`);

/**
 * 保存済みのチャンクだけを辿る（問い合わせはしない）。
 * @param {Root} root @param {Slice | null} [slice] @returns {Promise<Chunk[]>}
 */
async function fetchRootFromCache(root, slice = null) {
  /** @type {Chunk | null} */
  const chunk = await readJson(join(CHUNK_DIR, `${root.qid}__${sliceName(slice)}.json`));
  if (!chunk) return [];
  if (chunk.status !== "timeout") return [chunk];
  const parts = await sequentially(splitSlice(slice), (part) => fetchRootFromCache(root, part));
  return [chunk, ...parts.flat()];
}
