// R4g（調査のみ）: 科学・技術・経済の欠落を、独立した基準のリストで測る。設定と純粋関数。
// 取得は fetch-r4g.mjs、レポートは report-r4g.mjs。アプリ（src/）とアプリ用データの生成（build-app-data.mjs）からは使わない。
//
// 基準のリスト:
//   A … Vital articles Level 4 の科学・技術・経済のページ（パイプラインが使う Level 5 とは別の選抜）
//   B … 地域別の発明・発見の一覧記事（照合用。取り込み元ではない）
//   C … 回帰用の数項目
// 各項目について、パイプライン（fetch → analyze → build-app-data → アプリ）のどの段階で落ちたかを判定する（判定は report-r4g.mjs）。
// 修正の効果の見積もりは、Wikidata の値からパイプラインの規則をなぞる simulate で行う。
import { join } from "node:path";
import { COUNTRY_LEVEL_PLACE_PROPS, LIST_PLACE_PROPS, LIST_TIME_PROPS, WORK_CLASSES } from "./lists.mjs";
import { classify } from "./classify.mjs";
import { granularityOf } from "./place-granularity.mjs";
import { articleLinks, parseVitalList } from "./wikipedia.mjs";

/** @typedef {import("./p31-domain-map.mjs").Domain} Domain */
/** @typedef {import("./regions.mjs").Region} Region */

const ROOT_DIR = join(import.meta.dirname, "..", "..");
/** 作業用ディレクトリ（.gitignore 済みの data/raw/ の下。コミットしない）。 */
export const R4G_DIR = join(ROOT_DIR, "data", "raw", "r4g");
export const R4G_PAGES_DIR = join(R4G_DIR, "pages");
/** 記事名 → { qid, resolved } */
export const R4G_TITLES_PATH = join(R4G_DIR, "titles.json");
/** QID → 属性（R4gAttrs） */
export const R4G_ATTRS_PATH = join(R4G_DIR, "attrs.json");
/** QID → その項目がインスタンスになっているルート（roots.mjs）の QID の配列 */
export const R4G_ROOTS_PATH = join(R4G_DIR, "roots.json");
/** 場所の項目（P276 などの先）のうち data/raw/app/place-classes.json に無いものの P31。QID → { p31 } */
export const R4G_PLACE_CLASSES_PATH = join(R4G_DIR, "place-classes.json");
/** 時間型のプロパティと P31 のクラスのラベル。ID → { ja?, en? } */
export const R4G_LABELS_PATH = join(R4G_DIR, "labels.json");
export const R4G_REPORT_PATH = join(import.meta.dirname, "REPORT-R4g.md");
/**
 * 落ちた項目の一覧。全件（約 940KB）は data/raw/ の下に置いてコミットしない（data/raw/ が無いと再生成できず、次の回で使うのは一部のため。2026-09-22、人の判断）。
 * コミットするのは、Wikidata の年が表示範囲内にあるのに落ちた項目だけ（次の回の候補）。
 */
export const R4G_DROPPED_ALL_PATH = join(R4G_DIR, "dropped-all.md");
export const R4G_DROPPED_DATED_PATH = join(import.meta.dirname, "REPORT-R4g-dropped-dated.md");

/** @param {string} page */
export const r4gPageFile = (page) => join(R4G_PAGES_DIR, `${page.replace(/[^A-Za-z0-9]+/g, "_")}.json`);

/**
 * 取得した属性。times は、時間型の全プロパティ（BestRank）の値を年の昇順で。places は LIST_PLACE_PROPS の値（P625 以外は値の項目の座標）。
 * @typedef {{
 *   labels: { ja?: string, en?: string },
 *   p31: string[],
 *   sitelinks: number,
 *   times: Record<string, { year: number, precision: number }[]>,
 *   places: { prop: string, loc?: string, lon: number, lat: number }[],
 * }} R4gAttrs
 */

// ── 基準のリスト ────────────────────────────────────────────

/**
 * A: Vital articles Level 4。`Level/4/…` は `Level 4/…` へのリダイレクト（Level 5 と同じ。fetchWikitext が辿る）。
 * domain は「このリストを取り込んだ場合」の分類（R4b-1 の Level 5 と同じく、ページで決める）。見積もりでだけ使う。
 * Society and social sciences は、依頼の指定どおり Business and economics の節（その下位の節を含む）だけ。
 * @typedef {{ list: "A", page: string, label: string, domain: Domain, sections?: readonly string[] }} VitalRefPage
 * @type {readonly VitalRefPage[]}
 */
export const REF_A_PAGES = Object.freeze([
  { list: "A", page: "Wikipedia:Vital articles/Level/4/Physical sciences", label: "L4 Physical sciences", domain: "science" },
  { list: "A", page: "Wikipedia:Vital articles/Level/4/Biology and health sciences", label: "L4 Biology and health sciences", domain: "science" },
  { list: "A", page: "Wikipedia:Vital articles/Level/4/Mathematics", label: "L4 Mathematics", domain: "science" },
  { list: "A", page: "Wikipedia:Vital articles/Level/4/Technology", label: "L4 Technology", domain: "technology" },
  {
    list: "A",
    page: "Wikipedia:Vital articles/Level/4/Society and social sciences",
    label: "L4 Business and economics",
    domain: "economy",
    sections: ["Business and economics"],
  },
]);

/**
 * B: 地域別の発明・発見の一覧記事（英語版 Wikipedia）。記事の存在は 2026-09-22 に API（prefixsearch・search・prop=info）で確認した。
 * 選んだ理由は FINDINGS-R4g.md の「基準 B の記事」。region は、この一覧の項目を集計するときの地域（regions.mjs の 10 区分）。
 * 1 行（箇条書きの 1 項目）を 1 項目とし、主題は行頭のリンク（subjectRule）で照合する。
 * - "head": 行頭の太字、無ければ最初の区切り（: – — ,）の前にあるリンク。そこにリンクが無ければ、行の最初のリンク。
 * - "firstNonPerson": 行のリンクのうち、人・地名でない最初のもの（「1961, the [[Black & Decker Workmate]] … by [[Ron Hickman]]」の形）。
 * domain は「このリストを取り込んだ場合」の分類。発明・発見の一覧は分野が混ざるので、仮に技術とする（再現率の見積もりには効かない。
 * 見積もりで要るのは「どれかの分類に入るか」だけのため）。
 * @typedef {{ list: "B", page: string, label: string, region: Region, subjectRule: "head" | "firstNonPerson", domain: Domain }} RegionalRefPage
 * @type {readonly RegionalRefPage[]}
 */
export const REF_B_PAGES = Object.freeze([
  { list: "B", page: "List of Chinese inventions", label: "中国", region: "eastAsia", subjectRule: "head", domain: "technology" },
  { list: "B", page: "List of inventions in the medieval Islamic world", label: "中世イスラーム世界", region: "wana", subjectRule: "head", domain: "technology" },
  { list: "B", page: "List of Indian inventions and discoveries", label: "インド", region: "southAsia", subjectRule: "head", domain: "technology" },
  {
    list: "B",
    page: "List of pre-Columbian inventions and innovations of Indigenous Americans",
    label: "アメリカ大陸（先コロンブス期）",
    region: "latinAmerica",
    subjectRule: "head",
    domain: "technology",
  },
  { list: "B", page: "List of Egyptian inventions and discoveries", label: "エジプト", region: "wana", subjectRule: "head", domain: "technology" },
  {
    list: "B",
    page: "List of South African inventions and discoveries",
    label: "南アフリカ",
    region: "subSaharanAfrica",
    subjectRule: "firstNonPerson",
    domain: "technology",
  },
  { list: "B", page: "List of Indonesian inventions and discoveries", label: "インドネシア", region: "southeastAsia", subjectRule: "head", domain: "technology" },
  { list: "B", page: "List of Filipino inventions and discoveries", label: "フィリピン", region: "southeastAsia", subjectRule: "head", domain: "technology" },
]);

/**
 * C: 回帰用。英語版 Wikipedia の記事名で指定し、QID は記事の wikibase_item で引く。
 * 「アルコールの蒸留」にあたる記事は無いので、Distillation（蒸留）と Distilled beverage（蒸留酒）の両方を見る。
 * ハーバー・ボッシュ法の「場所」は依頼の注記（場所の段階で落ちることの確認用、と読んだ）。
 * @type {readonly { title: string, label: string, note?: string }[]}
 */
export const REF_C_ITEMS = Object.freeze([
  { title: "Gunpowder", label: "火薬" },
  { title: "Compass", label: "羅針盤" },
  { title: "Distillation", label: "アルコールの蒸留（→ 蒸留）" },
  { title: "Distilled beverage", label: "アルコールの蒸留（→ 蒸留酒）" },
  { title: "Special relativity", label: "特殊相対性理論" },
  { title: "General relativity", label: "一般相対性理論" },
  { title: "Irrational number", label: "無理数" },
  { title: "Haber process", label: "ハーバー・ボッシュ法", note: "場所" },
]);

// ── 記事の読み取り（純粋関数） ─────────────────────────────────

/** 項目の並ぶ節ではない見出し（関連項目・出典など）。 */
const NON_ENTRY_SECTIONS = Object.freeze(["See also", "References", "Notes", "Further reading", "External links", "Sources", "Citations", "Bibliography", "Footnotes", "In urban legends"]);

/** `<ref …>…</ref>`・`<ref … />`・`{{…}}`・コメントを落とす。 @param {string} line */
const stripRefsAndTemplates = (line) => {
  const noRefs = line
    .replace(/<!--.*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[^>]*>.*?<\/ref>/g, "")
    .replace(/<ref[^>]*>.*$/g, "");
  /** @param {string} s @returns {string} */
  const strip = (s) => {
    const next = s.replace(/\{\{[^{}]*\}\}/g, "");
    return next === s ? s : strip(next);
  };
  return strip(noRefs);
};

/**
 * 見出しの階層を追いながら行を走査する。
 * @param {string} wikitext
 * @returns {{ line: string, lineNo: number, sectionPath: string[] }[]}
 */
const withSectionPath = (wikitext) =>
  wikitext.split("\n").reduce(
    (acc, raw, lineNo) => {
      const h = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(raw);
      if (h) return { path: [...acc.path.slice(0, h[1].length - 2), h[2].replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").trim()], out: acc.out };
      return { path: acc.path, out: [...acc.out, { line: raw, lineNo: lineNo + 1, sectionPath: acc.path }] };
    },
    { path: /** @type {string[]} */ ([]), out: /** @type {{ line: string, lineNo: number, sectionPath: string[] }[]} */ ([]) },
  ).out;

/**
 * A の 1 ページ分。Level の注記（`([[Wikipedia:Vital articles/Level 3|Level 3]])`）が無い項目は Level 4。
 * @param {VitalRefPage} cfg @param {string} wikitext
 */
export const refAEntries = (cfg, wikitext) =>
  parseVitalList(wikitext)
    .filter((e) => !cfg.sections || e.sectionPath.some((h) => cfg.sections?.includes(h.trim())))
    .map((e) => ({ source: cfg.label, title: e.title, level: e.level === 5 ? 4 : e.level }));

/**
 * B の 1 記事分。1 行 = 1 項目。links は主題の候補（前から順に）。主題の確定は QID の属性が要るので pickSubject で行う。
 * @param {RegionalRefPage} cfg @param {string} wikitext
 */
export const refBEntries = (cfg, wikitext) =>
  withSectionPath(wikitext).flatMap(({ line, lineNo, sectionPath }) => {
    if (!/^[*#]+\s*\S/.test(line)) return [];
    if (sectionPath.some((h) => NON_ENTRY_SECTIONS.includes(h))) return [];
    const body = stripRefsAndTemplates(line.replace(/^[*#]+\s*/, "")).trim();
    if (body === "" || /^\[\[(File|Image):/i.test(body)) return [];
    const all = articleLinks(body);
    const bold = /^'''(.+?)'''/.exec(body)?.[1];
    const sep = body.search(/:(?!\/\/)|\s[–—-]\s|—|,/);
    const head = bold ?? (sep > 0 ? body.slice(0, sep) : "");
    const headLinks = articleLinks(head);
    const links = cfg.subjectRule === "head" ? (headLinks.length > 0 ? headLinks.slice(0, 3) : all.slice(0, 1)) : all.slice(0, 6);
    const text = body.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/'''|''/g, "").slice(0, 100);
    return [{ source: cfg.label, region: cfg.region, lineNo, sectionPath, links, text }];
  });

/**
 * 主題にしない項目の P31（人・地名・国・王朝・民族・言語など）。QID のラベルは 2026-09-22 に wbgetentities で照合した。
 * 網羅はできないので、「自分の P625 を持ち、時間のプロパティを1つも持たない」も地名とみなす（R4b-1 の年表の判定と同じ）。
 */
export const NON_SUBJECT_CLASSES = Object.freeze([
  "Q5", // human
  "Q6256", // country
  "Q3624078", // sovereign state
  "Q3024240", // historical country
  "Q515", // city
  "Q1549591", // big city
  "Q5107", // continent
  "Q164950", // dynasty
  "Q48349", // empire
  "Q82794", // region
  "Q1620908", // historical region
  "Q34770", // language
  "Q1637706", // million city
  "Q41710", // ethnic group
  "Q465299", // archaeological culture
]);

/**
 * 候補のリンクから主題を選ぶ。人・地名でない最初のリンク。
 * @param {readonly string[]} links
 * @param {Readonly<Record<string, { qid: string | null }>>} titles
 * @param {Readonly<Record<string, R4gAttrs>>} attrs
 * @returns {{ status: "subject", qid: string, title: string } | { status: "unresolved" | "personOrPlace" }}
 */
export const pickSubject = (links, titles, attrs) => {
  const pool = links.flatMap((t) => (titles[t]?.qid ? [{ title: t, qid: /** @type {string} */ (titles[t].qid) }] : []));
  if (pool.length === 0) return { status: "unresolved" };
  const isNonSubject = (/** @type {string} */ qid) => {
    const a = attrs[qid];
    if (!a) return false;
    const ownCoordNoTime = a.places.some((p) => p.prop === "P625") && Object.values(a.times).every((ts) => ts.length === 0);
    return a.p31.some((c) => NON_SUBJECT_CLASSES.includes(c)) || ownCoordNoTime;
  };
  const pick = pool.find((r) => !isNonSubject(r.qid));
  return pick ? { status: "subject", ...pick } : { status: "personOrPlace" };
};

// ── 段階 ──────────────────────────────────────────────────

/**
 * パイプラインの段階（依頼の順）。各項目は、通過できた最後の段階の次で「落ちた」とする。
 * - qid: 基準の行・記事名が Wikidata の項目に解決できる
 * - route: パイプラインの入口にある。Level 5（lists.mjs の Vital articles。History を含む）に載っているか、P31 経路（fetch.mjs の events.json）で取れている
 * - year: 開始年が取れ、アプリの表示範囲（前3000〜2025）に入る
 * - domain: 7 分類のどれかに写像される
 * - filters: 除外の規則を通る（場所が 1 つ以上ある・sitelinks 2 以上・国の代表点だけの作品類でない・人が除外していない）= 母集団に入る
 * - generated: public/data/events/ にある（build-app-data.mjs。ラベルが要る）
 * - map: 地図に出る（placeKind が none でなく、neverOnMap でない）
 */
export const STAGES = /** @type {const} */ (["qid", "route", "year", "domain", "filters", "generated", "map"]);
/** @typedef {(typeof STAGES)[number]} Stage */
export const STAGE_LABELS = Object.freeze({
  qid: "QID が解決できる",
  route: "Level 5 / P31 経路にある",
  year: "年が取れる（範囲内）",
  domain: "分類に写像される",
  filters: "除外の規則を通る（母集団）",
  generated: "生成データにある",
  map: "地図に出る",
});

/**
 * Wikidata にある時間のプロパティの一覧（記録用）。"P575:1044(7)" の形。値が複数あれば最も早いもの。
 * @param {R4gAttrs | undefined} a
 */
export const timePropsSummary = (a) =>
  a
    ? Object.entries(a.times)
        .filter(([, ts]) => ts.length > 0)
        .sort(([p], [q]) => Number(p.slice(1)) - Number(q.slice(1)))
        .map(([p, ts]) => `${p}:${ts[0].year}(${ts[0].precision})`)
    : [];

/**
 * 場所の記録: LIST_PLACE_PROPS の優先順で最初に値のあるプロパティと、その粒度（place-granularity.mjs）。
 * kind: usable（地図に置ける場所がある）/ countryPoint（P495・P17 の国の代表点だけ）/ coarse（大陸・海洋だけ）/ none
 * @param {R4gAttrs | undefined} a
 * @param {Readonly<Record<string, { p31: readonly string[] } | null>>} placeClasses
 */
export const placeSummary = (a, placeClasses) => {
  const via = LIST_PLACE_PROPS.find((p) => (a?.places ?? []).some((x) => x.prop === p)) ?? null;
  if (!a || !via) return { via: null, kind: /** @type {"usable" | "countryPoint" | "coarse" | "none"} */ ("none"), granularities: /** @type {string[]} */ ([]) };
  const points = a.places.filter((x) => x.prop === via);
  const granularities = points.map((p) =>
    COUNTRY_LEVEL_PLACE_PROPS.includes(via) ? "country" : p.loc ? granularityOf(placeClasses[p.loc]?.p31 ?? []) : "fine",
  );
  /** @type {"usable" | "countryPoint" | "coarse" | "none"} */
  const kind = COUNTRY_LEVEL_PLACE_PROPS.includes(via) ? "countryPoint" : granularities.every((g) => g === "coarse") ? "coarse" : "usable";
  return { via, kind, granularities };
};

/**
 * 修正の見積もり用: Wikidata の値から、パイプラインの規則をなぞって段階を判定する（list 経路の規則。analyze.mjs の listRecord / buildItems）。
 * 実際のパイプラインとの違い:
 *  - P31 経路の項目も list 経路の規則（年は timeProps の順で最初にあるプロパティの最も早い値、場所は LIST_PLACE_PROPS の順）で見る。
 *    P31 経路の年（P580 → P585 → P582）や、戦争の P276 は見ない。
 *  - 地図に出るかは、使える場所（国の代表点・大陸・海洋以外）があるかだけで見る。importance（neverOnMap）と place-overrides.json は見ない。
 * 一致の度合いは、いまの規則での simulate と実際の判定を比べてレポートに出す。
 *
 * @param {{
 *   attrs: R4gAttrs | undefined,
 *   inRoute: boolean,
 *   listDomain: Domain | null,
 *   refDomain: Domain,
 *   excludedByHand: boolean,
 *   placeClasses: Readonly<Record<string, { p31: readonly string[] } | null>>,
 * }} input listDomain は Level 5 の節で決まる分類（null なら P31 の写像表）。refDomain は基準のリストを取り込んだ場合の分類
 * @param {{
 *   timeProps?: readonly string[],
 *   importLists?: boolean,
 *   extraMappedClasses?: ReadonlySet<string>,
 *   minSitelinks?: number,
 *   keepCountryOnlyWorks?: boolean,
 *   yearMin?: number,
 *   ignorePlace?: boolean,
 * }} [opts] ignorePlace は、場所の条件を外す（場所の欠落を R4h で直せた場合の上限。地図の段階では落とす）
 * @returns {{ dropped: Stage | null }}
 */
export const simulate = (input, opts = {}) => {
  const { attrs: a, placeClasses } = input;
  const timeProps = opts.timeProps ?? LIST_TIME_PROPS;
  if (!a) return { dropped: "qid" };
  if (!input.inRoute && !opts.importLists) return { dropped: "route" };
  const listDomain = input.listDomain ?? (opts.importLists ? input.refDomain : null);
  const prop = timeProps.find((p) => (a.times[p] ?? []).length > 0);
  const start = prop ? a.times[prop][0] : null;
  if (!start || start.year < (opts.yearMin ?? -3000) || start.year > 2025) return { dropped: "year" };
  const mapped = listDomain !== null || classify(a.p31).status === "mapped" || a.p31.some((q) => opts.extraMappedClasses?.has(q));
  if (!mapped) return { dropped: "domain" };
  const place = placeSummary(a, placeClasses);
  const countryOnlyWork = place.kind !== "usable" && a.p31.some((q) => WORK_CLASSES.includes(q));
  if ((place.via === null && !opts.ignorePlace) || a.sitelinks < (opts.minSitelinks ?? 2) || (countryOnlyWork && !opts.keepCountryOnlyWorks) || input.excludedByHand) {
    return { dropped: "filters" };
  }
  if (!a.labels.ja && !a.labels.en) return { dropped: "generated" };
  if (place.kind !== "usable") return { dropped: "map" };
  return { dropped: null };
};
