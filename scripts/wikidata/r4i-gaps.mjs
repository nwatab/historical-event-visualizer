// R4i 段階 1: 1500 年より前の科学・技術・経済・交易の「空き具合」を、地域 × 年代（500 年刻み）の表にする。
//
//   node scripts/wikidata/r4i-gaps.mjs   # 標準出力に Markdown を出す
//
// 既存: public/data/events/ の生成データ（開始年が 1500 年より前で、主分類が science / technology / economy の項目）。
// 候補（重ねて出す）:
//   (1) REPORT-R4g-dropped-dated.md の行のうち、Wikidata の年が 1500 年より前のもの（いまの生成データに入ったものは除く）
//   (2) R4g の基準 B の一覧記事の行（主題の QID が、いまの生成データにも (1) にも無いもの。照合不能の行も数える）
// 地域は regions.mjs の 10 区分。既存は places の過半数の地域、(1) の A は Wikidata の場所（R4g と同じ）、(1) の B と (2) は一覧の地域。
// 取得済みの data/raw/r4g/（fetch-r4g.mjs）と data/raw/ne_50m_admin_0_countries.geojson を読むだけで、問い合わせはしない。
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_YEAR_MIN, COUNTRIES_PATH } from "./config.mjs";
import { LIST_PLACE_PROPS, LIST_TIME_PROPS } from "./lists.mjs";
import {
  R4G_ATTRS_PATH,
  R4G_DROPPED_DATED_PATH,
  R4G_TITLES_PATH,
  REF_B_PAGES,
  pickSubject,
  r4gPageFile,
  refBEntries,
} from "./r4g-survey.mjs";
import { REGIONS, buildCountryIndex, regionOf } from "./regions.mjs";
import { B_SECTION_ERAS } from "./r4i-common.mjs";
import { eraLabel, eraOf, formatYear, regionLabel } from "./report-common.mjs";
import { mdTable } from "./stats.mjs";

/** @typedef {import("./r4g-survey.mjs").R4gAttrs} R4gAttrs */

const ROOT_DIR = join(import.meta.dirname, "..", "..");
const EVENTS_DIR = join(ROOT_DIR, "public", "data", "events");
const YEAR_LIMIT = 1500; // これより前（< 1500）
const DOMAINS_OF_INTEREST = ["science", "technology", "economy"];
const OTHER_TIME_EXCLUDE = new Set(["P569", "P570", "P813", "P5017"]); // R4g と同じ（生没年・参照日・最終更新）


// ── 読み込み ──────────────────────────────────────────────

const readJson = async (/** @type {string} */ p) => JSON.parse(await readFile(p, "utf8"));
const countryIndex = buildCountryIndex(await readJson(COUNTRIES_PATH));
/** @type {Record<string, R4gAttrs>} */
const attrs = await readJson(R4G_ATTRS_PATH);
const titles = await readJson(R4G_TITLES_PATH);
const events = [
  ...new Map(
    (await Promise.all((await readdir(EVENTS_DIR)).filter((f) => f !== "manifest.json").map((f) => readJson(join(EVENTS_DIR, f)))))
      .flat()
      .map((e) => [e.id, e]),
  ).values(),
];
const generatedIds = new Set(events.map((e) => e.id));
const droppedMd = await readFile(R4G_DROPPED_DATED_PATH, "utf8");
const bPages = await Promise.all(REF_B_PAGES.map(async (cfg) => ({ cfg, page: await readJson(r4gPageFile(cfg.page)) })));

// ── 地域と年 ──────────────────────────────────────────────

/** 過半数の地域（analyze.mjs と同じ規則）。 @param {readonly { lon: number, lat: number }[]} points */
const regionOfPoints = (points) => {
  if (points.length === 0) return "none";
  const located = points.map((p) => regionOf(countryIndex, p).region ?? "none");
  return located.find((r) => located.filter((x) => x === r).length * 2 > located.length) ?? "multi";
};
/** A の項目の地域: Wikidata の場所（LIST_PLACE_PROPS の順で最初のプロパティ。国の代表点を含む）。 @param {string} qid */
const regionOfQid = (qid) => {
  const a = attrs[qid];
  const via = LIST_PLACE_PROPS.find((p) => (a?.places ?? []).some((x) => x.prop === p));
  return a && via ? regionOfPoints(a.places.filter((x) => x.prop === via)) : "none";
};
/** R4g の referenceYear と同じ。 @param {string | null} qid */
const wikidataYear = (qid) => {
  const a = qid ? attrs[qid] : undefined;
  if (!a) return null;
  const prop = LIST_TIME_PROPS.find((p) => (a.times[p] ?? []).length > 0);
  if (prop) return a.times[prop][0].year;
  const others = Object.entries(a.times).filter(([p]) => !OTHER_TIME_EXCLUDE.has(p)).flatMap(([, ts]) => ts.map((t) => t.year));
  return others.length > 0 ? Math.min(...others) : null;
};
// 表示範囲（前3000 年〜）より前の年代は 1 列にまとめる（"before"）
const MIN_ERA = eraOf(APP_YEAR_MIN);
/** @param {number} year */
const eraKey = (year) => (eraOf(year) < MIN_ERA ? "before" : String(eraOf(year)));
/** 「前250」→ -249、「850」→ 850。 @param {string} s */
const parseFormattedYear = (s) => (s.startsWith("前") ? 1 - Number(s.slice(1)) : Number(s));

// ── 既存 ─────────────────────────────────────────────────

const existing = events
  .filter((e) => e.start < YEAR_LIMIT && DOMAINS_OF_INTEREST.includes(e.domain))
  .map((e) => ({ id: e.id, title: e.title.ja, domain: e.domain, era: eraKey(e.start), region: regionOfPoints(e.places) }));

// ── 候補 (1): R4g の落ちた項目（年が範囲内）のうち 1500 年より前 ─────────

const droppedRows = droppedMd.split("\n").reduce(
  (acc, line) => {
    const h = /^## ([AB])（/.exec(line);
    if (h) return { list: h[1], rows: acc.rows };
    const cells = line.split("|").map((c) => c.trim());
    if (!/^Q\d+$/.test(cells[2] ?? "")) return acc;
    return { list: acc.list, rows: [...acc.rows, { list: acc.list, qid: cells[2], label: cells[3], source: cells[4], year: parseFormattedYear(cells[5]), stage: cells[6] }] };
  },
  { list: "", rows: /** @type {{ list: string, qid: string, label: string, source: string, year: number, stage: string }[]} */ ([]) },
).rows;
const bRegionBySource = new Map(REF_B_PAGES.map((p) => [p.label, p.region]));
const dropped = droppedRows
  .filter((r) => r.year < YEAR_LIMIT)
  .map((r) => ({ ...r, nowGenerated: generatedIds.has(r.qid), era: eraKey(r.year), region: r.list === "B" ? /** @type {string} */ (bRegionBySource.get(r.source)) : regionOfQid(r.qid) }));
// A と B の両方にある QID は 1 件（B の行を採る。地域が一覧で決まるため）
const droppedCandidates = [
  ...new Map([...dropped.filter((r) => r.list === "A"), ...dropped.filter((r) => r.list === "B")].map((r) => [r.qid, r])).values(),
].filter((r) => !r.nowGenerated);
const droppedQids = new Set(dropped.map((r) => r.qid));

// ── 候補 (2): 基準 B の一覧の行 ────────────────────────────────

const bRows = bPages.flatMap(({ cfg, page }) =>
  refBEntries(cfg, page.wikitext).map((e) => {
    const s = pickSubject(e.links, titles, attrs);
    const qid = s.status === "subject" ? s.qid : null;
    const year = wikidataYear(qid);
    const cue = B_SECTION_ERAS[cfg.label];
    const top = e.sectionPath[0] ?? "";
    const sectionEra = cue.all ?? (cue.premodern?.includes(top) ? "premodern" : cue.modern?.includes(top) ? "modern" : "unknown");
    return { source: cfg.label, region: cfg.region, lineNo: e.lineNo, qid, year, sectionEra, text: e.text };
  }),
);
// 同じ一覧の中の同じ QID は 1 件。いまの生成データにあるもの・(1) で数えたものは除く
const bCandidates = [...new Map(bRows.map((r) => [r.qid ? `${r.source}|${r.qid}` : `${r.source}|line:${r.lineNo}`, r])).values()].filter(
  (r) => !(r.qid && (generatedIds.has(r.qid) || droppedQids.has(r.qid))),
);
/** 年代の列: Wikidata の年があればその年代（1500 年以降なら "later"）。無ければ節からの目安。 @param {(typeof bCandidates)[number]} r */
const bColumn = (r) =>
  r.year !== null ? (r.year >= YEAR_LIMIT ? "later" : eraKey(r.year)) : r.sectionEra === "premodern" ? "undatedPremodern" : r.sectionEra === "modern" ? "undatedModern" : "undatedUnknown";

// ── 表 ──────────────────────────────────────────────────

const allEras = [
  ...new Set([...existing.map((x) => x.era), ...droppedCandidates.map((x) => x.era), ...bCandidates.map(bColumn).filter((c) => /^-?\d+$/.test(c) || c === "before")]),
].sort((a, b) => (a === "before" ? -1 : b === "before" ? 1 : Number(a) - Number(b)));
const eraName = (/** @type {string} */ e) => (e === "before" ? `${formatYear(APP_YEAR_MIN - 1)} 以前（表示範囲外）` : eraLabel(Number(e)));
const regionKeys = [...REGIONS, "multi", "none"];
const regionName = (/** @type {string} */ r) => (r === "none" ? "場所なし" : regionLabel(/** @type {any} */ (r)));

const extraCols = [
  ["undatedPremodern", "年なし（節から前近代）"],
  ["undatedUnknown", "年なし（節で決まらない）"],
  ["undatedModern", "年なし（節から近代）"],
  ["later", "1500 以降"],
];
const cell = (/** @type {number[]} */ ns) => (ns.every((n) => n === 0) ? "" : ns.join(" / "));

const overlay = mdTable(
  ["地域", ...allEras.map(eraName), ...extraCols.map(([, l]) => l), "合計"],
  [...regionKeys, "total"].flatMap((r) => {
    const inR = (/** @type {{ region: string }} */ x) => r === "total" || x.region === r;
    const ex = existing.filter(inR);
    const dr = droppedCandidates.filter(inR);
    const bc = bCandidates.filter(inR);
    if (ex.length + dr.length + bc.length === 0) return [];
    return [
      [
        r === "total" ? "**合計**" : regionName(r),
        ...allEras.map((e) => cell([ex.filter((x) => x.era === e).length, dr.filter((x) => x.era === e).length, bc.filter((x) => bColumn(x) === e).length])),
        ...extraCols.map(([k]) => cell([0, 0, bc.filter((x) => bColumn(x) === k).length])),
        cell([ex.length, dr.length, bc.length]),
      ],
    ];
  }),
);

const existingByDomain = mdTable(
  ["地域", ...allEras.map(eraName), "合計"],
  [...regionKeys, "total"].flatMap((r) => {
    const xs = existing.filter((x) => r === "total" || x.region === r);
    if (xs.length === 0) return [];
    const byDomain = (/** @type {typeof xs} */ g) =>
      g.length === 0 ? "" : DOMAINS_OF_INTEREST.map((d) => g.filter((x) => x.domain === d).length).join("・");
    return [[r === "total" ? "**合計**" : regionName(r), ...allEras.map((e) => byDomain(xs.filter((x) => x.era === e))), byDomain(xs)]];
  }),
);

const out = [
  "## 表 1: 既存 / 候補 (1) / 候補 (2)",
  "",
  overlay,
  "",
  "## 表 2: 既存の内訳（科学・技術・経済）",
  "",
  existingByDomain,
  "",
  "## 既存の項目",
  "",
  mdTable(
    ["年", "id", "title", "分類", "地域"],
    events
      .filter((e) => e.start < YEAR_LIMIT && DOMAINS_OF_INTEREST.includes(e.domain))
      .sort((a, b) => a.start - b.start)
      .map((e) => [formatYear(e.start), e.id, e.title.ja, e.domain, regionName(existing.find((x) => x.id === e.id)?.region ?? "none")]),
    ["r", "l", "l", "l", "l"],
  ),
  "",
  "## 候補 (1) の一覧",
  "",
  mdTable(
    ["年", "QID", "ラベル", "基準", "出典", "地域", "R4g で落ちた段階", "いまの生成データ"],
    [...dropped].sort((a, b) => a.year - b.year).map((r) => [formatYear(r.year), r.qid, r.label, r.list, r.source, regionName(r.region), r.stage, r.nowGenerated ? "ある（除外）" : "無い"]),
    ["r", "l", "l", "l", "l", "l", "l", "l"],
  ),
  "",
  `候補 (2) は ${bCandidates.length} 行（B の一覧 ${bRows.length} 行から、同じ一覧の同じ QID・いまの生成データにある QID・候補 (1) の QID を除いた数）。`,
  `うち照合不能（QID なし）${bCandidates.filter((r) => !r.qid).length} 行、Wikidata の年あり ${bCandidates.filter((r) => r.year !== null).length} 行。`,
];
console.log(out.join("\n"));
