// data/first-records.json（初出の記録。R4i）を、人が確認するための表 scripts/wikidata/first-records.draft.md にする。
//
//   node scripts/wikidata/build-first-records-draft.mjs
//
// 座標は取得済みの data/raw/app/override-places.json（pnpm wikidata:fetch-app-extras）から読み、地域（regions.mjs）を出す。問い合わせはしない。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COUNTRIES_PATH, OVERRIDE_PLACES_PATH } from "./config.mjs";
import { firstRecordPlaceRef, loadFirstRecords } from "./first-records.mjs";
import { pickResolved, placeKey } from "./place-overrides.mjs";
import { REGIONS, buildCountryIndex, regionOf } from "./regions.mjs";
import { DOMAIN_LABELS, formatYear, regionLabel } from "./report-common.mjs";
import { mdTable, percent } from "./stats.mjs";

const OUT = join(import.meta.dirname, "first-records.draft.md");
const readJson = async (/** @type {string} */ p) => JSON.parse(await readFile(p, "utf8"));
const file = await loadFirstRecords();
const resolved = await readJson(OVERRIDE_PLACES_PATH);
const countryIndex = buildCountryIndex(await readJson(COUNTRIES_PATH));

const rows = file.records.map((r) => {
  const row = pickResolved(resolved[placeKey(firstRecordPlaceRef(r))] ?? [], r.year);
  const region = row ? (regionOf(countryIndex, row).region ?? "none") : "（座標なし）";
  return { r, region, era: r.year <= 500 ? "〜500" : r.year <= 1000 ? "501〜1000" : "1001〜1500" };
});
const regionKeys = [...REGIONS, "none", "（座標なし）"].filter((k) => rows.some((x) => x.region === k) || file.rejectedByRule.some((x) => x.region === k));
const name = (/** @type {string} */ k) => (REGIONS.includes(/** @type {any} */ (k)) ? regionLabel(/** @type {any} */ (k)) : k);
const eras = ["〜500", "501〜1000", "1001〜1500"];
const domains = /** @type {const} */ (["science", "technology", "economy"]);
const esc = (/** @type {string | undefined} */ s) => (s ?? "").replace(/\|/g, "／").replace(/\n/g, " ");

const out = [
  "# 初出の記録（R4i）の下書き",
  "",
  "> このファイルは `node scripts/wikidata/build-first-records-draft.mjs` が data/first-records.json から作る。手で編集しない（直すのは data/first-records.json）。",
  "> 規則は CLAUDE.md「初出の記録」、選び方と所見は [FINDINGS-R4i.md](FINDINGS-R4i.md)。根拠の「ファイル:行」は data/raw/r4i/texts/ の本文（コミットしない。`node scripts/wikidata/r4i-source-text.mjs` で取り直せる）。",
  "",
  "## 件数",
  "",
  `${rows.length} 件（下書き ${rows.filter((x) => x.r.status === "draft").length} 件）。地域は、場所の座標から regions.mjs で決めた。`,
  "",
  mdTable(
    ["地域", ...eras, "合計", "うち経済・交易"],
    [...regionKeys.filter((k) => rows.some((x) => x.region === k)), "total"].map((k) => {
      const xs = rows.filter((x) => k === "total" || x.region === k);
      return [k === "total" ? "**合計**" : name(k), ...eras.map((e) => xs.filter((x) => x.era === e).length), xs.length, xs.filter((x) => x.r.domain === "economy").length];
    }),
  ),
  "",
  mdTable(["分類", "件数", "割合"], domains.map((d) => [DOMAIN_LABELS[d], rows.filter((x) => x.r.domain === d).length, percent(rows.filter((x) => x.r.domain === d).length, rows.length)])),
  "",
  mdTable(["importance の案", "件数"], [3, 2, 1].map((i) => [i, rows.filter((x) => x.r.importance === i).length])),
  "",
  "## 採った項目",
  "",
  ...regionKeys
    .filter((k) => rows.some((x) => x.region === k))
    .flatMap((k) => [
      `### ${name(k)}`,
      "",
      mdTable(
        ["年", "title", "分類", "importance の案", "場所", "概念 / 文献・遺物", "年の根拠", "場所の根拠", "出典", "要確認"],
        rows
          .filter((x) => x.region === k)
          .map(({ r }) => [
            formatYear(r.year),
            `${esc(r.title.ja)}<br>\`${r.slug}\``,
            DOMAIN_LABELS[r.domain],
            `${r.importance}${r.importanceNote ? `（${esc(r.importanceNote)}）` : ""}`,
            `${esc(r.place.label)} ${r.place.qid}`,
            [r.concept ? `${esc(r.concept.label)} ${r.concept.qid}` : "–", r.record ? `${esc(r.record.label)} ${r.record.qid}` : "–"].join(" / "),
            esc(r.yearBasis),
            esc(r.place.basis),
            esc(r.source),
            esc(r.needsCheck) || "–",
          ]),
        ["r", "l", "l", "l", "l", "l", "l", "l", "l", "l"],
      ),
      "",
    ]),
  "## 規則のせいで入らなかった候補（rejectedByRule）",
  "",
  "年が世紀単位・範囲だけ、場所が特定できない（発見地・所蔵先・住まいからの推定しか無い）などで入らなかった候補。世紀単位の精度の扱いを決めるときの材料。",
  "地域は、候補を探した担当の地域（場所が特定できない候補もあるので、座標では決めていない）。",
  "",
  ...regionKeys
    .filter((k) => file.rejectedByRule.some((x) => x.region === k))
    .flatMap((k) => [
      `### ${name(k)}（${file.rejectedByRule.filter((x) => x.region === k).length} 件）`,
      "",
      mdTable(["候補", "QID", "理由", "出典"], file.rejectedByRule.filter((x) => x.region === k).map((x) => [esc(x.concept), x.qid ?? "–", esc(x.reason), esc(x.source) || "–"]), ["l", "l", "l", "l"]),
      "",
    ]),
  "## その他の理由で落とした候補（rejectedOther）",
  "",
  mdTable(["地域", "候補", "理由"], file.rejectedOther.map((x) => [name(x.region), esc(x.concept), esc(x.reason)]), ["l", "l", "l"]),
  "",
].join("\n");
await writeFile(OUT, out);
console.log(`→ ${OUT}（${rows.length} 件）`);
