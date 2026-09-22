// R4i: 下書き（data/raw/r4i/agents/*.json、または data/first-records.json）の根拠を機械的に確かめる。
//
//   node scripts/wikidata/r4i-verify.mjs                 # data/raw/r4i/agents/*.json の accepted
//   node scripts/wikidata/r4i-verify.mjs --final         # data/first-records.json の records
//
// 確かめること（どれも「根拠の書き方が本文と合っているか」であって、内容の正しさは人が確かめる）:
//   - yearBasis / place.basis が引く「ファイル:行」が data/raw/r4i/texts/ に実在する
//   - 年の数字（紀元前は「N BC」などの N）が、yearBasis の引く行のどれかに現れる
//   - 場所の QID に座標（P625）があり、その座標の地域（regions.mjs）
//   - place.basis の引く行に、場所の英語ラベルの語が現れるか（現れなければ警告。表記ゆれがあるので止めない）
//   - concept / record / place の QID のラベル（人が照合するために一覧に出す）
// 結果は data/raw/r4i/verify.md に出す。
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COUNTRIES_PATH, USER_AGENT, WIKIDATA_API } from "./config.mjs";
import { FIRST_RECORDS_PATH } from "./first-records.mjs";
import { buildCountryIndex, regionOf } from "./regions.mjs";
import { sleep } from "./sparql.mjs";
import { mdTable } from "./stats.mjs";

const R4I_DIR = join(import.meta.dirname, "..", "..", "data", "raw", "r4i");
const TEXT_DIR = join(R4I_DIR, "texts");
const final = process.argv.includes("--final");

const readJson = async (/** @type {string} */ p) => JSON.parse(await readFile(p, "utf8"));

/** @typedef {{ region: string, slug: string, title: string, year: number, yearBasis: string, place: { qid: string, label: string, basis: string }, concept: { qid: string, label: string } | null, record: { qid: string, label: string } | null, domain: string }} Row */

/** @returns {Promise<Row[]>} */
const loadRows = async () => {
  if (final) {
    const f = await readJson(FIRST_RECORDS_PATH);
    return f.records.map((/** @type {any} */ r) => ({ region: r.region ?? "?", slug: r.slug, title: r.title.ja, year: r.year, yearBasis: r.yearBasis, place: r.place, concept: r.concept, record: r.record, domain: r.domain }));
  }
  const files = (await readdir(join(R4I_DIR, "agents"))).filter((f) => f.endsWith(".json")).sort();
  const docs = await Promise.all(files.map((f) => readJson(join(R4I_DIR, "agents", f))));
  return docs.flatMap((d) =>
    d.accepted.map((/** @type {any} */ a) => ({ region: d.region, slug: a.slug, title: a.titleJa, year: a.year, yearBasis: a.yearBasis, place: a.place, concept: a.concept ?? null, record: a.record ?? null, domain: a.domain })),
  );
};

/**
 * 「en-foo.txt:2-3,12」「en-foo.txt:5」の形の引用を取り出す。
 * @param {string} text @returns {{ file: string, lines: number[] }[]}
 */
export const citations = (text) =>
  [...text.matchAll(/([a-z]{2,3}-[a-z0-9-]+\.txt):([\d,\s\-–]+)/g)].map((m) => ({
    file: m[1],
    lines: m[2]
      .split(/[,\s]+/)
      .filter(Boolean)
      .flatMap((part) => {
        const [a, b] = part.split(/[-–]/).map(Number);
        return Number.isFinite(b) && b >= a ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : Number.isFinite(a) ? [a] : [];
      }),
  }));

/** 年の数字の書き方（天文年 → 本文に出る数字）。 @param {number} year */
const yearNumber = (year) => String(year <= 0 ? 1 - year : year);

const textCache = new Map();
/** @param {string} file @returns {Promise<string[] | null>} 1 始まりの行番号で引ける配列（0 番目は空） */
const linesOf = async (file) => {
  if (!textCache.has(file)) {
    const text = await readFile(join(TEXT_DIR, file), "utf8").catch(() => null);
    textCache.set(file, text === null ? null : ["", ...text.split("\n")]);
  }
  return textCache.get(file);
};

/** @param {readonly string[]} qids */
const fetchEntities = async (qids) => {
  const out = new Map();
  for (let i = 0; i < qids.length; i += 50) {
    await sleep(1000);
    const url = new URL(WIKIDATA_API);
    url.search = new URLSearchParams({ action: "wbgetentities", ids: qids.slice(i, i + 50).join("|"), props: "labels|claims", languages: "ja|en", format: "json" }).toString();
    const body = await (await fetch(url, { headers: { "User-Agent": USER_AGENT } })).json();
    Object.entries(body.entities).forEach(([q, e]) => out.set(q, e));
  }
  return out;
};

const rows = await loadRows();
const countryIndex = buildCountryIndex(await readJson(COUNTRIES_PATH));
const qids = [...new Set(rows.flatMap((r) => [r.place.qid, r.concept?.qid, r.record?.qid].filter((q) => typeof q === "string" && /^Q\d+$/.test(q))))];
const entities = await fetchEntities(/** @type {string[]} */ (qids));
/** @param {string | undefined} q */
const label = (q) => {
  const e = q ? entities.get(q) : undefined;
  return e && e.missing === undefined ? `${e.labels?.ja?.value ?? "-"} / ${e.labels?.en?.value ?? "-"}` : "（存在しない）";
};

const results = await Promise.all(
  rows.map(async (r) => {
    const problems = [];
    const warnings = [];
    /** @param {string} text */
    const citedLines = async (text) =>
      (
        await Promise.all(
          citations(text).map(async (c) => {
            const lines = await linesOf(c.file);
            if (!lines) {
              problems.push(`ファイルが無い: ${c.file}`);
              return [];
            }
            const missing = c.lines.filter((n) => !lines[n]);
            if (missing.length > 0) problems.push(`行が無い: ${c.file}:${missing.join(",")}`);
            return c.lines.flatMap((n) => (lines[n] ? [lines[n]] : []));
          }),
        )
      ).flat();
    const yearLines = await citedLines(r.yearBasis);
    const placeLines = await citedLines(r.place.basis);
    if (citations(r.yearBasis).length === 0) problems.push("yearBasis に「ファイル:行」が無い");
    if (citations(r.place.basis).length === 0) problems.push("place.basis に「ファイル:行」が無い");
    const n = yearNumber(r.year);
    if (yearLines.length > 0 && !yearLines.some((l) => new RegExp(`(^|[^\\d])${n}([^\\d]|$)`).test(l))) problems.push(`年の数字 ${n} が引用の行に無い`);
    const e = entities.get(r.place.qid);
    const coord = e?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    if (!coord) problems.push(`場所 ${r.place.qid} に座標が無い`);
    const region = coord ? (regionOf(countryIndex, { lon: coord.longitude, lat: coord.latitude }).region ?? "none") : "none";
    if (coord && !final && region !== r.region) warnings.push(`座標の地域は ${region}`);
    const en = e?.labels?.en?.value ?? "";
    const words = en.split(/[\s,()-]+/).filter((w) => w.length >= 4);
    if (placeLines.length > 0 && words.length > 0 && !placeLines.some((l) => words.some((w) => l.toLowerCase().includes(w.toLowerCase())))) {
      warnings.push(`場所の英語ラベル（${en}）の語が引用の行に無い`);
    }
    return { r, problems, warnings, region };
  }),
);

const table = mdTable(
  ["地域", "slug", "title", "年", "分類", "場所（QID のラベル）", "概念", "文献・遺物", "問題", "警告"],
  results.map(({ r, problems, warnings, region }) => [
    final ? region : r.region,
    r.slug,
    r.title,
    r.year,
    r.domain,
    `${r.place.label} ${r.place.qid}（${label(r.place.qid)}）`,
    r.concept ? `${r.concept.label} ${r.concept.qid}（${label(r.concept.qid)}）` : "–",
    r.record ? `${r.record.label} ${r.record.qid}（${label(r.record.qid)}）` : "–",
    problems.join("。") || "",
    warnings.join("。") || "",
  ]),
  ["l", "l", "l", "r", "l", "l", "l", "l", "l", "l"],
);
await writeFile(join(R4I_DIR, final ? "verify-final.md" : "verify.md"), `# R4i 下書きの機械的な確認\n\n${table}\n`);
const bad = results.filter((x) => x.problems.length > 0);
console.log(`${results.length} 件、問題あり ${bad.length} 件、警告あり ${results.filter((x) => x.warnings.length > 0).length} 件`);
bad.forEach(({ r, problems }) => console.log(`  ${r.region} ${r.slug}: ${problems.join(" / ")}`));
