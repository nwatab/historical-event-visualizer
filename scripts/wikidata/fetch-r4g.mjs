// R4g（調査のみ）: 基準のリスト（r4g-survey.mjs の A・B・C）を取得し、各項目の Wikidata の属性を data/raw/r4g/ に保存する（コミットしない）。
//
//   node scripts/wikidata/fetch-r4g.mjs
//
// 1. 基準のリストのページの wikitext（版番号つき。再実行時は取り直さない）
// 2. 記事名 → QID（ページの wikibase_item。50 件ずつ）。B は主題の候補のリンクすべて
// 3. QID → sitelinks・ラベル・P31（fetch-lists.mjs と同じクエリ）、時間型の全プロパティ（精度つき）、場所（LIST_PLACE_PROPS）
// 4. QID → どのルート（roots.mjs）のインスタンスか（fetch.mjs と同じ基準。P31 経路に年のプロパティを足した場合の見積もりに使う）
// 5. 場所の項目の P31（粒度の判定用。data/raw/app/place-classes.json に無いものだけ）
// 6. 時間型のプロパティと P31 のクラスのラベル（レポート用）
// どの段も、取得済みの分はファイルから読み、足りない分だけ問い合わせる。クエリは直列で、間隔を空ける（sparql.mjs / wikipedia.mjs）。
// 取得した値をそのまま保存するだけで、段階の判定は report-r4g.mjs が行う。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CLASS_LABELS_PATH, PLACE_CLASSES_PATH } from "./config.mjs";
import { LIST_PLACE_PROPS } from "./lists.mjs";
import {
  R4G_ATTRS_PATH,
  R4G_LABELS_PATH,
  R4G_PAGES_DIR,
  R4G_PLACE_CLASSES_PATH,
  R4G_ROOTS_PATH,
  R4G_TITLES_PATH,
  REF_A_PAGES,
  REF_B_PAGES,
  REF_C_ITEMS,
  r4gPageFile,
  refAEntries,
  refBEntries,
} from "./r4g-survey.mjs";
import { ROOTS } from "./roots.mjs";
import { buildLabelsQuery, buildListCoreQuery, buildListPlacesQuery, parsePoint, parseYear, qidOf, runQuery } from "./sparql.mjs";
import { fetchWikitext, resolveTitles } from "./wikipedia.mjs";

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
  items.reduce(async (acc, item, index) => [...(await acc), await fn(item, index)], /** @type {Promise<U[]>} */ (Promise.resolve([])));

/** @template T @param {readonly T[]} xs @param {number} size @returns {T[][]} */
const chunksOf = (xs, size) => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

/** @param {readonly string[]} qids */
const valuesOf = (qids) => `VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }`;

// ── クエリ（純粋関数） ─────────────────────────────────────

/**
 * 時間型の全プロパティ（BestRank）の値と精度。どのプロパティに年が入っているか（入っていないか）を記録するため、プロパティを限定しない。
 * @param {readonly string[]} qids
 */
const allTimesQuery = (qids) => `
SELECT ?item ?prop ?t ?prec WHERE {
  hint:Query hint:optimizer "None" .
  ${valuesOf(qids)}
  ?item ?p ?st . ?st a wikibase:BestRank .
  ?pe wikibase:claim ?p ; wikibase:propertyType wikibase:Time ; wikibase:statementValue ?psv .
  ?st ?psv ?v . ?v wikibase:timeValue ?t ; wikibase:timePrecision ?prec .
  BIND(STRAFTER(STR(?pe), "entity/") AS ?prop)
}`;

/** どのルートのインスタンスか（fetch.mjs と同じ基準: subclasses なら P31/P279*、そうでなければ P31）。 @param {readonly string[]} qids */
const rootsQuery = (qids) => `
SELECT DISTINCT ?item ?root WHERE {
  ${valuesOf(qids)}
  { VALUES ?root { ${ROOTS.filter((r) => r.subclasses).map((r) => `wd:${r.qid}`).join(" ")} } ?item wdt:P31/wdt:P279* ?root . }
  UNION
  { VALUES ?root { ${ROOTS.filter((r) => !r.subclasses).map((r) => `wd:${r.qid}`).join(" ")} } ?item wdt:P31 ?root . }
}`;

/** @param {readonly string[]} qids */
const p31Query = (qids) => `SELECT ?item ?c WHERE { ${valuesOf(qids)} ?item wdt:P31 ?c . }`;

// ── 取得（副作用） ─────────────────────────────────────────

/** @param {string} page */
const loadPage = async (page) => {
  const cached = await readJson(r4gPageFile(page));
  if (cached) return cached;
  const fetched = await fetchWikitext(page);
  await writeJson(r4gPageFile(page), fetched);
  console.log(`  ${page} (rev ${fetched.revid}, ${fetched.wikitext.length} 文字)`);
  return fetched;
};

/** @param {readonly string[]} titles */
const loadTitles = async (titles) => {
  /** @type {Record<string, { qid: string | null, resolved: string | null }>} */
  const known = (await readJson(R4G_TITLES_PATH)) ?? {};
  const batches = chunksOf(titles.filter((t) => !(t in known)), 50);
  return batches.reduce(async (accP, batch, i) => {
    const next = { ...(await accP), ...(await resolveTitles(batch)) };
    if (i % 10 === 9 || i === batches.length - 1) {
      await writeJson(R4G_TITLES_PATH, next);
      console.log(`  記事名 → QID: バッチ ${i + 1} / ${batches.length}`);
    }
    return next;
  }, Promise.resolve(known));
};

/** @param {readonly string[]} batch @returns {Promise<[string, import("./r4g-survey.mjs").R4gAttrs][] | null>} */
const fetchAttrsBatch = async (batch) => {
  const core = await runQuery(buildListCoreQuery(batch));
  const times = await runQuery(allTimesQuery(batch));
  const places = await runQuery(buildListPlacesQuery(batch, LIST_PLACE_PROPS));
  if (core.status !== "ok" || times.status !== "ok" || places.status !== "ok") return null;
  const coreBy = Map.groupBy(core.bindings, (b) => qidOf(b.item.value));
  const timesBy = Map.groupBy(times.bindings, (b) => qidOf(b.item.value));
  const placesBy = Map.groupBy(places.bindings, (b) => qidOf(b.item.value));
  /** @template T @param {readonly T[]} xs @param {(x: T) => string} key */
  const uniqueBy = (xs, key) => [...new Map(xs.map((x) => [key(x), x])).values()];
  return batch.map((qid) => {
    const c = coreBy.get(qid) ?? [];
    const ts = (timesBy.get(qid) ?? []).flatMap((b) => {
      const year = parseYear(b.t.value);
      return year === null ? [] : [{ prop: b.prop.value, year, precision: Number(b.prec.value) }];
    });
    const ps = (placesBy.get(qid) ?? []).flatMap((b) => {
      const point = parsePoint(b.coord.value);
      return point ? [{ prop: b.prop.value, ...(b.loc ? { loc: qidOf(b.loc.value) } : {}), ...point }] : [];
    });
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
          [...new Set(ts.map((t) => t.prop))].map((prop) => [
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

/**
 * 取得済みの分を読み、足りない分だけバッチで取って保存する。
 * @template V
 * @param {string} path
 * @param {readonly string[]} keys
 * @param {number} size
 * @param {(batch: readonly string[]) => Promise<[string, V][] | null>} fetchBatch
 * @param {string} name
 * @returns {Promise<Record<string, V>>}
 */
const loadInBatches = async (path, keys, size, fetchBatch, name) => {
  const known = (await readJson(path)) ?? {};
  const batches = chunksOf(keys.filter((k) => !(k in known)).sort(), size);
  return batches.reduce(async (accP, batch, i) => {
    const acc = await accP;
    const rows = await fetchBatch(batch);
    if (!rows) {
      console.warn(`  ${name}の取得に失敗（${batch.length} 件）。再実行すれば、この分だけ取り直す`);
      return acc;
    }
    const next = { ...acc, ...Object.fromEntries(rows) };
    await writeJson(path, next);
    console.log(`  ${name}: バッチ ${i + 1} / ${batches.length}`);
    return next;
  }, Promise.resolve(known));
};

/** @param {readonly string[]} batch @returns {Promise<[string, string[]][] | null>} */
const fetchRootsBatch = async (batch) => {
  const r = await runQuery(rootsQuery(batch));
  if (r.status !== "ok") return null;
  const by = Map.groupBy(r.bindings, (b) => qidOf(b.item.value));
  return batch.map((q) => [q, [...new Set((by.get(q) ?? []).map((b) => qidOf(b.root.value)))].sort()]);
};

/** @param {readonly string[]} batch @returns {Promise<[string, { p31: string[] }][] | null>} */
const fetchPlaceClassesBatch = async (batch) => {
  const r = await runQuery(p31Query(batch));
  if (r.status !== "ok") return null;
  const by = Map.groupBy(r.bindings, (b) => qidOf(b.item.value));
  return batch.map((q) => [q, { p31: [...new Set((by.get(q) ?? []).map((b) => qidOf(b.c.value)))].sort() }]);
};

/** @param {readonly string[]} batch @returns {Promise<[string, { ja?: string, en?: string }][] | null>} */
const fetchLabelsBatch = async (batch) => {
  const r = await runQuery(buildLabelsQuery(batch));
  if (r.status !== "ok") return null;
  const found = new Map(r.bindings.map((b) => [qidOf(b.c.value), { ...(b.ja ? { ja: b.ja.value } : {}), ...(b.en ? { en: b.en.value } : {}) }]));
  return batch.map((q) => [q, found.get(q) ?? {}]);
};

// ── メイン ────────────────────────────────────────────────

await mkdir(R4G_PAGES_DIR, { recursive: true });

console.log(`[1/6] 基準のリストのページ（A ${REF_A_PAGES.length} + B ${REF_B_PAGES.length}）`);
const aPages = await sequentially(REF_A_PAGES, async (cfg) => ({ cfg, page: await loadPage(cfg.page) }));
const bPages = await sequentially(REF_B_PAGES, async (cfg) => ({ cfg, page: await loadPage(cfg.page) }));

const titles = [
  ...new Set([
    ...aPages.flatMap(({ cfg, page }) => refAEntries(cfg, page.wikitext).map((e) => e.title)),
    ...bPages.flatMap(({ cfg, page }) => refBEntries(cfg, page.wikitext).flatMap((e) => e.links)),
    ...REF_C_ITEMS.map((c) => c.title),
  ]),
].sort();
console.log(`[2/6] 記事名 → QID（${titles.length} 件）`);
const resolved = await loadTitles(titles);
const qids = [...new Set(titles.flatMap((t) => (resolved[t]?.qid ? [/** @type {string} */ (resolved[t].qid)] : [])))];

console.log(`[3/6] 属性（${qids.length} 件）`);
const attrs = await loadInBatches(R4G_ATTRS_PATH, qids, 200, fetchAttrsBatch, "属性");

console.log(`[4/6] ルート（${qids.length} 件）`);
await loadInBatches(R4G_ROOTS_PATH, qids, 150, fetchRootsBatch, "ルート");

const sharedPlaceClasses = (await readJson(PLACE_CLASSES_PATH)) ?? {};
const locs = [...new Set(Object.values(attrs).flatMap((a) => a.places.flatMap((p) => (p.loc ? [p.loc] : []))))].filter((q) => !(q in sharedPlaceClasses));
console.log(`[5/6] 場所の項目の P31（${locs.length} 件）`);
await loadInBatches(R4G_PLACE_CLASSES_PATH, locs, 300, fetchPlaceClassesBatch, "場所の P31");

const sharedClassLabels = (await readJson(CLASS_LABELS_PATH)) ?? {};
const labelIds = [
  ...new Set([...Object.values(attrs).flatMap((a) => [...a.p31, ...Object.keys(a.times)])]),
].filter((q) => !(q in sharedClassLabels));
console.log(`[6/6] ラベル（${labelIds.length} 件）`);
await loadInBatches(R4G_LABELS_PATH, labelIds, 300, fetchLabelsBatch, "ラベル");
console.log("完了。出力先: data/raw/r4g/");
