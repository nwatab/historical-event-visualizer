// data/raw/ の取得結果を読み、analyze.mjs で1つの項目の列にまとめる。ファイルの読み込み（副作用）はここに集める。
// report.mjs・fetch-app-extras.mjs・build-app-data.mjs が同じ母集団を使うための共通の入口。
import { readFile, writeFile } from "node:fs/promises";
import { buildItems, listRecord } from "./analyze.mjs";
import {
  COUNTRIES_PATH,
  COUNTRIES_URL,
  EVENTS_PATH,
  FETCH_LOG_PATH,
  LIST_ATTRS_PATH,
  LIST_TITLES_PATH,
  PARENTS_PATH,
  PLACE_CLASSES_PATH,
  PLACE_OVERRIDES_PATH,
  USER_AGENT,
} from "./config.mjs";
import { pageFile, vitalEntries, vitalPageTitle } from "./list-entries.mjs";
import { VITAL_PAGES } from "./lists.mjs";
import { buildCountryIndex } from "./regions.mjs";

/** @param {string} path */
export const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

/** ファイルが無ければ fallback。 @param {string} path @param {any} fallback */
export const readJsonOr = (path, fallback) => readJson(path).catch(() => fallback);

/** 地域判定用の Natural Earth。無ければ1度だけ取りに行く。 */
export const loadCountries = async () => {
  try {
    return await readJson(COUNTRIES_PATH);
  } catch {
    console.log(`Natural Earth を取得: ${COUNTRIES_URL}`);
    const res = await fetch(COUNTRIES_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Natural Earth の取得に失敗: HTTP ${res.status}`);
    const text = await res.text();
    await writeFile(COUNTRIES_PATH, text);
    return JSON.parse(text);
  }
};

export const loadAnalysis = async () => {
  /** @type {readonly import("./merge.mjs").RawItem[]} */
  const rawItems = await readJson(EVENTS_PATH);
  const [log, countries, outsideParents, titles, attrs, placeOverrides, placeClasses] = await Promise.all([
    readJson(FETCH_LOG_PATH),
    loadCountries(),
    readJsonOr(PARENTS_PATH, {}),
    readJsonOr(LIST_TITLES_PATH, {}),
    readJsonOr(LIST_ATTRS_PATH, {}),
    /** @type {Promise<import("./place-overrides.mjs").PlaceOverrides>} */ (readJson(PLACE_OVERRIDES_PATH)),
    readJsonOr(PLACE_CLASSES_PATH, {}),
  ]);
  // 選抜リスト: 保存済みのページ → 項目 → QID・属性を引き当てる。まだ取得していなければ空
  const vitalPages = (
    await Promise.all(VITAL_PAGES.map(async (cfg) => ({ cfg, page: await readJsonOr(pageFile(vitalPageTitle(cfg)), null) })))
  ).filter((p) => p.page !== null);
  const listRecords = vitalPages.flatMap(({ cfg, page }) =>
    vitalEntries(cfg, page.wikitext).map((e) => {
      const qid = titles[e.title]?.qid ?? null;
      return listRecord({ source: e.source, domain: e.domain, title: e.title, level: e.level }, qid, qid ? attrs[qid] : undefined);
    }),
  );
  const countryIndex = buildCountryIndex(countries);
  return {
    ...buildItems({ rawItems, outsideParents, listRecords, countryIndex, excludedQids: placeOverrides.exclude.map((e) => e.qid), placeClasses }),
    placeClasses,
    placeOverrides,
    listRecords,
    countryIndex,
    /** @type {readonly { rootQid: string, status: string, fetchedAt: string }[]} */
    fetchLog: log,
    /** @type {readonly { page: string, revid: number, fetchedAt: string }[]} */
    listPages: vitalPages.map(({ page }) => ({ page: page.page, revid: page.revid, fetchedAt: page.fetchedAt })),
  };
};
