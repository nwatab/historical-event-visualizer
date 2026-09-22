// 初期表示の年（src/lib/timeline.ts の INITIAL_YEAR）を選ぶための候補年のレポート。INITIAL_YEAR は変えない（判断は人がする）。
//
//   node scripts/wikidata/initial-year-candidates.mjs [--from 1500] [--to 2025] [--top 10] [--min-gap 1]
//
// 生成済みの public/data/events/ について、各年に「地図に出る importance 2 以上のイベント」を数え、次の 3 つの指標を出す。
// - 件数: その年のマーカーを持つイベントの数（id で重複を除く）
// - 分類エントロピー: そのイベントの分類（7 分類）の分布のシャノン・エントロピー（ビット。最大 log2 7 ≈ 2.81）。偏りが小さいほど大きい
// - 大陸別件数: イベントの primary の場所（places の最初の 1 点。diffusion は起点）が、どの大陸にあるか
//   （Natural Earth 1:50m の国ポリゴンの CONTINENT。判定は regions.mjs の regionOf と同じで、海上の点は最も近い国に寄せる）。
//   大陸エントロピーは、この分布のエントロピー（地域の偏りの小ささ）
// 「地図に出る」の判定は、アプリのコードをそのまま使う（timeline.ts の eventMarkers。instant は ±20 年の窓、period は期間中、
// diffusion は起点と到達点）。placeKind が "none" の項目は除く。ズームは見ない（importance 2 は世界全体の表示では、
// 密度による繰り上げが無い限り zoom 2 以上で出る）。
//
// 上位の表は、件数・分類エントロピー・大陸エントロピーのそれぞれと、3 つの順位の平均（総合）で並べる。
// --min-gap N を付けると、上位に選んだ年から N 年未満の年を飛ばす（1914〜1918 年のように隣り合う年が並ぶのを避ける）。
// Natural Earth の国ポリゴン（data/raw/。コミットしない）が無ければ、1 度だけ取りに行く（load-analysis.mjs と同じ）。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { APP_DATA_DIR } from "./config.mjs";
import { loadCountries } from "./load-analysis.mjs";
import { importFromSrc } from "./load-ts.mjs";
import { buildCountryIndex, regionOf } from "./regions.mjs";

const { values: args } = parseArgs({
  options: {
    from: { type: "string", default: "1500" },
    to: { type: "string", default: "2025" },
    top: { type: "string", default: "10" },
    "min-gap": { type: "string", default: "1" },
  },
});
const [FROM, TO, TOP, MIN_GAP] = [args.from, args.to, args.top, args["min-gap"]].map(Number);

const [{ eventMarkers, EVENT_WINDOW_YEARS, INITIAL_YEAR }, { mergeEventFiles }, { DOMAINS }] = await Promise.all([
  importFromSrc("lib/timeline.ts"),
  importFromSrc("lib/eventData.ts"),
  importFromSrc("lib/domain.ts"),
]);

/** 表に出す大陸の順と名前。Natural Earth の CONTINENT の値 → 表の見出し */
const CONTINENTS = /** @type {const} */ ([
  ["Europe", "欧"],
  ["Asia", "亜"],
  ["Africa", "阿"],
  ["North America", "北米"],
  ["South America", "南米"],
  ["Oceania", "大洋"],
]);
const OTHER = "他";

// ── 読み込み ──────────────────────────────────────────────

const manifest = JSON.parse(await readFile(join(APP_DATA_DIR, "manifest.json"), "utf8"));
/** @type {readonly { file: string, from: number, to: number }[]} */
const files = manifest.files.filter(
  (/** @type {{ from: number, to: number }} */ f) => f.from <= TO + EVENT_WINDOW_YEARS && f.to > FROM - EVENT_WINDOW_YEARS,
);
/** @type {readonly any[]} HistEvent の配列 */
const events = mergeEventFiles(
  await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(APP_DATA_DIR, f.file), "utf8")))),
);
const candidates = events.filter((e) => e.importance >= 2 && (e.placeKind ?? "point") !== "none" && e.places.length > 0);

const candidateById = new Map(candidates.map((e) => [e.id, e]));

const countries = await loadCountries();
const countryIndex = buildCountryIndex(countries);
/** @type {ReadonlyMap<string, string>} 国名（NAME）→ CONTINENT */
const continentByCountry = new Map(countries.features.map((/** @type {any} */ f) => [f.properties.NAME, f.properties.CONTINENT]));
const continentKeys = new Set(CONTINENTS.map(([key]) => key));
/** @type {ReadonlyMap<string, string>} イベントの id → 大陸（CONTINENTS の見出し、無ければ OTHER） */
const continentOf = new Map(
  candidates.map((e) => {
    const { country } = regionOf(countryIndex, e.places[0]);
    const continent = country === null ? undefined : continentByCountry.get(country);
    return [e.id, continent !== undefined && continentKeys.has(continent) ? continent : OTHER];
  }),
);

// ── 年ごとの指標 ──────────────────────────────────────────

/** 件数の分布のシャノン・エントロピー（ビット） @param {readonly number[]} counts */
const entropy = (counts) => {
  const total = counts.reduce((a, b) => a + b, 0);
  return total === 0
    ? 0
    : counts.filter((c) => c > 0).reduce((h, c) => h - (c / total) * Math.log2(c / total), 0);
};

/** @param {readonly string[]} keys @param {readonly string[]} values */
const countBy = (keys, values) => keys.map((key) => values.filter((v) => v === key).length);

const rows = Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i).map((year) => {
  const ids = [...new Set(eventMarkers(candidates, year).features.map((/** @type {any} */ f) => f.properties.id))];
  const shown = ids.map((id) => candidateById.get(id));
  const domains = countBy(DOMAINS, shown.map((e) => e.domain));
  const continentHeads = [...CONTINENTS.map(([key]) => key), OTHER];
  const continents = countBy(continentHeads, ids.map((id) => continentOf.get(id) ?? OTHER));
  return {
    year,
    count: ids.length,
    domainEntropy: entropy(domains),
    // 大陸エントロピーは、大陸が分かった分だけで計算する（「他」は海上・判定不能で、地域ではない）
    continentEntropy: entropy(continents.slice(0, CONTINENTS.length)),
    continents,
  };
});

// ── 順位 ──────────────────────────────────────────────────

/** 値の大きい順の順位（1 始まり。同じ値は同じ順位） @param {readonly number[]} values */
const ranks = (values) => values.map((v) => 1 + values.filter((w) => w > v).length);
const byCount = ranks(rows.map((r) => r.count));
const byDomain = ranks(rows.map((r) => r.domainEntropy));
const byContinent = ranks(rows.map((r) => r.continentEntropy));
const ranked = rows.map((r, i) => ({ ...r, rank: { count: byCount[i], domain: byDomain[i], continent: byContinent[i] } }));
const combined = (/** @type {(typeof ranked)[number]} */ r) => (r.rank.count + r.rank.domain + r.rank.continent) / 3;

/**
 * 上位 TOP 年。選んだ年から MIN_GAP 年未満の年は飛ばす。
 * @param {(a: (typeof ranked)[number], b: (typeof ranked)[number]) => number} compare
 */
const top = (compare) =>
  [...ranked]
    .sort((a, b) => compare(a, b) || a.year - b.year)
    .reduce((picked, r) => (picked.length < TOP && picked.every((p) => Math.abs(p.year - r.year) >= MIN_GAP) ? [...picked, r] : picked), /** @type {typeof ranked} */ ([]));

// ── 出力（Markdown） ──────────────────────────────────────

const table = (/** @type {typeof ranked} */ list) =>
  [
    `| 年 | 件数 | 分類エントロピー | 大陸エントロピー | ${[...CONTINENTS.map(([, head]) => head), OTHER].join(" | ")} | 順位（件数・分類・大陸） |`,
    `|---:|---:|---:|---:|${[...CONTINENTS, OTHER].map(() => "---:").join("|")}|---|`,
    ...list.map(
      (r) =>
        `| ${r.year} | ${r.count} | ${r.domainEntropy.toFixed(3)} | ${r.continentEntropy.toFixed(3)} | ${r.continents.join(" | ")} | ${r.rank.count}・${r.rank.domain}・${r.rank.continent} |`,
    ),
  ].join("\n");

console.log(
  [
    `# 初期表示の年の候補（${FROM}〜${TO} 年）`,
    "",
    `- データ: public/data/events/（manifest の生成日時 ${manifest.generatedAt}）。読んだ区間 ${files.map((f) => f.file).join(", ")}`,
    `- 対象: importance 2 以上で、地図に出る（placeKind が "none" でない）イベント ${candidates.length} 件。各年の数え方は eventMarkers（±${EVENT_WINDOW_YEARS} 年の窓など）`,
    `- 大陸: Natural Earth の CONTINENT（${CONTINENTS.map(([key, head]) => `${head} = ${key}`).join("、")}、${OTHER} = 海上・判定不能）`,
    `- 上位 ${TOP} 年。選んだ年から ${MIN_GAP} 年未満の年は飛ばす（--min-gap）`,
    "",
    `- 参考: いまの INITIAL_YEAR（${INITIAL_YEAR} 年）`,
    "",
    table(ranked.filter((r) => r.year === INITIAL_YEAR)),
    "",
    "## 総合（3 つの順位の平均が小さい順）",
    "",
    table(top((a, b) => combined(a) - combined(b))),
    "",
    "## 件数",
    "",
    table(top((a, b) => b.count - a.count)),
    "",
    "## 分類エントロピー",
    "",
    table(top((a, b) => b.domainEntropy - a.domainEntropy)),
    "",
    "## 大陸エントロピー",
    "",
    table(top((a, b) => b.continentEntropy - a.continentEntropy)),
  ].join("\n"),
);
