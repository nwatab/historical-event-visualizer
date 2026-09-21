// OpenHistoricalMap から、1500 年以降に存在する国境（admin_level=2 の relation）を取得して data/raw/ohm/ に保存する。
//
//   pnpm ohm:fetch
//
//   1. admin_level=2 の境界の relation のタグを全件取る（約 10 MB）。日付は文字列なので、Overpass の式では比べず、手元で天文年にして選ぶ
//   2. 選んだ relation を RELATIONS_PER_CHUNK 件ずつ、メンバーの way（タグと geometry）と一緒に取る
// 取得済みのチャンクは問い合わせない（取り直すなら data/raw/ohm/ を消す）。データは CC0（README の出典）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BORDER_YEAR_MAX,
  BORDER_YEAR_MIN,
  CHUNK_DIR,
  FETCH_LOG_PATH,
  OVERPASS_TIMEOUT_S,
  RAW_DIR,
  RELATIONS_PER_CHUNK,
  TAGS_PATH,
} from "./config.mjs";
import { inBorderPeriod } from "./dates.mjs";
import { runOverpass } from "./overpass.mjs";

/** @template T @param {string} path @param {T} fallback @returns {Promise<T>} */
const readJsonOr = (path, fallback) => readFile(path, "utf8").then(JSON.parse, () => fallback);

/** @template T @param {readonly T[]} xs @param {number} size @returns {T[][]} */
const chunksOf = (xs, size) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

/** relation の表示名（並べ替えと報告用）。 @param {{ tags?: Record<string, string> }} relation */
const nameOf = (relation) => relation.tags?.["name:en"] ?? relation.tags?.name ?? "";

/**
 * Overpass の応答（relation の本体と、メンバーの way）を、保存する形にする。
 * - relation: id、タグ（name / name:en / name:ja / start_date / end_date / license など全部）、メンバーの way の id と role
 * - way: id、タグ、座標（[lon, lat] の列）
 * @param {any} body
 */
export const toChunk = (body) => ({
  osmBase: body.osm3s?.timestamp_osm_base ?? null,
  relations: body.elements
    .filter((/** @type {any} */ e) => e.type === "relation")
    .map((/** @type {any} */ r) => ({
      id: r.id,
      tags: r.tags ?? {},
      members: (r.members ?? []).filter((/** @type {any} */ m) => m.type === "way").map((/** @type {any} */ m) => ({ ref: m.ref, role: m.role })),
      // way 以外のメンバー（下位の relation、ノード）は使わない。数だけ残す
      otherMembers: (r.members ?? []).filter((/** @type {any} */ m) => m.type !== "way").length,
    })),
  ways: body.elements
    .filter((/** @type {any} */ e) => e.type === "way" && Array.isArray(e.geometry))
    .map((/** @type {any} */ w) => ({
      id: w.id,
      tags: w.tags ?? {},
      coords: w.geometry.map((/** @type {{ lon: number, lat: number }} */ p) => [p.lon, p.lat]),
    })),
});

await mkdir(CHUNK_DIR, { recursive: true });

console.log("[1/2] admin_level=2 の境界の relation のタグ");
/** @type {{ fetchedAt: string, osmBase: string | null, elements: any[] } | null} */
const cachedTags = await readJsonOr(TAGS_PATH, null);
const tags =
  cachedTags ??
  (await (async () => {
    const body = await runOverpass(
      `[out:json][timeout:${OVERPASS_TIMEOUT_S}];relation["boundary"="administrative"]["admin_level"="2"];out tags;`,
    );
    const saved = { fetchedAt: new Date().toISOString(), osmBase: body.osm3s?.timestamp_osm_base ?? null, elements: body.elements };
    await writeFile(TAGS_PATH, JSON.stringify(saved));
    return saved;
  })());
const selected = tags.elements
  .filter((e) => inBorderPeriod(e.tags ?? {}, BORDER_YEAR_MIN, BORDER_YEAR_MAX))
  // 同じ国の版（国境が変わるたびに別の relation）は way の大半を共有するので、名前順に並べて同じチャンクに寄せる（way の重複取得が減る）
  .sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || String(a.tags?.start_date).localeCompare(String(b.tags?.start_date)) || a.id - b.id);
console.log(`  全 ${tags.elements.length} 件 → ${BORDER_YEAR_MIN}〜${BORDER_YEAR_MAX} 年に存在する ${selected.length} 件（取得 ${tags.fetchedAt}）`);

const chunks = chunksOf(selected.map((e) => e.id), RELATIONS_PER_CHUNK);
console.log(`[2/2] geometry（${chunks.length} チャンク、${RELATIONS_PER_CHUNK} relation ずつ）`);
/** @type {{ chunk: string, relations: number, ways: number, bytes: number, fetchedAt: string }[]} */
const log = await readJsonOr(FETCH_LOG_PATH, []);
await chunks.reduce(async (previous, ids, index) => {
  const entries = await previous;
  // チャンクの名前は中身（relation の id）で決める。選ぶ条件や並びが変わっても、古いチャンクを取り違えない
  const file = `${ids[0]}-${ids[ids.length - 1]}-${ids.length}.json`;
  if (entries.some((e) => e.chunk === file)) return entries;
  const body = await runOverpass(
    `[out:json][timeout:${OVERPASS_TIMEOUT_S}];relation(id:${ids.join(",")})->.r;.r out body;way(r.r);out tags geom;`,
  );
  const chunk = toChunk(body);
  const json = JSON.stringify({ fetchedAt: new Date().toISOString(), ids, ...chunk });
  await writeFile(join(CHUNK_DIR, file), json);
  const next = [...entries, { chunk: file, relations: chunk.relations.length, ways: chunk.ways.length, bytes: Buffer.byteLength(json), fetchedAt: new Date().toISOString() }];
  await writeFile(FETCH_LOG_PATH, JSON.stringify(next, null, 1));
  console.log(`  ${index + 1} / ${chunks.length}  ${file}  relation ${chunk.relations.length}、way ${chunk.ways.length}、${(Buffer.byteLength(json) / 1e6).toFixed(1)} MB`);
  return next;
}, Promise.resolve(log));
console.log(`完了。出力先: ${RAW_DIR}`);
