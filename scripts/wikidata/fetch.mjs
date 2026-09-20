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
// - R4b-1: ルートの group によってクエリを変える（roots.mjs）。war は座標を必須にせず P276 の先の座標も取り、
//   engagement は P361（親）も取る。それ以外のルートは R4a で取得したチャンクをそのまま使う。
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
  PARENTS_PATH,
  RAW_DIR,
  SLICE_RANGE,
} from "./config.mjs";
import { mergeChunks, toLocRow, toRow } from "./merge.mjs";
import { ROOTS } from "./roots.mjs";
import {
  buildCoordLossQuery,
  buildItemsQuery,
  buildLabelsQuery,
  buildManualItemsQuery,
  buildParentsQuery,
  buildWarFlagsQuery,
  parseYear,
  qidOf,
  runQuery,
} from "./sparql.mjs";

/** @typedef {import("./sparql.mjs").Slice} Slice */
/** @typedef {import("./roots.mjs").Root} Root */
/** @typedef {import("./sparql.mjs").QueryKind} QueryKind */
/**
 * rows は kind が "warloc" のときだけ LocRow、それ以外は Row。
 * @typedef {{ rootQid: string, kind?: QueryKind, slice: Slice | null, status: "ok" | "timeout" | "error",
 *   ms: number, fetchedAt: string, detail?: string, rows: readonly any[] }} Chunk
 */

/**
 * ルートの group → 投げるクエリの種類。war は本体と場所（P276）の2本。
 * @param {Root} root @returns {QueryKind[]}
 */
const kindsOf = (root) => (root.group === "war" ? ["war", "warloc"] : root.group === "engagement" ? ["engagement"] : ["items"]);

/**
 * チャンクのファイル名。"items" は R4a のときの名前のままにして、取得済みの分を再利用する。
 * @param {Root} root @param {Slice | null} slice @param {QueryKind} kind
 */
const chunkPath = (root, slice, kind) =>
  join(CHUNK_DIR, `${root.qid}__${sliceName(slice)}${kind === "items" ? "" : `__${kind}`}.json`);

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
 * @param {Root} root @param {Slice | null} slice @param {QueryKind} kind @returns {Promise<Chunk>}
 */
const fetchChunk = async (root, slice, kind) => {
  const path = chunkPath(root, slice, kind);
  /** @type {Chunk | null} */
  const cached = await readJson(path);
  if (cached && cached.status !== "error") return cached;

  // engagement のクエリは R4a の items のクエリに P361 を足しただけなので、
  // R4a でタイムアウトした範囲は投げずに分割へ進む（60 秒のクエリを無駄に投げない）。
  /** @type {Chunk | null} */
  const legacy = kind === "engagement" ? await readJson(chunkPath(root, slice, "items")) : null;
  const result = legacy?.status === "timeout" ? { status: /** @type {const} */ ("timeout"), ms: 0 } : await runQuery(buildItemsQuery(root, slice, kind));
  /** @type {Chunk} */
  const chunk = {
    rootQid: root.qid,
    kind,
    slice,
    status: result.status,
    ms: result.ms,
    fetchedAt: new Date().toISOString(),
    ...(result.status === "error" ? { detail: result.detail } : {}),
    rows: result.status === "ok" ? result.bindings.map((b) => (kind === "warloc" ? toLocRow(b) : toRow(b))) : [],
  };
  await writeJson(path, chunk);
  console.log(
    `  ${root.qid} ${root.label} <${kind}> [${sliceName(slice)}] ${chunk.status} ` +
      `${chunk.rows.length} rows ${(chunk.ms / 1000).toFixed(1)}s`,
  );
  return chunk;
};

/**
 * 1ルート × 1種類のクエリ分を取得する。タイムアウトしたら年代を二分割して再帰する。
 * @param {Root} root @param {QueryKind} kind @param {Slice | null} [slice] @returns {Promise<Chunk[]>}
 */
const fetchRoot = async (root, kind, slice = null) => {
  const chunk = await fetchChunk(root, slice, kind);
  if (chunk.status !== "timeout") return [chunk];
  const parts = splitSlice(slice);
  if (parts.length === 0) return [chunk]; // 1年幅でもタイムアウト。失敗として記録に残す
  return [chunk, ...(await sequentially(parts, (part) => fetchRoot(root, kind, part))).flat()];
};

/**
 * 保存済みのチャンクだけを辿る（問い合わせはしない）。
 * @param {Root} root @param {QueryKind} kind @param {Slice | null} [slice] @returns {Promise<Chunk[]>}
 */
const readRootFromCache = async (root, kind, slice = null) => {
  /** @type {Chunk | null} */
  const chunk = await readJson(chunkPath(root, slice, kind));
  if (!chunk) return [];
  if (chunk.status !== "timeout") return [{ ...chunk, kind }];
  const parts = await sequentially(splitSlice(slice), (part) => readRootFromCache(root, kind, part));
  return [{ ...chunk, kind }, ...parts.flat()];
};

/**
 * P361 の先（親）のうち取得済みの項目に無いものを引く。親の親まで、最大 rounds 段。
 * 戦線や方面作戦を挟んで戦争につながる連鎖（会戦 → 東部戦線 → 第二次世界大戦）を辿るため。
 * @param {readonly import("./merge.mjs").RawItem[]} items
 * @param {number} rounds
 */
const fetchParents = async (items, rounds = 3) => {
  /** @typedef {{ labels: { ja?: string, en?: string }, p31: string[], parents: string[], sitelinks: number }} Parent */
  /** @type {Record<string, Parent>} */
  const known = (await readJson(PARENTS_PATH)) ?? {};
  const fetched = new Set(items.map((i) => i.qid));
  /** @param {Record<string, Parent>} parents @param {number} left @returns {Promise<Record<string, Parent>>} */
  const step = async (parents, left) => {
    const wanted = [...new Set([...items.flatMap((i) => i.parents), ...Object.values(parents).flatMap((p) => p.parents)])];
    const missing = wanted.filter((q) => !fetched.has(q) && !(q in parents)).sort();
    if (missing.length === 0 || left === 0) return parents;
    console.log(`  親の項目 ${missing.length} 件を取得`);
    const batches = await sequentially(chunksOf(missing, 250), async (batch) => {
      const result = await runQuery(buildParentsQuery(batch));
      if (result.status !== "ok") {
        console.warn(`  親の取得に失敗（${batch.length} 件）: ${result.status}`);
        return [];
      }
      return [...Map.groupBy(result.bindings, (b) => qidOf(b.item.value)).entries()].map(([qid, rows]) => [
        qid,
        {
          labels: {
            ...(rows.find((b) => b.ja) ? { ja: rows.find((b) => b.ja)?.ja.value } : {}),
            ...(rows.find((b) => b.en) ? { en: rows.find((b) => b.en)?.en.value } : {}),
          },
          p31: [...new Set(rows.flatMap((b) => (b.p31 ? [qidOf(b.p31.value)] : [])))].sort(),
          parents: [...new Set(rows.flatMap((b) => (b.parent ? [qidOf(b.parent.value)] : [])))].sort(),
          sitelinks: Number(rows[0].links.value),
        },
      ]);
    });
    const next = { ...parents, ...Object.fromEntries(batches.flat()) };
    await writeJson(PARENTS_PATH, next);
    return step(next, left - 1);
  };
  return step(known, rounds);
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

/**
 * 親の項目に「戦争かどうか」の印（isWar）を付ける。印が付いていない分だけ問い合わせる。
 * @param {Record<string, any>} parents
 */
const flagWarParents = async (parents) => {
  const warRoots = ROOTS.filter((r) => r.group === "war").map((r) => r.qid);
  const todo = Object.keys(parents).filter((q) => parents[q].isWar === undefined).sort();
  const flagged = await sequentially(chunksOf(todo, 250), async (batch) => {
    const result = await runQuery(buildWarFlagsQuery(batch, warRoots));
    if (result.status !== "ok") {
      console.warn(`  戦争かどうかの判定に失敗（${batch.length} 件）: ${result.status}`);
      return [];
    }
    const wars = new Set(result.bindings.map((b) => qidOf(b.item.value)));
    return batch.map((q) => [q, { ...parents[q], isWar: wars.has(q) }]);
  });
  const next = { ...parents, ...Object.fromEntries(flagged.flat()) };
  await writeJson(PARENTS_PATH, next);
  return next;
};

// ── メイン ────────────────────────────────────────────────

const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const targets = only ? ROOTS.filter((r) => only.split(",").includes(r.qid)) : ROOTS;

await mkdir(CHUNK_DIR, { recursive: true });

const jobs = targets.flatMap((root) => kindsOf(root).map((kind) => ({ root, kind })));
console.log(`[1/5] 項目の取得（${targets.length} ルート、${jobs.length} 系統）`);
await sequentially(jobs, ({ root, kind }) => fetchRoot(root, kind));

// 結合は --only に関係なく、保存済みの全ルートのチャンクから作り直す
console.log("[2/5] 結合");
const allJobs = ROOTS.flatMap((root) => kindsOf(root).map((kind) => ({ root, kind })));
const allChunks = (await sequentially(allJobs, ({ root, kind }) => readRootFromCache(root, kind))).flat();
const okChunks = allChunks.filter((c) => c.status === "ok");
const items = mergeChunks(
  okChunks.filter((c) => c.kind !== "warloc"),
  okChunks.filter((c) => c.kind === "warloc").flatMap((c) => c.rows),
);
await writeJson(EVENTS_PATH, items);
await writeJson(
  FETCH_LOG_PATH,
  allChunks.map(({ rows, ...meta }) => ({ ...meta, rowCount: rows.length })),
);
console.log(`  ${items.length} 項目 → ${EVENTS_PATH}`);

console.log("[3/5] P361 の親");
const parents = await flagWarParents(await fetchParents(items));
console.log(`  ${Object.keys(parents).length} 件（うち戦争 ${Object.values(parents).filter((p) => p.isWar).length} 件）`);

console.log("[4/5] P31 クラスのラベル");
const classQids = [...new Set([...items.flatMap((i) => i.p31), ...Object.values(parents).flatMap((p) => p.p31)])].sort();
await fetchClassLabels(classQids);
console.log(`  ${classQids.length} クラス`);

console.log("[5/5] 座標が無くて落ちる件数・手動追加4件");
await fetchCoordLoss(targets);
await fetchManualItems();
console.log(`完了。出力先: ${RAW_DIR}`);
