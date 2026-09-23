// R4i の確認: いまの public/data/events/ で、1500 年より前の基準 A・B の再現率と、501〜1000 年・1001〜1500 年の分類の比率を出す。
//
//   pnpm wikidata:build-app-data --with-drafts && node scripts/wikidata/r4i-check.mjs   # 下書きを入れた場合（出力はコミットしない）
//   pnpm wikidata:build-app-data && node scripts/wikidata/r4i-check.mjs                 # 入れない場合
//
// 再現率の数え方: 基準の項目の QID が、生成データの id にあるか、初出の記録（id が first-record-）の concept / record の QID と一致すれば「ある」。
// 分母は 2 通り:
//   - R4g の定義: QID のある基準の項目のうち、Wikidata の年（R4g の referenceYear）が前3000〜1499 年のもの
//   - 前近代の節: 基準 B の一覧の行のうち、Wikidata の年が 1500 年より前か、年が無く節から前近代と分かるもの（r4i-gaps.mjs の B_SECTION_ERAS と同じ目安）
// 取得済みの data/raw/r4g/ を読むだけで、問い合わせはしない。
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_YEAR_MIN } from "./config.mjs";
import { FIRST_RECORD_ID_PREFIX, loadFirstRecords } from "./first-records.mjs";
import { LIST_TIME_PROPS } from "./lists.mjs";
import {
  R4G_ATTRS_PATH,
  R4G_TITLES_PATH,
  REF_A_PAGES,
  REF_B_PAGES,
  pickSubject,
  r4gPageFile,
  refAEntries,
  refBEntries,
} from "./r4g-survey.mjs";
import { B_SECTION_ERAS } from "./r4i-common.mjs";
import { DOMAINS, DOMAIN_LABELS, eraLabel, eraOf } from "./report-common.mjs";
import { mdTable, percent } from "./stats.mjs";

const readJson = async (/** @type {string} */ p) => JSON.parse(await readFile(p, "utf8"));
const EVENTS_DIR = join(import.meta.dirname, "..", "..", "public", "data", "events");
const OTHER_TIME_EXCLUDE = new Set(["P569", "P570", "P813", "P5017"]);

const events = [
  ...new Map(
    (await Promise.all((await readdir(EVENTS_DIR)).filter((f) => f !== "manifest.json").map((f) => readJson(join(EVENTS_DIR, f)))))
      .flat()
      .map((e) => [e.id, e]),
  ).values(),
];
const attrs = await readJson(R4G_ATTRS_PATH);
const titles = await readJson(R4G_TITLES_PATH);
const firstRecords = (await loadFirstRecords()).records;
const presentFirstRecordSlugs = new Set(events.filter((e) => String(e.id).startsWith(FIRST_RECORD_ID_PREFIX)).map((e) => String(e.id).slice(FIRST_RECORD_ID_PREFIX.length)));
const covered = new Set([
  ...events.map((e) => String(e.id)),
  ...firstRecords.filter((r) => presentFirstRecordSlugs.has(r.slug)).flatMap((r) => [r.concept?.qid, r.record?.qid].filter((q) => typeof q === "string")),
]);

/** R4g の referenceYear と同じ。 @param {string | null} qid */
const wikidataYear = (qid) => {
  const a = qid ? attrs[qid] : undefined;
  if (!a) return null;
  const prop = LIST_TIME_PROPS.find((p) => (a.times[p] ?? []).length > 0);
  if (prop) return a.times[prop][0].year;
  const others = Object.entries(a.times).filter(([p]) => !OTHER_TIME_EXCLUDE.has(p)).flatMap(([, ts]) => /** @type {any[]} */ (ts).map((t) => t.year));
  return others.length > 0 ? Math.min(...others) : null;
};
const premodernYear = (/** @type {number | null} */ y) => y !== null && y >= APP_YEAR_MIN && y < 1500;

// 基準 A（QID の重複は 1 件）
const aQids = [
  ...new Set(
    (await Promise.all(REF_A_PAGES.map(async (cfg) => refAEntries(cfg, (await readJson(r4gPageFile(cfg.page))).wikitext))))
      .flat()
      .flatMap((e) => (titles[e.title]?.qid ? [titles[e.title].qid] : [])),
  ),
];
// 基準 B（同じ一覧の同じ QID は 1 件）
const bRows = (
  await Promise.all(
    REF_B_PAGES.map(async (cfg) =>
      refBEntries(cfg, (await readJson(r4gPageFile(cfg.page))).wikitext).map((e) => {
        const s = pickSubject(e.links, titles, attrs);
        const cue = B_SECTION_ERAS[cfg.label] ?? {};
        const top = e.sectionPath[0] ?? "";
        const sectionEra = cue.all ?? (cue.premodern?.includes(top) ? "premodern" : cue.modern?.includes(top) ? "modern" : "unknown");
        return { source: cfg.label, qid: s.status === "subject" ? s.qid : null, sectionEra };
      }),
    ),
  )
).flat();
const bItems = [...new Map(bRows.filter((r) => r.qid).map((r) => [`${r.source}|${r.qid}`, r])).values()];

/** @param {readonly string[]} qids */
const recall = (qids) => {
  const n = qids.filter((q) => covered.has(q)).length;
  return `${n} / ${qids.length}（${percent(n, qids.length)}）`;
};
const aPre = aQids.filter((q) => premodernYear(wikidataYear(q)));
const bPre = bItems.filter((r) => premodernYear(wikidataYear(r.qid)));
const bSection = bItems.filter((r) => premodernYear(wikidataYear(r.qid)) || (wikidataYear(r.qid) === null && r.sectionEra === "premodern"));

const recallTable = mdTable(
  ["基準", "分母", "生成データにある"],
  [
    ["A（Level 4）", "Wikidata の年が前3000〜1499 年", recall(aPre)],
    ["B（地域別の一覧）", "Wikidata の年が前3000〜1499 年", recall(bPre.map((r) => /** @type {string} */ (r.qid)))],
    ["B（地域別の一覧）", "上に加え、年が無く節から前近代と分かる行", recall(bSection.map((r) => /** @type {string} */ (r.qid)))],
  ],
  ["l", "l", "r"],
);

/** @param {number} era */
const domainTable = (era) => {
  const xs = events.filter((e) => eraOf(e.start) === era);
  return mdTable(
    ["分類", "件数", "比率"],
    [...DOMAINS.map((d) => [DOMAIN_LABELS[d], xs.filter((e) => e.domain === d).length, percent(xs.filter((e) => e.domain === d).length, xs.length)]), ["合計", xs.length, "100%"]],
  );
};

const manifest = await readJson(join(EVENTS_DIR, "manifest.json"));
console.log(
  [
    `生成データ: ${events.length} 件（manifest の generatedAt ${manifest.generatedAt}、初出の記録 ${presentFirstRecordSlugs.size} 件${manifest.sources.firstRecords?.withDrafts ? "、--with-drafts" : ""}）`,
    "",
    "### 1500 年より前の基準 A・B の再現率",
    "",
    recallTable,
    "",
    `### ${eraLabel(2)} 年の分類（開始年で数える）`,
    "",
    domainTable(2),
    "",
    `### ${eraLabel(3)} 年の分類（開始年で数える）`,
    "",
    domainTable(3),
  ].join("\n"),
);
