// data/diffusion/*.json（広がる出来事の起点と到達点）を、人が確認するための表 diffusion.draft.md にする。
//
//   pnpm wikidata:diffusion-draft
//
// ネットワークには出ない。Wikidata のラベルと座標は、取得済みのキャッシュ（data/raw/app/override-places.json。
// pnpm wikidata:fetch-app-extras が QID から P625 を引いて保存したもの）から読む。表の「Wikidata のラベル」の列は、
// QID が意図した場所を指しているかを照合するためのもの（記憶で書いた QID は別物を指すことがある。CLAUDE.md）。
import { writeFile } from "node:fs/promises";
import { DIFFUSION_DRAFT_PATH, OVERRIDE_PLACES_PATH, PLACE_CLASSES_PATH } from "./config.mjs";
import { diffusionErrors, loadDiffusionFiles } from "./diffusion.mjs";
import { readJsonOr } from "./load-analysis.mjs";
import { granularityOf } from "./place-granularity.mjs";
import { pickResolved, placeKey } from "./place-overrides.mjs";

/** 表のセルに入れる文字列（縦棒と改行を潰す）。 @param {unknown} x */
const cell = (x) => String(x ?? "").replace(/\|/g, "／").replace(/\s*\n\s*/g, " ");

/**
 * @param {{ file: string, data: import("./diffusion.mjs").DiffusionFile }} entry
 * @param {Readonly<Record<string, import("./place-overrides.mjs").ResolvedRow[]>>} resolved
 * @param {Readonly<Record<string, { p31: readonly string[] } | null>>} placeClasses
 */
export const diffusionDraftSection = ({ file, data }, resolved, placeClasses) => {
  /** @param {import("./diffusion.mjs").DiffusionPlaceRef} ref @param {number} year */
  const wikidataOf = (ref, year) => {
    const row = pickResolved(resolved[placeKey({ from: ref.qid, fromLabel: ref.label, path: "P625" })] ?? [], year);
    return row
      ? { label: `${row.labelJa ?? "（ja なし）"} / ${row.labelEn ?? "（en なし）"}`, coord: `${row.lat.toFixed(2)}, ${row.lon.toFixed(2)}`, granularity: ref.granularity ? `${ref.granularity}（人が指定。P31 からは ${granularityOf(placeClasses[ref.qid]?.p31 ?? [])}）` : granularityOf(placeClasses[ref.qid]?.p31 ?? []) }
      : { label: "未取得", coord: "未取得", granularity: "" };
  };
  const nameOf = (/** @type {number} */ from) => (from === -1 ? "起点" : `${from}: ${data.stages[from]?.label ?? "?"}`);
  const origin = wikidataOf(data.origin, data.start);
  const errors = diffusionErrors(data);
  return [
    `## ${data.title.ja}（${data.start}〜${data.end}）`,
    "",
    `- ファイル: \`data/diffusion/${file}\`　状態: **${data.status}**`,
    `- id: ${data.id}　分類: ${data.domain}（tags: ${data.tags.join(", ")}）　importance: ${data.importance}`,
    `- 出典: ${data.source}`,
    ...(data.note ? [`- 補足: ${cell(data.note)}`] : []),
    ...(errors.length > 0 ? ["- **表の誤り**:", ...errors.map((e) => `  - ${e}`)] : []),
    "",
    "| # | 年 | 地名 | QID | Wikidata のラベル（ja / en） | 緯度, 経度（P625） | 粒度 | from | from の根拠 | 出典 | 要確認 |",
    "|---:|---:|---|---|---|---|---|---|---|---|---|",
    `| 起点 | ${data.start} | ${cell(data.origin.label)} | ${data.origin.qid} | ${cell(origin.label)} | ${origin.coord} | ${origin.granularity} | | | ${cell([data.origin.source, data.origin.summary ? `要旨: ${data.origin.summary}` : "", data.origin.note ?? ""].filter(Boolean).join(" "))} | ${cell(data.origin.needsCheck || "")} |`,
    ...data.stages.map((stage, index) => {
      const wd = wikidataOf(stage, stage.year);
      const basis = [stage.fromBasis, stage.fromNote].filter(Boolean).join("。");
      const source = [stage.source, stage.month ? `（${stage.month}）` : "", stage.summary ? `要旨: ${stage.summary}` : "", stage.note ?? ""].filter(Boolean).join(" ");
      return `| ${index} | ${stage.year} | ${cell(stage.label)} | ${stage.qid} | ${cell(wd.label)} | ${wd.coord} | ${wd.granularity} | ${cell(nameOf(stage.from ?? index - 1))} | ${cell(basis)} | ${cell(source)} | ${cell(stage.needsCheck || "")} |`;
    }),
    "",
  ].join("\n");
};

const [files, resolved, placeClasses] = await Promise.all([
  loadDiffusionFiles(),
  readJsonOr(OVERRIDE_PLACES_PATH, {}),
  readJsonOr(PLACE_CLASSES_PATH, {}),
]);
const markdown = [
  "# 広がる出来事（diffusion）の下書き",
  "",
  `\`pnpm wikidata:diffusion-draft\` が \`data/diffusion/*.json\` から作り直す（${new Date().toISOString().slice(0, 10)} 生成）。手で編集しない。直すのは JSON のほう。`,
  "",
  "人が確認するための表。確認が済んだファイルは `status` を `\"confirmed\"` にする（`\"draft\"` のままだと `pnpm wikidata:build-app-data` はデータに入れない）。",
  "",
  "- **年・経路・from の出所**: 「出典」の列の Wikipedia の記事（と節）の本文を、2026-09-21 に API で取得して読んだもの（取得と読み取りは、調査用のサブエージェントが行った）。",
  "  「要旨」は、取得した本文の該当箇所の要約で、引用ではない。要旨の中の `ファイル名:行番号` は、調査時に保存した本文（セッションの作業用ディレクトリ。リポジトリには無い）の位置。",
  "  要旨と本文の突き合わせは、数か所を抜き取りで確かめただけで（黒死病のジェノヴァ／マルセイユ、モスクワ、スペインかぜのボストン／フリータウン）、全部は確かめていない。人が出典の記事で確認する前提の下書き。",
  "  「from の根拠」が「出典に明記」でないものは、年代と地理からの推測で、出典で確かめたものではない。",
  "- **QID と座標の出所**: QID は Wikidata の API（wbsearchentities、または記事名からの sitelink）で探し、wbgetentities のラベル・説明で照合したもの（サブエージェントの報告による）。",
  "  「Wikidata のラベル」と「緯度, 経度」の列は、その QID から `pnpm wikidata:fetch-app-extras` が取得した値（SPARQL、P625）で、報告とは独立に取り直している。座標は JSON には書いていない。",
  "  「粒度」は、その QID の P31 から `place-granularity.mjs` で決めたもの。`country` の到達点は、zoom 4 以上で地図から消える。",
  "- **要確認** の列が空でない行は、出典に当たれなかったか、出典どうしが食い違っているもの。",
  "- 年は天文年の整数。このアプリの時間の分解能は 1 年なので、同じ年の到達点は同時に出る（月が分かるものは出典の列に書いてある）。",
  "",
  ...files.map((entry) => diffusionDraftSection(entry, resolved, placeClasses)),
].join("\n");
await writeFile(DIFFUSION_DRAFT_PATH, markdown);
console.log(`${files.length} 件 → ${DIFFUSION_DRAFT_PATH}`);
