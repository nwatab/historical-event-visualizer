// 英語版 Wikipedia の API クライアント（副作用はここだけ）と、リスト・年表の wikitext パーサ（純粋関数）。
import { RETRY_DELAYS_MS, USER_AGENT } from "./config.mjs";
import { sleep } from "./sparql.mjs";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
/** リクエストの間隔。直列で、並列には投げない。 */
const PAUSE_MS = 1_000;

// ── 問い合わせ（副作用） ────────────────────────────────────

/**
 * maxlag=5 を付ける（サーバーの複製遅延が大きいときは API 側が断ってくるので、待って再試行する。
 * https://www.mediawiki.org/wiki/Manual:Maxlag_parameter ）。
 * @param {Record<string, string>} params
 * @param {readonly number[]} [delays]
 * @returns {Promise<any>}
 */
const apiGet = async (params, delays = RETRY_DELAYS_MS) => {
  await sleep(PAUSE_MS);
  const url = new URL(WIKIPEDIA_API);
  url.search = new URLSearchParams({ ...params, format: "json", formatversion: "2", maxlag: "5" }).toString();
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  const body = res.ok ? await res.json() : null;
  if (body && !body.error) return body;
  const detail = body?.error?.code ?? `HTTP ${res.status}`;
  if (delays.length === 0) throw new Error(`Wikipedia API: ${detail}`);
  const retryAfter = Number(res.headers.get("retry-after"));
  const wait = Math.max(delays[0], Number.isFinite(retryAfter) ? retryAfter * 1000 : 0);
  console.warn(`  Wikipedia API: ${detail} — ${Math.round(wait / 1000)}s 待って再試行`);
  await sleep(wait);
  return apiGet(params, delays.slice(1));
};

/**
 * ページの wikitext と版番号（出典として記録する）。
 * @param {string} page
 * @returns {Promise<{ page: string, revid: number, wikitext: string, fetchedAt: string }>}
 */
export const fetchWikitext = async (page) => {
  const body = await apiGet({ action: "parse", page, prop: "wikitext|revid", redirects: "1" });
  return { page, revid: body.parse.revid, wikitext: body.parse.wikitext, fetchedAt: new Date().toISOString() };
};

/**
 * 記事名 → Wikidata の QID（ページの wikibase_item。つまり sitelinks 経由の対応）。リダイレクトは辿る。
 * @param {readonly string[]} titles 50 件まで
 * @returns {Promise<Record<string, { qid: string | null, resolved: string | null }>>}
 */
export const resolveTitles = async (titles) => {
  const body = await apiGet({
    action: "query",
    titles: titles.join("|"),
    prop: "pageprops",
    ppprop: "wikibase_item",
    redirects: "1",
  });
  /** @param {readonly { from: string, to: string }[] | undefined} pairs */
  const toMap = (pairs) => new Map((pairs ?? []).map((p) => [p.from, p.to]));
  const normalized = toMap(body.query.normalized);
  const redirects = toMap(body.query.redirects);
  const pages = new Map(body.query.pages.map((/** @type {any} */ p) => [p.title, p]));
  return Object.fromEntries(
    titles.map((title) => {
      const n = normalized.get(title) ?? title;
      const resolved = redirects.get(n) ?? n;
      const page = pages.get(resolved);
      const exists = page && !page.missing && !page.invalid;
      return [title, { qid: page?.pageprops?.wikibase_item ?? null, resolved: exists ? resolved : null }];
    }),
  );
};

// ── パーサ（純粋関数） ──────────────────────────────────────

/** `[[Target#frag|label]]` の Target。記事（名前空間なし）だけを返す。 @param {string} text @returns {string[]} */
export const articleLinks = (text) =>
  [...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)]
    .map((m) => m[1].trim().replace(/_/g, " "))
    .filter((t) => t !== "" && !/^:?(Wikipedia|WP|File|Image|Category|Template|Help|Portal|User|Talk|wikt|s|commons):/i.test(t))
    .map((t) => t.replace(/^:/, ""))
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1));

/** `<ref …>…</ref>`・`<ref … />`・`{{…}}` を落とす（出典の中のリンクを拾わないため）。入れ子のテンプレートは内側から消す。 @param {string} line */
const stripRefsAndTemplates = (line) => {
  const noRefs = line.replace(/<ref[^>]*\/>/g, "").replace(/<ref[^>]*>.*?<\/ref>/g, "");
  /** @param {string} s @returns {string} */
  const strip = (s) => {
    const next = s.replace(/\{\{[^{}]*\}\}/g, "");
    return next === s ? s : strip(next);
  };
  return strip(noRefs);
};

/**
 * 見出しの階層を追いながら行を走査し、各行に「その行が属する見出しの列」を付ける。
 * @param {string} wikitext
 * @returns {{ line: string, sectionPath: string[] }[]}
 */
const withSectionPath = (wikitext) =>
  wikitext.split("\n").reduce(
    (acc, raw) => {
      const h = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(raw);
      if (h) {
        const depth = h[1].length - 2; // "==" を 0 とする
        return { path: [...acc.path.slice(0, depth), h[2]], out: acc.out };
      }
      return { path: acc.path, out: [...acc.out, { line: raw, sectionPath: acc.path }] };
    },
    { path: /** @type {string[]} */ ([]), out: /** @type {{ line: string, sectionPath: string[] }[]} */ ([]) },
  ).out;

/**
 * Vital articles のリスト。`# {{Icon|B}} '''[[Title]]''' ([[Wikipedia:Vital articles/Level 4|Level 4]])` の形の行。
 * level は、上位のレベルにも入っている記事に付く注記から取る（無ければ 5）。
 * @param {string} wikitext
 * @returns {{ title: string, level: number, sectionPath: string[] }[]}
 */
export const parseVitalList = (wikitext) =>
  withSectionPath(wikitext).flatMap(({ line, sectionPath }) => {
    if (!line.startsWith("#")) return [];
    const [title] = articleLinks(line);
    if (!title) return [];
    const level = /Vital articles\/Level (\d)\|/.exec(line);
    return [{ title, level: level ? Number(level[1]) : 5, sectionPath }];
  });

/**
 * 年表。`* '''1764:''' [[James Hargreaves]] invents the [[spinning jenny]] …` の形の行。
 * yearLabel は行頭の年の表記をそのまま残す（解釈は parseListYear）。
 * @param {string} wikitext
 * @returns {{ yearLabel: string, links: string[], text: string, sectionPath: string[] }[]}
 */
export const parseTimeline = (wikitext) =>
  withSectionPath(wikitext).flatMap(({ line, sectionPath }) => {
    // 箇条書き（*）と定義リスト（;1926: …）の両方の書式がある
    if (!/^[*;]+\s*\S/.test(line)) return [];
    const body = stripRefsAndTemplates(line.replace(/^[*;]+\s*/, "").replace(/&nbsp;/g, " "));
    // 行頭の太字、または最初の区切り（: — / 空白で挟まれた – -）までを年の表記とみなす
    const bold = /^'''(.+?)'''\s*[:–—-]?\s*(.*)$/.exec(body);
    const plain = /^([^:—]{1,40}?)\s*(?::|—|\s[–-]\s)\s*(.*)$/.exec(body);
    const m = bold ?? plain;
    if (!m) return [];
    // [[1852 in architecture|1852]] のようなリンクは表示側の文字列を使う
    const yearLabel = m[1]
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
      .replace(/'''|''/g, "")
      .replace(/:$/, "")
      .trim();
    if (!/\d/.test(yearLabel)) return [];
    const links = articleLinks(m[2]);
    if (links.length === 0) return [];
    return [{ yearLabel, links, text: m[2].replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").slice(0, 200), sectionPath }];
  });

/** 「紀元前 n 年」→ 天文年。src/lib/year.ts の bce() と同じ規則（.mjs から import できないため転記）。 @param {number} n */
const bce = (n) => 1 - n;

/**
 * 年表の年の表記 → 天文年（分からなければ null）。範囲は最初の年、世紀は中央の年で代表させる。
 * 例: "1764" → 1764、"1400 BC" → -1399、"5900 – 5600 BC" → -5899、"13th century" → 1250、"3.3 Mya" → null
 * @param {string} label
 * @returns {number | null}
 */
export const parseListYear = (label) => {
  if (/\b(mya|kya|ma|ka|million|bp)\b/i.test(label)) return null;
  const isBce = /\b(BCE?|B\.C\.)/i.test(label) && !/^\D*\d+\s*(AD|CE)\b/i.test(label);
  const century = /(\d{1,2})(?:st|nd|rd|th)[\s-]+(?:century|c\.)/i.exec(label);
  const millennium = /(\d{1,2})(?:st|nd|rd|th)[\s-]+millennium/i.exec(label);
  const plain = /(\d{1,5})(?![\d.]|\s*(?:st|nd|rd|th)\b)/.exec(label.replace(/,(?=\d{3})/g, ""));
  const n = millennium
    ? (Number(millennium[1]) - 1) * 1000 + 500
    : century
      ? (Number(century[1]) - 1) * 100 + 50
      : plain
        ? Number(plain[1])
        : null;
  if (n === null || n === 0) return null;
  return isBce ? bce(n) : n;
};
