// data/raw/ohm/ の取得結果から、時代別の国境の線（GeoJSON）を作って public/data/borders/ に出力する。
//
//   pnpm ohm:build
//
// ネットワークには出ない。出力した JSON はコミットする（取得に 1 時間近くかかるので、CI では生成しない）。
// 年は OHM の日付の年の部分で、すでに天文年（dates.mjs）。
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import mapshaper from "mapshaper";
import {
  BORDERS_DIR,
  BORDER_YEAR_MAX,
  BORDER_YEAR_MIN,
  CHUNK_DIR,
  SIMPLIFY_TOLERANCE_DEG,
  SIMPLIFY_TOLERANCE_FALLBACK_DEG,
  SIZE_BUDGET_BYTES,
  TAGS_PATH,
} from "./config.mjs";
import { borderProperties, centuryBins, dropReason, isCc0, visibleIn } from "./borders.mjs";
import { inBorderPeriod } from "./dates.mjs";
import { EXCLUDED_RELATIONS } from "./exclusions.mjs";

/** @typedef {import("./borders.mjs").RawRelation} RawRelation */
/** @typedef {import("./borders.mjs").RawWay} RawWay */

/** 赤道での 1 度の長さ (m)。mapshaper の interval は、緯度経度のデータではメートルで指定する */
const METERS_PER_DEGREE = 111_320;
/** 出力する座標の刻み（度）。簡略化の許容（0.05°）より十分細かく、zoom 6 で 1px（約 2.4km）より小さい */
const COORD_PRECISION_DEG = 0.01;

/** @template T @param {readonly T[]} xs @param {(x: T) => string | number} key */
const countBy = (xs, key) => Object.fromEntries([...Map.groupBy(xs, key).entries()].map(([k, g]) => [k, g.length]));

/**
 * way の線を、mapshaper で位相を保ったまま簡略化する（共有する端点は動かない。同じ形を重ねて描いた way は、同じ形のまま簡略化される）。
 * @param {readonly RawWay[]} ways @param {number} toleranceDeg
 * @returns {Promise<Map<number, number[][][]>>} way の id → 線の列（簡略化で分かれることは無いが、GeoJSON の読み戻しに合わせて列にしている）
 */
const simplifyWays = async (ways, toleranceDeg) => {
  const input = JSON.stringify({
    type: "FeatureCollection",
    features: ways.map((w) => ({ type: "Feature", properties: { id: w.id }, geometry: { type: "LineString", coordinates: w.coords } })),
  });
  const output = await mapshaper.applyCommands(
    `-i ways.json -simplify dp interval=${Math.round(toleranceDeg * METERS_PER_DEGREE)} -o out.json format=geojson precision=${COORD_PRECISION_DEG}`,
    { "ways.json": input },
  );
  /** @type {{ features: { properties: { id: number }, geometry: { type: string, coordinates: any } | null }[] }} */
  const parsed = JSON.parse(output["out.json"].toString());
  return new Map(
    parsed.features.flatMap((f) =>
      f.geometry === null
        ? []
        : [[f.properties.id, f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates]],
    ),
  );
};

// ── 読み込み ──────────────────────────────────────────────

const chunkFiles = (await readdir(CHUNK_DIR).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
if (chunkFiles.length === 0) throw new Error("data/raw/ohm/chunks/ がありません。先に pnpm ohm:fetch を実行してください。");
const chunks = await Promise.all(chunkFiles.map(async (f) => JSON.parse(await readFile(join(CHUNK_DIR, f), "utf8"))));
const tagsFile = JSON.parse(await readFile(TAGS_PATH, "utf8"));
/** @type {Map<number, RawRelation>} */
const relationById = new Map(chunks.flatMap((c) => c.relations.map((/** @type {RawRelation} */ r) => [r.id, r])));
/** @type {Map<number, RawWay>} */
const wayById = new Map(chunks.flatMap((c) => c.ways.map((/** @type {RawWay} */ w) => [w.id, w])));

// 取得の対象に選んだのに、チャンクに無い relation（取得の途中で止まった、など）は、黙って落とさずに止める
const expectedIds = tagsFile.elements.filter((/** @type {any} */ e) => inBorderPeriod(e.tags ?? {}, BORDER_YEAR_MIN, BORDER_YEAR_MAX)).map((/** @type {any} */ e) => e.id);
const missing = expectedIds.filter((/** @type {number} */ id) => !relationById.has(id));
if (missing.length > 0) throw new Error(`取得していない relation が ${missing.length} 件あります（例: ${missing.slice(0, 5).join(", ")}）。pnpm ohm:fetch を最後まで実行してください。`);

// ── 選別 ──────────────────────────────────────────────────

const excludedIds = new Set(EXCLUDED_RELATIONS.map((e) => e.id));
const relations = [...relationById.values()].filter((r) => !excludedIds.has(r.id));
// license が CC0 以外の relation があれば、生成を止めて報告する（way の license は、下でその way だけを落とす）
const nonCc0 = relations.filter((r) => !isCc0(r.tags.license));
if (nonCc0.length > 0) {
  throw new Error(
    `license が CC0 でない relation が ${nonCc0.length} 件あります。exclusions.mjs で除くか、扱いを決めてください:\n` +
      nonCc0.map((r) => `  ${r.id} ${r.tags["name:en"] ?? r.tags.name} license=${r.tags.license}`).join("\n"),
  );
}

const usedWayIds = [...new Set(relations.flatMap((r) => r.members.map((m) => m.ref)))];
const usedWays = usedWayIds.flatMap((id) => wayById.get(id) ?? []);
const dropped = usedWays.flatMap((w) => {
  const reason = dropReason(w);
  return reason ? [{ way: w, reason }] : [];
});
const droppedIds = new Set(dropped.map((d) => d.way.id));
const keptWays = usedWays.filter((w) => !droppedIds.has(w.id) && w.coords.length >= 2);

// ── 簡略化と出力 ──────────────────────────────────────────

const bins = centuryBins(BORDER_YEAR_MIN, BORDER_YEAR_MAX);

/** @param {number} toleranceDeg */
const build = async (toleranceDeg) => {
  const simplified = await simplifyWays(keptWays, toleranceDeg);
  const features = relations.flatMap((relation) => {
    const properties = borderProperties(relation);
    if (properties === null) return [];
    const lines = [...new Set(relation.members.map((m) => m.ref))].flatMap((ref) => simplified.get(ref) ?? []);
    return lines.length === 0 ? [] : [{ type: "Feature", properties, geometry: { type: "MultiLineString", coordinates: lines } }];
  });
  const files = bins
    .map((bin) => {
      const mine = features.filter((f) => visibleIn(f.properties, bin)).sort((a, b) => a.properties.start - b.properties.start || a.properties.relationId - b.properties.relationId);
      return { bin, file: `${bin.from}.json`, count: mine.length, json: JSON.stringify({ type: "FeatureCollection", features: mine }) };
    })
    .filter((f) => f.count > 0);
  return { toleranceDeg, features, files, bytes: files.reduce((sum, f) => sum + Buffer.byteLength(f.json), 0) };
};

const first = await build(SIMPLIFY_TOLERANCE_DEG);
console.log(`許容 ${first.toleranceDeg}°: 合計 ${(first.bytes / 1e6).toFixed(2)} MB`);
const result = first.bytes > SIZE_BUDGET_BYTES ? await build(SIMPLIFY_TOLERANCE_FALLBACK_DEG) : first;
if (result !== first) console.log(`  ${(SIZE_BUDGET_BYTES / 1e6).toFixed(1)} MB を超えたので、許容 ${result.toleranceDeg}° で作り直した: 合計 ${(result.bytes / 1e6).toFixed(2)} MB`);

await mkdir(BORDERS_DIR, { recursive: true });
await Promise.all((await readdir(BORDERS_DIR)).filter((f) => f.endsWith(".json")).map((f) => rm(join(BORDERS_DIR, f))));
await Promise.all(result.files.map((f) => writeFile(join(BORDERS_DIR, f.file), f.json)));

const fetchedAts = chunks.map((c) => c.fetchedAt).sort();
const withoutLines = relations.filter((r) => !result.features.some((f) => f.properties.relationId === r.id));
const manifest = {
  generatedAt: new Date().toISOString(),
  source: {
    name: "OpenHistoricalMap",
    url: "https://www.openhistoricalmap.org/",
    license: "CC0",
    query: 'relation["boundary"="administrative"]["admin_level"="2"]',
    tagsFetchedAt: tagsFile.fetchedAt,
    osmBase: tagsFile.osmBase,
    geometryFetchedFrom: fetchedAts[0],
    geometryFetchedTo: fetchedAts[fetchedAts.length - 1],
  },
  yearMin: BORDER_YEAR_MIN,
  yearMax: BORDER_YEAR_MAX,
  simplifyToleranceDeg: result.toleranceDeg,
  coordPrecisionDeg: COORD_PRECISION_DEG,
  relations: { selected: relationById.size, excluded: relationById.size - relations.length, withLines: result.features.length, withoutLines: withoutLines.length },
  ways: { used: usedWays.length, kept: keptWays.length, dropped: countBy(dropped, (d) => d.reason) },
  // license で落とした way の、license の値ごとの数
  droppedLicenses: countBy(dropped.filter((d) => d.reason === "license"), (d) => d.way.tags.license),
  excluded: EXCLUDED_RELATIONS.map((e) => ({ ...e, inPeriod: relationById.has(e.id) })),
  totalBytes: result.bytes,
  files: result.files.map((f) => ({ file: f.file, from: f.bin.from, to: f.bin.to, count: f.count, bytes: Buffer.byteLength(f.json) })),
};
await writeFile(join(BORDERS_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));

console.log(`relation: 取得 ${relationById.size} 件、除外 ${manifest.relations.excluded} 件、線が残った ${manifest.relations.withLines} 件、線が 1 本も残らなかった ${withoutLines.length} 件`);
console.log(`way: 使われている ${usedWays.length} 本 → 残した ${keptWays.length} 本。落とした理由:`, JSON.stringify(manifest.ways.dropped), " license の内訳:", JSON.stringify(manifest.droppedLicenses));
console.log(`license が CC0 でない relation: ${nonCc0.length} 件`);
console.log(manifest.files.map((f) => `  ${f.file.padStart(10)}  ${String(f.count).padStart(5)} 件  ${(f.bytes / 1024).toFixed(0).padStart(6)} KB`).join("\n"));
console.log(`合計 ${(result.bytes / 1e6).toFixed(2)} MB（許容 ${result.toleranceDeg}°）→ ${BORDERS_DIR}`);
if (withoutLines.length > 0) console.log("線が残らなかった relation（上位）:", withoutLines.slice(0, 15).map((r) => `${r.tags["name:en"] ?? r.tags.name}(${r.tags.start_date})`).join("、"));
