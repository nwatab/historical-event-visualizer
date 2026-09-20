// リストのページ（wikitext）→ 項目の列。純粋関数のみ。fetch-lists.mjs と analyze.mjs の両方が使う。
import { join } from "node:path";
import { LIST_PAGES_DIR } from "./config.mjs";
import { TIMELINE_LINKS_PER_LINE, VITAL_PREFIX } from "./lists.mjs";
import { parseTimeline, parseVitalList } from "./wikipedia.mjs";

/** @typedef {import("./lists.mjs").VitalPage} VitalPage */
/** @typedef {import("./lists.mjs").TimelinePage} TimelinePage */

/** 取得したページの保存先。 @param {string} page */
export const pageFile = (page) => join(LIST_PAGES_DIR, `${page.replace(/[^A-Za-z0-9]+/g, "_")}.json`);

/** @param {VitalPage} cfg */
export const vitalPageTitle = (cfg) => VITAL_PREFIX + cfg.page;

/**
 * Vital articles の1ページ分。sections / excludeSections は、その行が属する見出しの列のどこかに一致すれば当たりとする
 * （ページによって、ページ全体の見出しが `=…=` だったり `==…==` だったりして、節の深さが揃っていないため）。
 * @param {VitalPage} cfg @param {string} wikitext
 */
export const vitalEntries = (cfg, wikitext) =>
  parseVitalList(wikitext)
    .filter((e) => !cfg.sections || e.sectionPath.some((h) => cfg.sections?.includes(h)))
    .filter((e) => !e.sectionPath.some((h) => cfg.excludeSections?.includes(h)))
    .map((e) => ({ ...e, source: cfg.page, domain: cfg.domain }));

/**
 * 年表の1ページ分。1行が1項目で、links は主題の候補（行頭から TIMELINE_LINKS_PER_LINE 個）。
 * @param {TimelinePage} cfg @param {string} wikitext
 */
export const timelineEntries = (cfg, wikitext) =>
  parseTimeline(wikitext).map((e) => ({
    ...e,
    links: e.links.slice(0, TIMELINE_LINKS_PER_LINE),
    source: cfg.page,
    domain: cfg.domain,
  }));
