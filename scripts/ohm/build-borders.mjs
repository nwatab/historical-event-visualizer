// data/raw/ohm/ の取得結果から、時代別の国境の線（GeoJSON）を作って public/data/borders/ に出力する。
//
//   pnpm ohm:build
//   pnpm ohm:build --allow-unreviewed-licenses   … 受け入れると決めていない license があっても止めずに作る。報告を見るための確認用で、その出力はコミットしない
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
import { borderProperties, centuryBins, dropReason, visibleIn, waySpans } from "./borders.mjs";
import { inBorderPeriod } from "./dates.mjs";
import { EXCLUDED_RELATIONS } from "./exclusions.mjs";
import { acceptedLicense } from "./licenses.mjs";

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
const usedWayIds = [...new Set(relations.flatMap((r) => r.members.map((m) => m.ref)))];
const usedWays = usedWayIds.flatMap((id) => wayById.get(id) ?? []);
const dropped = usedWays.flatMap((w) => {
  const reason = dropReason(w);
  return reason ? [{ way: w, reason }] : [];
});
const droppedIds = new Set(dropped.map((d) => d.way.id));
const keptWays = usedWays.filter((w) => !droppedIds.has(w.id) && w.coords.length >= 2);

// license: CC0 と CC BY は受け入れ、それ以外（SA / NC / 読めない値）が relation か、残す way に 1 つでもあれば、生成を止めて報告する（licenses.mjs）
const allowUnreviewed = process.argv.includes("--allow-unreviewed-licenses");
const unaccepted = [
  ...relations.filter((r) => acceptedLicense(r.tags.license) === null).map((r) => ({ kind: "relation", id: r.id, license: r.tags.license })),
  ...keptWays.filter((w) => acceptedLicense(w.tags.license) === null).map((w) => ({ kind: "way", id: w.id, license: w.tags.license })),
];
if (unaccepted.length > 0) {
  const report =
    `受け入れると決めていない license が ${unaccepted.length} 件あります（licenses.mjs の REVIEWED_LICENSE_VALUES で決めるか、exclusions.mjs で relation を除いてください）:\n` +
    [...Map.groupBy(unaccepted, (u) => `${u.kind} license=${u.license}`).entries()]
      .map(([key, group]) => {
        const ids = new Set(group.map((g) => g.id));
        const names = group[0].kind === "way" ? [...new Set(relations.filter((r) => r.members.some((m) => ids.has(m.ref))).map((r) => r.tags["name:en"] ?? r.tags.name))] : [];
        return `  ${key}: ${group.length} 件（例: ${group.slice(0, 3).map((g) => g.id).join(", ")}）${names.length > 0 ? ` 使っている relation: ${names.slice(0, 8).join("、")}${names.length > 8 ? ` ほか ${names.length - 8}` : ""}` : ""}`;
      })
      .join("\n");
  if (!allowUnreviewed) throw new Error(report);
  console.warn(`${report}\n--allow-unreviewed-licenses: 止めずに続ける。この出力はコミットしない`);
}

// ── 簡略化と出力 ──────────────────────────────────────────

const bins = centuryBins(BORDER_YEAR_MIN, BORDER_YEAR_MAX);

// 線は way の単位で持つ（relation ごとに出すと、同じ way が版の数だけ重複する。borders.mjs の waySpans）。
// 期間と名前の組が同じ way は、1 つの feature（MultiLineString）にまとめる
const keptIds = new Set(keptWays.map((w) => w.id));
const relationInputs = relations.flatMap((relation) => {
  const properties = borderProperties(relation);
  return properties === null ? [] : [{ properties, wayIds: [...new Set(relation.members.map((m) => m.ref))].filter((id) => keptIds.has(id)) }];
});
const spans = waySpans(relationInputs, BORDER_YEAR_MIN, BORDER_YEAR_MAX);

/** @param {number} toleranceDeg */
const build = async (toleranceDeg) => {
  const simplified = await simplifyWays(keptWays, toleranceDeg);
  const pieces = [...spans.entries()].flatMap(([wayId, list]) => {
    const lines = simplified.get(wayId) ?? [];
    return lines.length === 0 ? [] : list.map((span) => ({ ...span, lines }));
  });
  const features = [...Map.groupBy(pieces, (p) => `${p.start}|${p.end}|${p.names.map((n) => n.name).join("|")}`).values()].map((group) => {
    const { start, end, names } = group[0];
    return {
      type: "Feature",
      properties: {
        // その線を国境に持つ国（隣り合う 2 国なら 2 つ）。英語名と、日本語名（name:ja が無い国は英語名のまま）
        name: names.map((n) => n.name).join(" / "),
        ...(names.some((n) => n.nameJa) ? { nameJa: names.map((n) => n.nameJa ?? n.name).join(" / ") } : {}),
        start,
        // BORDER_YEAR_MAX まで続く線には end を書かない
        ...(end > BORDER_YEAR_MAX ? {} : { end }),
      },
      geometry: { type: "MultiLineString", coordinates: group.flatMap((p) => p.lines) },
    };
  });
  const files = bins
    .map((bin) => {
      const mine = features.filter((f) => visibleIn(f.properties, bin)).sort((a, b) => a.properties.start - b.properties.start || a.properties.name.localeCompare(b.properties.name));
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
const withoutLines = relationInputs.filter((r) => r.wayIds.length === 0);
const manifest = {
  generatedAt: new Date().toISOString(),
  source: {
    name: "OpenHistoricalMap",
    url: "https://www.openhistoricalmap.org/",
    license: "CC0 / CC BY 4.0",
    attribution: "© OpenHistoricalMap contributors（CC0 / CC BY 4.0）",
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
  relations: { selected: relationById.size, excluded: relationById.size - relations.length, withLines: relationInputs.length - withoutLines.length, withoutLines: withoutLines.length },
  features: result.features.length,
  ways: { used: usedWays.length, kept: keptWays.length, dropped: countBy(dropped, (d) => d.reason) },
  // 残した way の、license 別の本数（正規化した名前。タグ無しは OHM の既定の CC0）と、タグの値そのままの内訳
  waysByLicense: countBy(keptWays, (w) => acceptedLicense(w.tags.license) ?? `未判断: ${w.tags.license}`),
  waysByLicenseTag: countBy(keptWays, (w) => w.tags.license ?? "(タグ無し)"),
  ...(allowUnreviewed && unaccepted.length > 0 ? { unreviewedLicenses: true } : {}),
  excluded: EXCLUDED_RELATIONS.map((e) => ({ ...e, inPeriod: relationById.has(e.id) })),
  totalBytes: result.bytes,
  files: result.files.map((f) => ({ file: f.file, from: f.bin.from, to: f.bin.to, count: f.count, bytes: Buffer.byteLength(f.json) })),
};
await writeFile(join(BORDERS_DIR, "manifest.json"), JSON.stringify(manifest, null, 1));

console.log(`relation: 取得 ${relationById.size} 件、除外 ${manifest.relations.excluded} 件、線が残った ${manifest.relations.withLines} 件、線が 1 本も残らなかった ${withoutLines.length} 件`);
console.log(`way: 使われている ${usedWays.length} 本 → 残した ${keptWays.length} 本。落とした理由:`, JSON.stringify(manifest.ways.dropped));
console.log("残した way の license:", JSON.stringify(manifest.waysByLicense), " タグの値:", JSON.stringify(manifest.waysByLicenseTag));
console.log("relation の license:", JSON.stringify(countBy(relations, (r) => r.tags.license ?? "(タグ無し)")));
console.log(manifest.files.map((f) => `  ${f.file.padStart(10)}  ${String(f.count).padStart(5)} 件  ${(f.bytes / 1024).toFixed(0).padStart(6)} KB`).join("\n"));
console.log(`合計 ${(result.bytes / 1e6).toFixed(2)} MB（許容 ${result.toleranceDeg}°）→ ${BORDERS_DIR}`);
if (withoutLines.length > 0) console.log("どの版にも線が残らなかった国（島など、国境が海岸線・海上の線だけのもの。例）:", [...new Set(withoutLines.map((r) => r.properties.name))].filter((name) => relationInputs.every((r) => r.properties.name !== name || r.wayIds.length === 0)).slice(0, 15).join("、"));
