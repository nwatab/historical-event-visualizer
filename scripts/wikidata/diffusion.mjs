// data/diffusion/*.json（人が書いた、広がる出来事の起点と到達点の表）の読み込みと解釈。
// 座標は表には書かれておらず、起点と各 stage の QID から Wikidata の P625 を引いた結果を使う
// （place-overrides.json と同じ経路。fetch-app-extras.mjs が data/raw/app/override-places.json に保存する）。
//
// 年は天文年の整数（紀元前 N 年 = 1 − N）。出典の記事で確認した年を書く。
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DIFFUSION_DIR } from "./config.mjs";
import { readJson } from "./load-analysis.mjs";
import { pickResolved, placeKey } from "./place-overrides.mjs";

/**
 * @typedef {{ qid: string, label: string, labelEn?: string, source?: string, summary?: string, note?: string, needsCheck?: string,
 *   granularity?: "fine" | "region" | "country", granularityNote?: string }} DiffusionPlaceRef
 *   qid: 座標を引く Wikidata の項目。label: 地図と詳細パネルに出す地名。source: 出典（Wikipedia の記事名と節名）。
 *   summary: 出典の該当箇所の要旨（引用ではない）。
 *   granularity: 人が決めた粒度（理由を granularityNote に書く）。省略時は QID の P31 から決める（place-granularity.mjs）。都市の項目が
 *   過去の国家のクラスも併せ持つとき（ストラスブール = 帝国自由都市）に、country と判定されて拡大時に消えるのを防ぐためにある。needsCheck: 出典に当たれなかった、出典どうしが食い違う、などの要確認の理由
 * @typedef {DiffusionPlaceRef & { year: number, from?: number, fromBasis?: string, fromNote?: string, month?: string }} DiffusionStageRef
 *   from: 直前の到達点の添字。起点からなら -1。省略時は 1 つ前の stage。fromBasis: from の根拠（出典に明記 / 推測）。
 *   month: 出典に月があるときの "YYYY-MM"（アプリの分解能は 1 年なので、表示には使わない。同じ年の stage の順序の根拠）
 * @typedef {{
 *   status: "draft" | "confirmed",
 *   id: string, title: { ja: string, en?: string }, description?: { ja: string, en?: string },
 *   domain: string, tags: string[], start: number, end: number, importance: 1 | 2 | 3, source: string,
 *   origin: DiffusionPlaceRef, stages: DiffusionStageRef[], note?: string,
 * }} DiffusionFile
 */

/** @returns {Promise<{ file: string, data: DiffusionFile }[]>} ファイル名の順 */
export const loadDiffusionFiles = async () => {
  const names = (await readdir(DIFFUSION_DIR).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(names.map(async (file) => ({ file, data: await readJson(join(DIFFUSION_DIR, file)) })));
};

/** 座標を引く対象（起点と全 stage）。place-overrides と同じ形にして、同じキャッシュを使う。 @param {DiffusionFile} data */
export const diffusionPlaceRefs = (data) =>
  [data.origin, ...data.stages].map((p) => ({ from: p.qid, fromLabel: p.label, path: /** @type {const} */ ("P625") }));

/** stage の from を解決する（src/lib/timeline.ts の stageFrom と同じ規則）。 @param {DiffusionStageRef} stage @param {number} index */
const fromOf = (stage, index) => stage.from ?? index - 1;

/**
 * 表の誤りを列挙する（空なら問題なし）。黙って直さず、生成を止めるために使う。
 * @param {DiffusionFile} data @returns {string[]}
 */
export const diffusionErrors = (data) => [
  ...(Number.isInteger(data.start) && Number.isInteger(data.end) && data.start <= data.end ? [] : [`start / end が不正: ${data.start}〜${data.end}`]),
  ...(data.stages.length > 0 ? [] : ["stages が空"]),
  ...data.stages.flatMap((stage, index) => {
    const from = fromOf(stage, index);
    const at = `stages[${index}] ${stage.label}`;
    return [
      ...(Number.isInteger(stage.year) && data.start <= stage.year && stage.year <= data.end ? [] : [`${at}: year ${stage.year} が start〜end の外`]),
      ...(index === 0 || data.stages[index - 1].year <= stage.year ? [] : [`${at}: 時系列順になっていない`]),
      ...(Number.isInteger(from) && from >= -1 && from < index ? [] : [`${at}: from ${from} は -1 以上 ${index} 未満でなければならない`]),
      ...(from >= 0 && from < index && data.stages[from].year > stage.year ? [`${at}: from の到達点（${data.stages[from].label}）のほうが後の年`] : []),
    ];
  }),
];

/** 小数第4位まで（build-app-data.mjs の roundCoord と同じ）。 @param {number} x */
const roundCoord = (x) => Math.round(x * 1e4) / 1e4;

/**
 * 表の 1 件を HistEvent（kind: "diffusion"）にする。座標が取れていない場所があればエラーにする（推測で埋めない）。
 * @param {DiffusionFile} data
 * @param {Readonly<Record<string, import("./place-overrides.mjs").ResolvedRow[]>>} resolved
 * @param {(qid: string) => "fine" | "region" | "country" | "coarse"} granularityOfPlace 場所の項目の粒度
 */
export const toDiffusionEvent = (data, resolved, granularityOfPlace) => {
  const errors = diffusionErrors(data);
  if (errors.length > 0) throw new Error(`data/diffusion: ${data.id} ${data.title.ja}\n  ${errors.join("\n  ")}`);
  /** @param {DiffusionPlaceRef} ref @param {number} year */
  const placeOf = (ref, year) => {
    const row = pickResolved(resolved[placeKey({ from: ref.qid, fromLabel: ref.label, path: "P625" })] ?? [], year);
    if (!row) throw new Error(`data/diffusion: ${data.id} の ${ref.qid}（${ref.label}）の座標が取れません。pnpm wikidata:fetch-app-extras を実行したか確認してください。`);
    const granularity = ref.granularity ?? granularityOfPlace(ref.qid);
    if (granularity === "coarse") throw new Error(`data/diffusion: ${data.id} の ${ref.qid}（${ref.label}）は大陸・海洋で、地点として使えません。`);
    return { lon: roundCoord(row.lon), lat: roundCoord(row.lat), label: ref.label, ...(granularity === "fine" ? {} : { granularity }) };
  };
  return {
    id: data.id,
    title: data.title,
    ...(data.description ? { description: data.description } : {}),
    domain: data.domain,
    tags: data.tags,
    kind: /** @type {const} */ ("diffusion"),
    start: data.start,
    end: data.end,
    places: [placeOf(data.origin, data.start)],
    stages: data.stages.map((stage, index) => ({
      year: stage.year,
      place: placeOf(stage, stage.year),
      // 省略時の規則（1 つ前の stage）と同じなら書かない
      ...(fromOf(stage, index) === index - 1 ? {} : { from: fromOf(stage, index) }),
      ...(stage.source ? { note: `出典: ${stage.source}` } : {}),
    })),
    importance: data.importance,
    source: data.source,
  };
};
