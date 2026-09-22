// data/first-records.json（人が確認する「初出の記録」の表。R4i）の読み込みと解釈。
//
// Wikidata の概念（羅針盤など）は年を持たないことが多いので（R4g）、その概念の「年と場所が特定できる最初の記録」
// （現存最古の記述がある文献の成立、年記のある最古の遺物、最初の製造・使用の記録）を 1 つの instant の出来事にする。規則は CLAUDE.md「初出の記録」。
// 座標は表に書かず、place.qid から Wikidata の P625 を引いた結果を使う（place-overrides.json・data/diffusion と同じ経路。
// fetch-app-extras.mjs が data/raw/app/override-places.json に保存する）。
//
// 年は天文年の整数（紀元前 N 年 = 1 − N）。出典の本文で確かめた年を書く。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pickResolved, placeKey } from "./place-overrides.mjs";

export const FIRST_RECORDS_PATH = join(import.meta.dirname, "..", "..", "data", "first-records.json");
/** 生成データの id の接頭辞（Wikidata の QID や他の slug と重ならないように）。 */
export const FIRST_RECORD_ID_PREFIX = "first-record-";

/**
 * @typedef {{ qid: string, label: string } | null} QidRef
 * @typedef {{
 *   status: "draft" | "confirmed",
 *   slug: string,
 *   title: { ja: string, en?: string },
 *   description: string,
 *   concept: QidRef,
 *   record: QidRef,
 *   recordKind: "text" | "artifact" | "use" | "event",
 *   domain: "science" | "technology" | "economy",
 *   tags: string[],
 *   year: number,
 *   yearBasis: string,
 *   place: { qid: string, label: string, basis: string },
 *   source: string,
 *   sources?: string[],
 *   importance: 1 | 2 | 3,
 *   importanceNote?: string,
 *   needsCheck?: string,
 * }} FirstRecord
 *   concept: その記録が「初出」になる概念（Wikidata の項目）。出来事そのもの（recordKind: "event"）なら null でもよい。
 *   record: 文献・遺物の項目（あれば）。yearBasis / place.basis: 年・場所の根拠（自分の言葉。取得した本文の「ファイル:行」を付ける）。
 *   source: 主な出典（Wikipedia の記事名と節名）。description: 詳細パネルに出す要旨（自分の言葉。引用しない）。
 *   needsCheck: 要確認の理由（「頃」、年代学の不確かさ、出典の食い違い、など）
 *   sources: 使った本文のファイル（data/raw/r4i/texts/。コミットしない）
 * @typedef {{ region: string, concept: string, qid?: string, reason: string, source?: string }} RejectedCandidate
 * @typedef {{ about: string[], records: FirstRecord[], rejectedByRule: RejectedCandidate[], rejectedOther: RejectedCandidate[] }} FirstRecordsFile
 *   rejectedByRule: 規則（年の精度・場所）のせいで入らなかった候補。rejectedOther: 分類外・重複・出典の食い違いなどで落とした候補
 */

/** @returns {Promise<FirstRecordsFile>} 無ければ空 */
export const loadFirstRecords = async () => {
  try {
    return JSON.parse(await readFile(FIRST_RECORDS_PATH, "utf8"));
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") return { about: [], records: [], rejectedByRule: [], rejectedOther: [] };
    throw e;
  }
};

/** 座標を引く対象。place-overrides と同じ形にして、同じキャッシュを使う。 @param {FirstRecord} r */
export const firstRecordPlaceRef = (r) => ({ from: r.place.qid, fromLabel: r.place.label, path: /** @type {const} */ ("P625") });

/**
 * 表の誤りを列挙する（空なら問題なし）。黙って直さず、生成を止めるために使う。
 * @param {readonly FirstRecord[]} records @returns {string[]}
 */
export const firstRecordErrors = (records) => {
  const slugs = records.map((r) => r.slug);
  const concepts = records.flatMap((r) => (r.concept ? [r.concept.qid] : []));
  return [
    ...[...new Set(slugs.filter((s, i) => slugs.indexOf(s) !== i))].map((s) => `slug が重複: ${s}`),
    ...[...new Set(concepts.filter((q, i) => concepts.indexOf(q) !== i))].map((q) => `同じ概念が 2 件: ${q}`),
    ...records.flatMap((r) => {
      const at = `${r.slug}（${r.title.ja}）`;
      return [
        ...(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug) ? [] : [`${at}: slug は英小文字・数字・ハイフンのみ`]),
        ...(Number.isInteger(r.year) && r.year >= -3000 && r.year < 1500 ? [] : [`${at}: year ${r.year} は前3000〜1499 年の整数でなければならない`]),
        ...(["science", "technology", "economy"].includes(r.domain) ? [] : [`${at}: domain ${r.domain} は science / technology / economy のどれか`]),
        ...(r.tags.includes(r.domain) ? [] : [`${at}: tags に主分類を含める`]),
        ...([1, 2, 3].includes(r.importance) ? [] : [`${at}: importance は 1〜3`]),
        ...(/^Q\d+$/.test(r.place.qid) ? [] : [`${at}: place.qid が QID でない`]),
        ...(r.yearBasis && r.place.basis && r.source ? [] : [`${at}: yearBasis・place.basis・source は必須`]),
        ...(["draft", "confirmed"].includes(r.status) ? [] : [`${at}: status は draft / confirmed`]),
      ];
    }),
  ];
};

/** 小数第4位まで（build-app-data.mjs の roundCoord と同じ）。 @param {number} x */
const roundCoord = (x) => Math.round(x * 1e4) / 1e4;

/**
 * 表の 1 件を HistEvent（kind: "instant"）にする。座標が取れていなければエラーにする（推測で埋めない）。
 * @param {FirstRecord} r
 * @param {Readonly<Record<string, import("./place-overrides.mjs").ResolvedRow[]>>} resolved
 * @param {(qid: string) => "fine" | "region" | "country" | "coarse"} granularityOfPlace
 */
export const toFirstRecordEvent = (r, resolved, granularityOfPlace) => {
  const row = pickResolved(resolved[placeKey(firstRecordPlaceRef(r))] ?? [], r.year);
  if (!row) throw new Error(`data/first-records.json: ${r.slug} の ${r.place.qid}（${r.place.label}）の座標が取れません。pnpm wikidata:fetch-app-extras を実行したか確認してください。`);
  const granularity = granularityOfPlace(r.place.qid);
  if (granularity === "coarse") throw new Error(`data/first-records.json: ${r.slug} の ${r.place.qid}（${r.place.label}）は大陸・海洋で、地点として使えません。`);
  return {
    id: `${FIRST_RECORD_ID_PREFIX}${r.slug}`,
    title: r.title,
    description: { ja: r.description },
    domain: r.domain,
    tags: r.tags,
    kind: /** @type {const} */ ("instant"),
    start: r.year,
    places: [{ lon: roundCoord(row.lon), lat: roundCoord(row.lat), label: r.place.label, ...(granularity === "fine" ? {} : { granularity }) }],
    importance: r.importance,
    source: sourceUrlOf(r.source),
  };
};

/**
 * 出典の書き方「en: 記事名 § 節」→ Wikipedia の URL（節は付けない）。
 * @param {string} source
 */
export const sourceUrlOf = (source) => {
  const m = /^(ja|en|[a-z]{2,3}):\s*(.+?)(?:\s*§.*)?$/.exec(source.trim());
  if (!m) return source;
  const title = m[2].trim().replace(/ /g, "_").replace(/[?#%]/g, encodeURIComponent);
  return `https://${m[1]}.wikipedia.org/wiki/${title}`;
};
