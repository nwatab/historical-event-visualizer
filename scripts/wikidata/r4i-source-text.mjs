// R4i: 出典の本文を取得して data/raw/r4i/texts/ に保存し、「ファイル:行」で引けるようにする（コミットしない）。
//
//   node scripts/wikidata/r4i-source-text.mjs en "Dream Pool Essays"      # 本文を保存して、パスと行数を出す
//   node scripts/wikidata/r4i-source-text.mjs qid Q34735 Q12861           # QID のラベル（ja/en）・P31・座標の有無を出す
//
// 本文は Wikipedia の API（prop=extracts、explaintext）の平文。見出しは「== 見出し ==」の行として残る。1 段落 = 1 行。
// 取得済みのものはファイルから読む。問い合わせは直列で、1 秒あける。記事名はリダイレクトを辿る（保存するファイル名は、指定した記事名から作る）。
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { USER_AGENT, WIKIDATA_API } from "./config.mjs";
import { sleep } from "./sparql.mjs";

const TEXT_DIR = join(import.meta.dirname, "..", "..", "data", "raw", "r4i", "texts");

/** @param {string} lang @param {string} title */
export const textFile = (lang, title) => {
  const ascii = title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  // 日本語などの記事名は ASCII の部分が空になり、ファイル名が重なるので、記事名のハッシュの先頭 8 桁を付ける
  const hash = /[^\x00-\x7F]/.test(title) ? `${ascii ? "-" : ""}${createHash("sha1").update(title).digest("hex").slice(0, 8)}` : "";
  return join(TEXT_DIR, `${lang}-${ascii}${hash}.txt`);
};

/** @param {string} url */
const getJson = async (url) => {
  await sleep(1000);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
};

/** @param {string} lang @param {string} title */
const fetchText = async (lang, title) => {
  const path = textFile(lang, title);
  try {
    return { path, text: await readFile(path, "utf8"), cached: true };
  } catch {
    const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({ action: "query", prop: "extracts|revisions", rvprop: "ids", explaintext: "1", redirects: "1", titles: title, format: "json", formatversion: "2" }).toString();
    const body = await getJson(url.toString());
    const page = body.query.pages[0];
    if (page.missing) throw new Error(`記事が無い: ${lang}:${title}`);
    const header = `# ${lang}:${page.title}（rev ${page.revisions?.[0]?.revid ?? "?"}、${new Date().toISOString()} 取得）`;
    const text = [header, ...page.extract.split("\n").filter((l) => l.trim() !== "")].join("\n") + "\n";
    await mkdir(TEXT_DIR, { recursive: true });
    await writeFile(path, text);
    return { path, text, cached: false };
  }
};

/** @param {readonly string[]} qids */
const describeQids = async (qids) => {
  const url = new URL(WIKIDATA_API);
  url.search = new URLSearchParams({ action: "wbgetentities", ids: qids.join("|"), props: "labels|claims", languages: "ja|en", format: "json" }).toString();
  const body = await getJson(url.toString());
  return qids.map((q) => {
    const e = body.entities[q];
    if (!e || e.missing !== undefined) return `${q}\t(存在しない)`;
    const p31 = (e.claims?.P31 ?? []).map((/** @type {any} */ c) => c.mainsnak.datavalue?.value.id).join(",");
    const coord = e.claims?.P625?.[0]?.mainsnak.datavalue?.value;
    return `${q}\tja=${e.labels.ja?.value ?? "-"}\ten=${e.labels.en?.value ?? "-"}\tP31=${p31}\tP625=${coord ? `${coord.latitude},${coord.longitude}` : "なし"}`;
  });
};

const [mode, ...rest] = process.argv.slice(2);
if (mode === "qid") {
  console.log((await describeQids(rest)).join("\n"));
} else if (mode && rest.length > 0) {
  const { path, text, cached } = await fetchText(mode, rest.join(" "));
  console.log(`${path}\t${text.split("\n").length - 1} 行${cached ? "（取得済み）" : ""}`);
} else {
  console.error("使い方: r4i-source-text.mjs <lang> <記事名> | r4i-source-text.mjs qid <QID>...");
  process.exit(1);
}
