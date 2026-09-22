// place-overrides.json の下書き（status: "draft"。人が確認する前のもの）を、人が確認するための表 place-overrides.review.md にする。
//
//   pnpm wikidata:place-overrides-review
//
// ネットワークには出ない。Wikidata のラベルと座標は、取得済みのキャッシュ（data/raw/app/override-places.json。
// pnpm wikidata:fetch-app-extras が QID から P625 を引いて保存したもの）から読む。「Wikidata のラベル」の列は、
// QID が意図した場所を指しているかを照合するためのもの（記憶で書いた QID は別物を指すことがある。CLAUDE.md）。
// 粒度は、その QID の P31 から place-granularity.mjs で決めたもの（pnpm wikidata:fetch-places が取得）。country は拡大時に消える。
import { writeFile } from "node:fs/promises";
import { OVERRIDE_PLACES_PATH, PLACE_LABELS_PATH, PLACE_OVERRIDES_REVIEW_PATH } from "./config.mjs";
import { loadAnalysis, readJsonOr } from "./load-analysis.mjs";
import { granularityOf } from "./place-granularity.mjs";
import { pickResolved, placeKey } from "./place-overrides.mjs";
import { DOMAIN_LABELS, formatYear } from "./report-common.mjs";

/** 表のセルに入れる文字列（縦棒と改行を潰す）。 @param {unknown} x */
const cell = (x) => String(x ?? "").replace(/\|/g, "／").replace(/\s*\n\s*/g, " ");

const [{ population, placeOverrides, placeClasses }, resolved, placeLabels] = await Promise.all([
  loadAnalysis(),
  readJsonOr(OVERRIDE_PLACES_PATH, {}),
  readJsonOr(PLACE_LABELS_PATH, {}),
]);
const itemByQid = new Map(population.map((item) => [item.qid, item]));
const drafts = placeOverrides.overrides
  .filter((o) => o.status === "draft")
  .map((o) => ({ override: o, item: itemByQid.get(o.qid) }))
  .sort((a, b) => (b.item?.importance ?? 0) - (a.item?.importance ?? 0) || (b.item?.sitelinks ?? 0) - (a.item?.sitelinks ?? 0));

/** 今のデータでの場所（Wikidata 由来。国の代表点だけなら、その国の名前） @param {import("./analyze.mjs").Item | undefined} item */
const currentPlaces = (item) =>
  !item
    ? "（母集団に無い）"
    : item.countryLevelPlace
      ? `none（国の代表点のみ: ${item.allPlaces.map((p) => placeLabels[p.loc]?.ja ?? placeLabels[p.loc]?.en ?? p.loc).join("、")}）`
      : item.places.map((p) => `${placeLabels[p.loc]?.ja ?? placeLabels[p.loc]?.en ?? p.loc}（${p.granularity}）`).join("、") || "none";

/** @param {import("./place-overrides.mjs").PlaceOverride} override @param {number} year */
const placeCells = (override, year) =>
  (override.places ?? []).map((place) => {
    const row = pickResolved(resolved[placeKey(place)] ?? [], year);
    const granularity = place.path === "P625" ? granularityOf(placeClasses[place.from]?.p31 ?? []) : "fine";
    const label = place.label ?? row?.labelJa ?? row?.labelEn ?? place.fromLabel;
    return row
      ? `${label}（${place.from}。Wikidata: ${row.labelJa ?? "ja なし"} / ${row.labelEn ?? "en なし"}。${row.lat.toFixed(2)}, ${row.lon.toFixed(2)}。粒度 ${granularity}${granularity === "country" ? " **拡大時に消える**" : ""}）`
      : `${label}（${place.from}。**座標が未取得**。pnpm wikidata:fetch-places と fetch-app-extras を実行する）`;
  });

const counts = Object.groupBy(drafts, ({ override }) => override.placeKind);
const markdown = [
  "# place-overrides の下書き（人の確認待ち）",
  "",
  `\`pnpm wikidata:place-overrides-review\` が \`place-overrides.json\` の \`status: "draft"\` の項目から作り直す（${new Date().toISOString().slice(0, 10)} 生成）。手で編集しない。直すのは JSON のほう。`,
  "",
  "- 確認が済んだ項目は、JSON の `status` を消す（`\"draft\"` のままだと `pnpm wikidata:build-app-data` は使わない。`--with-drafts` を付けると使う。その出力はコミットしない）。",
  "- **地点と出典の出所**: 「出典」の列の Wikipedia の記事（と節）の本文を、調査用のサブエージェントが API で取得して読んだもの。「要旨」は該当箇所の要約で、引用ではない。",
  "  要旨の中の `ファイル名:行番号` は、調査時に保存した本文（セッションの作業用ディレクトリ。リポジトリには無い）の位置。人が出典の記事で確認する前提の下書き。",
  "- **QID と座標の出所**: QID はサブエージェントが wbsearchentities / wbgetentities で照合したもの。「Wikidata」のラベルと座標は、その QID から `pnpm wikidata:fetch-app-extras` が取得した値（P625）で、報告とは独立に取り直している。",
  `- 案の内訳: point ${counts.point?.length ?? 0} 件、none ${counts.none?.length ?? 0} 件、origin ${counts.origin?.length ?? 0} 件（合計 ${drafts.length} 件）`,
  "",
  "| # | QID | 項目 | 年 | 分類 | imp | sitelinks | 今の場所 | 案 | 地点（先頭がラベルの付く点） | 出典・要旨 | 理由 | 要確認 |",
  "|---:|---|---|---:|---|---:|---:|---|---|---|---|---|---|",
  ...drafts.map(({ override, item }, index) => {
    const year = override.start ?? item?.start?.year ?? 0;
    return `| ${index + 1} | [${override.qid}](https://www.wikidata.org/wiki/${override.qid}) | ${cell(override.title)} | ${formatYear(year)} | ${item ? DOMAIN_LABELS[item.classification.domain] : ""} | ${item?.importance ?? ""} | ${item?.sitelinks ?? ""} | ${cell(currentPlaces(item))} | **${override.placeKind}** | ${cell(placeCells(override, year).join(" → "))} | ${cell([override.source, override.summary ? `要旨: ${override.summary}` : ""].filter(Boolean).join(" "))} | ${cell(override.note ?? "")} | ${cell(override.needsCheck ?? "")} |`;
  }),
  "",
].join("\n");
await writeFile(PLACE_OVERRIDES_REVIEW_PATH, markdown);
console.log(`${drafts.length} 件 → ${PLACE_OVERRIDES_REVIEW_PATH}`);
