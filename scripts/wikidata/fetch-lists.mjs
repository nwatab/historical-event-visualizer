// R4b-1: Wikipedia の選抜リスト（lists.mjs）から項目を取り、Wikidata の QID と属性を引いて data/raw/lists/ に保存する。
//
//   pnpm wikidata:fetch-lists
//
// 手順:
//   1. リストのページの wikitext を取る（版番号つきで保存。再実行時は取り直さない）
//   2. wikitext から記事名を抜く（wikipedia.mjs の純粋関数）
//   3. 記事名 → QID（ページの wikibase_item。50 件ずつ）
//   4. QID → sitelinks・ラベル・P31・年・場所（SPARQL、VALUES で 300 件ずつ）
//   5. 年表の行の主題の候補について、人口（P1082）を持つか（＝地名か）を引く
// どの段も、取得済みの分はファイルから読み、足りない分だけ問い合わせる。クエリは直列で、間隔を空ける。
//
// ここでは取得した値をそのまま保存するだけで、年・場所の選び方や分類は analyze.mjs が決める。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { LIST_ATTRS_PATH, LIST_PAGES_DIR, LIST_POPULATED_PATH, LIST_TITLES_PATH, LISTS_DIR } from "./config.mjs";
import { pageFile, timelineEntries, vitalEntries, vitalPageTitle } from "./list-entries.mjs";
import { LIST_PLACE_PROPS, LIST_TIME_PROPS, TIMELINE_PAGES, VITAL_PAGES } from "./lists.mjs";
import {
  buildListCoreQuery,
  buildListPlacesQuery,
  buildPopulatedQuery,
  buildListTimesQuery,
  parsePoint,
  parseYear,
  qidOf,
  runQuery,
} from "./sparql.mjs";
import { fetchWikitext, resolveTitles } from "./wikipedia.mjs";

/**
 * QID ごとの属性（取得した値そのまま）。
 * @typedef {{
 *   labels: { ja?: string, en?: string },
 *   p31: string[],
 *   sitelinks: number,
 *   times: Record<string, { year: number, precision: number }[]>,
 *   places: { prop: string, loc?: string, lon: number, lat: number }[],
 * }} ListAttrs
 */

// ── 小道具 ────────────────────────────────────────────────

/** @param {string} path @returns {Promise<any | null>} */
const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
};

/** @param {string} path @param {unknown} value */
const writeJson = (path, value) => writeFile(path, JSON.stringify(value));

/** @template T, U @param {readonly T[]} items @param {(item: T, index: number) => Promise<U>} fn @returns {Promise<U[]>} */
const sequentially = (items, fn) =>
  items.reduce(
    async (acc, item, index) => [...(await acc), await fn(item, index)],
    /** @type {Promise<U[]>} */ (Promise.resolve([])),
  );

/** @template T @param {readonly T[]} xs @param {number} size @returns {T[][]} */
const chunksOf = (xs, size) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

// ── 取得 ──────────────────────────────────────────────────

/** @param {string} page */
const loadPage = async (page) => {
  const cached = await readJson(pageFile(page));
  if (cached) return cached;
  const fetched = await fetchWikitext(page);
  await writeJson(pageFile(page), fetched);
  console.log(`  ${page} (rev ${fetched.revid}, ${fetched.wikitext.length} 文字)`);
  return fetched;
};

/** @param {readonly string[]} titles @returns {Promise<Record<string, { qid: string | null, resolved: string | null }>>} */
const loadTitles = async (titles) => {
  /** @type {Record<string, { qid: string | null, resolved: string | null }>} */
  const known = (await readJson(LIST_TITLES_PATH)) ?? {};
  const missing = titles.filter((t) => !(t in known));
  const batches = chunksOf(missing, 50);
  const final = await batches.reduce(async (accP, batch, i) => {
    const acc = await accP;
    const next = { ...acc, ...(await resolveTitles(batch)) };
    // 途中で止まっても取り直さずに済むよう、10 バッチごとに保存する
    if (i % 10 === 9 || i === batches.length - 1) {
      await writeJson(LIST_TITLES_PATH, next);
      console.log(`  記事名 → QID: ${Math.min((i + 1) * 50, missing.length)} / ${missing.length}`);
    }
    return next;
  }, Promise.resolve(known));
  return final;
};

/**
 * @param {readonly string[]} batch
 * @returns {Promise<[string, ListAttrs][] | null>} どれかのクエリが失敗したら null（次回の実行で取り直す）
 */
const fetchAttrsBatch = async (batch) => {
  const core = await runQuery(buildListCoreQuery(batch));
  const times = await runQuery(buildListTimesQuery(batch, LIST_TIME_PROPS));
  const places = await runQuery(buildListPlacesQuery(batch, LIST_PLACE_PROPS));
  if (core.status !== "ok" || times.status !== "ok" || places.status !== "ok") return null;
  const coreBy = Map.groupBy(core.bindings, (b) => qidOf(b.item.value));
  const timesBy = Map.groupBy(times.bindings, (b) => qidOf(b.item.value));
  const placesBy = Map.groupBy(places.bindings, (b) => qidOf(b.item.value));
  return batch.map((qid) => {
    const c = coreBy.get(qid) ?? [];
    const ts = (timesBy.get(qid) ?? []).flatMap((b) => {
      const year = parseYear(b.t.value);
      return year === null ? [] : [{ prop: b.prop.value, year, precision: Number(b.prec.value) }];
    });
    const ps = (placesBy.get(qid) ?? []).flatMap((b) => {
      const point = parsePoint(b.coord.value); // 地球以外の座標は null
      return point ? [{ prop: b.prop.value, ...(b.loc ? { loc: qidOf(b.loc.value) } : {}), ...point }] : [];
    });
    /** @template T @param {readonly T[]} xs @param {(x: T) => string} key */
    const uniqueBy = (xs, key) => [...new Map(xs.map((x) => [key(x), x])).values()];
    return [
      qid,
      {
        labels: {
          ...(c.find((b) => b.ja) ? { ja: c.find((b) => b.ja)?.ja.value } : {}),
          ...(c.find((b) => b.en) ? { en: c.find((b) => b.en)?.en.value } : {}),
        },
        p31: [...new Set(c.flatMap((b) => (b.p31 ? [qidOf(b.p31.value)] : [])))].sort(),
        sitelinks: Number(c[0]?.links.value ?? 0),
        times: Object.fromEntries(
          LIST_TIME_PROPS.map((prop) => [
            prop,
            uniqueBy(
              ts.filter((t) => t.prop === prop).map(({ year, precision }) => ({ year, precision })),
              (t) => `${t.year}|${t.precision}`,
            ).sort((a, b) => a.year - b.year),
          ]),
        ),
        places: uniqueBy(ps, (p) => `${p.prop}|${p.loc ?? ""}|${p.lon},${p.lat}`),
      },
    ];
  });
};

/** @param {readonly string[]} qids @returns {Promise<Record<string, ListAttrs>>} */
const loadAttrs = async (qids) => {
  /** @type {Record<string, ListAttrs>} */
  const known = (await readJson(LIST_ATTRS_PATH)) ?? {};
  const batches = chunksOf(qids.filter((q) => !(q in known)).sort(), 300);
  return batches.reduce(async (accP, batch, i) => {
    const acc = await accP;
    const rows = await fetchAttrsBatch(batch);
    if (!rows) {
      console.warn(`  属性の取得に失敗（${batch.length} 件）。再実行すれば、この分だけ取り直す`);
      return acc;
    }
    const next = { ...acc, ...Object.fromEntries(rows) };
    await writeJson(LIST_ATTRS_PATH, next);
    console.log(`  属性: バッチ ${i + 1} / ${batches.length}`);
    return next;
  }, Promise.resolve(known));
};

/**
 * 年表の主題の候補が地名かどうか（人口を持つかどうか）。
 * @param {readonly string[]} qids @returns {Promise<Record<string, boolean>>}
 */
const loadPopulated = async (qids) => {
  /** @type {Record<string, boolean>} */
  const known = (await readJson(LIST_POPULATED_PATH)) ?? {};
  const batches = chunksOf(qids.filter((q) => !(q in known)).sort(), 300);
  return batches.reduce(async (accP, batch) => {
    const acc = await accP;
    const result = await runQuery(buildPopulatedQuery(batch));
    if (result.status !== "ok") {
      console.warn(`  人口の有無の取得に失敗（${batch.length} 件）。再実行すれば、この分だけ取り直す`);
      return acc;
    }
    const populated = new Set(result.bindings.map((b) => qidOf(b.item.value)));
    const next = { ...acc, ...Object.fromEntries(batch.map((q) => [q, populated.has(q)])) };
    await writeJson(LIST_POPULATED_PATH, next);
    return next;
  }, Promise.resolve(known));
};

// ── メイン ────────────────────────────────────────────────

await mkdir(LIST_PAGES_DIR, { recursive: true });

console.log(`[1/4] リストのページ（${VITAL_PAGES.length + TIMELINE_PAGES.length} ページ）`);
const vital = await sequentially(VITAL_PAGES, async (cfg) => ({ cfg, page: await loadPage(vitalPageTitle(cfg)) }));
const timelines = await sequentially(TIMELINE_PAGES, async (cfg) => ({ cfg, page: await loadPage(cfg.page) }));

const titles = [
  ...new Set([
    ...vital.flatMap(({ cfg, page }) => vitalEntries(cfg, page.wikitext).map((e) => e.title)),
    ...timelines.flatMap(({ cfg, page }) => timelineEntries(cfg, page.wikitext).flatMap((e) => e.links)),
  ]),
].sort();
console.log(`[2/4] 記事名 → QID（${titles.length} 件）`);
const resolved = await loadTitles(titles);

const qids = [...new Set(Object.values(resolved).flatMap((r) => (r.qid ? [r.qid] : [])))];
console.log(`[3/4] Wikidata の属性（${qids.length} 件）`);
const attrs = await loadAttrs(qids);

const candidateQids = [
  ...new Set(
    timelines.flatMap(({ cfg, page }) =>
      timelineEntries(cfg, page.wikitext).flatMap((e) => e.links.flatMap((t) => (resolved[t]?.qid ? [resolved[t].qid] : []))),
    ),
  ),
];
console.log(`[4/4] 年表の主題の候補が地名かどうか（${candidateQids.length} 件）`);
const populated = await loadPopulated(/** @type {string[]} */ (candidateQids));
console.log(`  地名 ${Object.values(populated).filter(Boolean).length} 件`);
console.log(`完了。属性あり ${Object.keys(attrs).length} 件。出力先: ${LISTS_DIR}`);
