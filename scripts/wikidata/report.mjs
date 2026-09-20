// data/raw/ の取得結果（P31 ベースの項目 + 選抜リストの項目）から、分布レポート（scripts/wikidata/REPORT.md）を作る。
// R4a で作り、R4b-1 で取得条件の変更（戦争の P276、会戦の P361、選抜リスト、importance の試算）に合わせて拡張した。
//
//   pnpm wikidata:report
//
// ネットワークには、地域判定用の Natural Earth を初回に1度だけ取りに行く。
// REPORT.md は自動生成なので手で編集しない。数値の読み方・所見は FINDINGS.md に書く。
import { readFile, writeFile } from "node:fs/promises";
import {
  APP_YEAR_MAX,
  APP_YEAR_MIN,
  CLASS_LABELS_PATH,
  COORD_LOSS_PATH,
  COUNTRIES_PATH,
  COUNTRIES_URL,
  EVENTS_PATH,
  FETCH_LOG_PATH,
  LIST_ATTRS_PATH,
  LIST_MISSING_PATH,
  LIST_POPULATED_PATH,
  LIST_TITLES_PATH,
  MANUAL_ITEMS_PATH,
  PARENTS_PATH,
  REPORT_PATH,
  USER_AGENT,
} from "./config.mjs";
import { buildItems, listRecord, timelineSubject } from "./analyze.mjs";
import { isMappedClass } from "./classify.mjs";
import { pageFile, timelineEntries, vitalEntries, vitalPageTitle } from "./list-entries.mjs";
import { TIMELINE_PAGES, VITAL_PAGES } from "./lists.mjs";
import { DOMAIN_PRIORITY, P31_DOMAIN_MAP } from "./p31-domain-map.mjs";
import { REGIONS, buildCountryIndex, regionOf } from "./regions.mjs";
import { missingRecords, r4aSubset, sectionComparison, sectionConflict, sectionImportance, sectionLists } from "./report-r4b.mjs";
import {
  COARSE_ERAS,
  DOMAINS,
  DOMAIN_LABELS,
  REGION_KEYS,
  coarseEra,
  eraLabel,
  eraOf,
  formatYear,
  regionLabel,
} from "./report-common.mjs";
import { ROOTS } from "./roots.mjs";
import { countBy, fmt, histogram, mdTable, percent, summarize } from "./stats.mjs";

/** @typedef {import("./merge.mjs").RawItem} RawItem */
/** @typedef {import("./analyze.mjs").Item} Item */
/** @typedef {import("./analyze.mjs").AnyItem} AnyItem */

// ── 読み込み（副作用） ──────────────────────────────────────

/** @param {string} path */
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

/** 選抜リストをまだ取得していなくてもレポートは作れるようにする。 @param {string} path @param {any} fallback */
const readJsonOr = (path, fallback) => readJson(path).catch(() => fallback);

const loadCountries = async () => {
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

// ── 導出（純粋関数） ────────────────────────────────────────

// ── 各節（純粋関数。Item[] → Markdown） ───────────────────────

/** @param {readonly Item[]} mapped @param {readonly AnyItem[]} all */
const sectionRegions = (mapped, all) => {
  const rows = REGION_KEYS.map((r) => {
    const m = mapped.filter((i) => i.region === r);
    const a = all.filter((i) => i.region === r);
    return [regionLabel(r), m.length, percent(m.length, mapped.length), a.length, percent(a.length, all.length)];
  });
  const europe = mapped.filter((i) => i.region === "europe").length;
  const ratios = REGIONS.filter((r) => r !== "europe").map((r) => {
    const n = mapped.filter((i) => i.region === r).length;
    return [regionLabel(r), n, n === 0 ? "–" : `${(europe / n).toFixed(1)} 倍`];
  });
  const nearest = mapped.filter((i) => i.regionMethod === "nearest").length;
  const byDomain = REGION_KEYS.map((r) => {
    const m = mapped.filter((i) => i.region === r);
    return [regionLabel(r), ...DOMAINS.map((d) => m.filter((i) => i.classification.status === "mapped" && i.classification.domain === d).length)];
  });
  return [
    "## a) 地域別の件数",
    "",
    "「写像済み」は 7分類のどれかに写像できた項目（以降の節の母集団）。「取得全体」は写像漏れ・対象外も含む。",
    "",
    mdTable(["地域", "写像済み", "割合", "取得全体", "割合"], rows),
    "",
    `地域は座標から判定した（座標が複数ある項目は、各座標の地域のうち最も多いもの）。国ポリゴンの内側に入らず、最も近い国に寄せた項目は ${nearest} 件（${percent(nearest, mapped.length)}）。`,
    "",
    "### ヨーロッパの件数は各地域の何倍か（写像済み）",
    "",
    mdTable(["地域", "件数", "ヨーロッパ ÷ この地域"], ratios),
    "",
    "### 地域 × 分類（写像済み、主分類）",
    "",
    mdTable(["地域", ...DOMAINS.map((d) => DOMAIN_LABELS[d])], byDomain),
  ].join("\n");
};

/** @param {readonly Item[]} mapped */
const sectionEras = (mapped) => {
  const years = mapped.map((i) => /** @type {NonNullable<Item["start"]>} */ (i.start).year);
  const eras = [...new Set(years.map(eraOf))].sort((a, b) => a - b);
  const rows = eras.map((from) => {
    const n = years.filter((y) => eraOf(y) === from).length;
    return [eraLabel(from), n, percent(n, years.length)];
  });
  const bce = years.filter((y) => y <= 0).length;
  const cross = REGION_KEYS.map((r) => {
    const m = mapped.filter((i) => i.region === r);
    return [regionLabel(r), ...COARSE_ERAS.map((e) => m.filter((i) => coarseEra(/** @type {any} */ (i.start).year) === e).length)];
  });
  const after1900 = years.filter((y) => y >= 1900).length;
  const centuries = [...new Set(years.filter((y) => y > 1500).map((y) => Math.ceil(y / 100)))].sort((a, b) => a - b);
  const centuryRows = centuries.map((c) => {
    const n = years.filter((y) => y > 1500 && Math.ceil(y / 100) === c).length;
    return [`${(c - 1) * 100 + 1}〜${Math.min(c * 100, APP_YEAR_MAX)}`, n, percent(n, years.length)];
  });
  return [
    "## b) 年代別の件数",
    "",
    `開始年（P31 ベースの項目は P580 → P585 → P582、リスト由来の項目は P585 → P575 → P571 → P577 → P580 の順で最初にあるもの）で数えた。アプリの表示範囲（${formatYear(APP_YEAR_MIN)}〜${APP_YEAR_MAX}年）の外は母集団から除いてある。`,
    "",
    mdTable(["年代", "件数", "割合"], rows),
    "",
    `- 紀元前: ${bce} 件（${percent(bce, years.length)}）／ 紀元後: ${years.length - bce} 件（${percent(years.length - bce, years.length)}）。比は 1 : ${bce === 0 ? "–" : ((years.length - bce) / bce).toFixed(1)}`,
    `- 1900年以降: ${after1900} 件（${percent(after1900, years.length)}）`,
    "",
    "### 1501年以降を100年刻みにしたもの",
    "",
    mdTable(["年代", "件数", "全体に対する割合"], centuryRows),
    "",
    "### 地域 × 年代（写像済み）",
    "",
    mdTable(["地域", ...COARSE_ERAS], cross),
  ].join("\n");
};

/** @param {readonly AnyItem[]} inRange @param {readonly Item[]} mapped */
const sectionDomains = (inRange, mapped) => {
  const domainOf = (/** @type {Item} */ i) => (i.classification.status === "mapped" ? i.classification.domain : "");
  const rows = DOMAINS.map((d) => {
    const n = mapped.filter((i) => domainOf(i) === d).length;
    return [`${DOMAIN_LABELS[d]}（${d}）`, n, percent(n, mapped.length)];
  });
  const status = countBy(inRange, (i) => i.classification.status);
  const multi = mapped.filter((i) => i.classification.status === "mapped" && i.classification.tags.length > 1);
  const pairs = countBy(multi, (i) => (i.classification.status === "mapped" ? i.classification.tags.join(" + ") : ""));
  const multiP31 = inRange.filter((i) => i.p31.length > 1).length;
  return [
    "## c) 分類別の件数（7分類）",
    "",
    mdTable(["分類", "件数", "割合"], rows),
    "",
    `- 表示範囲内の取得項目 ${inRange.length} 件のうち、写像済み ${status.get("mapped") ?? 0} 件、写像漏れ ${status.get("unmapped") ?? 0} 件、対象外（exclude）${status.get("excluded") ?? 0} 件。`,
    `- P31 を2つ以上持つ項目は ${multiP31} 件（${percent(multiP31, inRange.length)}）。そのうち、写像した結果が複数の分類にまたがったのは ${multi.length} 件（写像済みの ${percent(multi.length, mapped.length)}）。`,
    `- 主分類を決める優先順: ${DOMAIN_PRIORITY.join(" > ")}（理由は p31-domain-map.mjs）。`,
    "",
    "### 複数の分類にまたがった組み合わせ（先頭が主分類）",
    "",
    mdTable(["tags", "件数"], [...pairs.entries()].slice(0, 15)),
  ].join("\n");
};

const SITELINK_BINS = [0, 1, 2, 5, 10, 20, 50, 100];

/** @param {readonly Item[]} mapped */
const sectionSitelinks = (mapped) => {
  const all = mapped.map((i) => i.sitelinks);
  const hist = histogram(all, SITELINK_BINS);
  const maxCount = Math.max(...hist.map((h) => h.count));
  const histRows = hist.map((h) => [
    h.to === null ? `${h.from} 以上` : h.to - h.from === 1 ? String(h.from) : `${h.from}〜${h.to - 1}`,
    h.count,
    percent(h.count, all.length),
    "█".repeat(Math.round((h.count / maxCount) * 40)),
  ]);
  /** @param {readonly Item[]} items @param {string} name */
  const summaryRow = (items, name) => {
    const s = summarize(items.map((i) => i.sitelinks));
    const over20 = items.filter((i) => i.sitelinks >= 20).length;
    return [name, s.n, fmt(s.q1), fmt(s.median), fmt(s.q3), fmt(s.p90), fmt(s.max), percent(over20, s.n)];
  };
  const header = ["地域", "件数", "Q1", "中央値", "Q3", "90%点", "最大", "20以上の割合"];
  const byRegion = [summaryRow(mapped, "**全体**"), ...REGION_KEYS.map((r) => summaryRow(mapped.filter((i) => i.region === r), regionLabel(r)))];
  const before1900 = mapped.filter((i) => /** @type {any} */ (i.start).year < 1900);
  const byRegionBefore1900 = [summaryRow(before1900, "**全体**"), ...REGION_KEYS.map((r) => summaryRow(before1900.filter((i) => i.region === r), regionLabel(r)))];
  const conflict = mapped.filter((i) => i.classification.status === "mapped" && i.classification.domain === "conflict");
  const byRegionConflict = REGION_KEYS.map((r) => summaryRow(conflict.filter((i) => i.region === r), regionLabel(r)));
  const byEra = COARSE_ERAS.map((e) => summaryRow(mapped.filter((i) => coarseEra(/** @type {any} */ (i.start).year) === e), e));
  const byDomain = DOMAINS.map((d) => summaryRow(mapped.filter((i) => i.classification.status === "mapped" && i.classification.domain === d), DOMAIN_LABELS[d]));
  return [
    "## d) sitelinks の分布",
    "",
    "sitelinks は `wikibase:sitelinks` の値。Wikipedia の各言語版だけでなく、Wikimedia Commons・Wikiquote・Wikisource などへのリンクも含む数である。",
    "",
    "### 全体のヒストグラム（写像済み）",
    "",
    mdTable(["sitelinks", "件数", "割合", ""], histRows, ["l", "r", "r", "l"]),
    "",
    "### 地域別の四分位数（写像済み）",
    "",
    "分位点は線形補間（R の type 7）。",
    "",
    mdTable(header, byRegion),
    "",
    "### 地域別の四分位数（開始年が1899年以前の項目に絞った場合）",
    "",
    "地域によって年代の構成が大きく違う（b の「地域 × 年代」）ので、近現代を除いて比べたもの。",
    "",
    mdTable(header, byRegionBefore1900),
    "",
    "### 地域別の四分位数（紛争だけに絞った場合）",
    "",
    "地域によって分類の構成が違うので、最も件数の多い「紛争」だけで比べたもの。",
    "",
    mdTable(header, byRegionConflict),
    "",
    "### 年代別・分類別の四分位数（写像済み）",
    "",
    mdTable(["年代", ...header.slice(1)], byEra),
    "",
    mdTable(["分類", ...header.slice(1)], byDomain),
  ].join("\n");
};

/**
 * @param {readonly Item[]} mapped
 * @param {readonly any[]} manual
 * @param {readonly AnyItem[]} allItems
 * @param {readonly import("./regions.mjs").CountryPolygon[]} countryIndex
 * @param {readonly import("./analyze.mjs").ListRecord[]} listRecords
 */
const sectionManual = (mapped, manual, allItems, countryIndex, listRecords) => {
  // src/data/events.sample.ts の places（2026-09-20 に転記）。Wikidata に座標が無い項目の地域判定に使う。
  const samplePlaces = /** @type {Record<string, { lon: number, lat: number }>} */ ({
    Q28573: { lon: -71.97, lat: -13.53 },
    Q9141: { lon: 78.04, lat: 27.18 },
    Q1545405: { lon: 175.5, lat: -38.5 },
    Q705553: { lon: 38.9, lat: -8.5 },
  });
  const rows = manual.map((m) => {
    const inPopulation = mapped.find((i) => i.qid === m.qid);
    const known = allItems.find((i) => i.qid === m.qid);
    const listed = listRecords.find((r) => r.qid === m.qid);
    const hasTime = m.P585.length + m.P580.length + m.P582.length > 0;
    const how = inPopulation
      ? `取得できた（場所: ${inPopulation.places[0].via}、分類: ${inPopulation.classification.by === "list" ? "リストの節" : "P31"}${inPopulation.vital ? "、Vital articles" : ""}）`
      : known
        ? [known.places.length === 0 ? "座標が付かない" : "", known.classification.status !== "mapped" ? `分類が ${known.classification.status}` : ""].filter(Boolean).join("、")
        : listed
          ? `リスト（${listed.source}）にはあるが、${listed.reasons.join("、")}。missing.json に入っている`
          : [!m.hasCoord ? "P625（座標）が無い" : "", !hasTime ? "P585/P580/P582 が無い" : ""].filter(Boolean).join("、") ||
            "どのルート・リストからも取れない";
    const region = inPopulation?.region ?? regionOf(countryIndex, samplePlaces[m.qid]).region;
    const rank = 1 + mapped.filter((i) => i.sitelinks > m.sitelinks).length;
    const inRegion = mapped.filter((i) => i.region === region);
    const regionRank = 1 + inRegion.filter((i) => i.sitelinks > m.sitelinks).length;
    return [
      `${m.name}（${m.qid}）`,
      m.sitelinks,
      inPopulation ? "○" : "×",
      how,
      inPopulation ? inPopulation.importance : "–",
      `${rank} 位 / ${mapped.length}（上位 ${percent(rank, mapped.length)}）`,
      `${regionLabel(region)}で ${regionRank} 位 / ${inRegion.length}`,
    ];
  });
  return [
    "## e) R3a で手動追加した4件",
    "",
    "順位は「母集団の項目を sitelinks の多い順に並べたとき、この sitelinks 数なら何位に入るか」（同数は同順位）。取得できなかった項目も、仮に取得できていた場合の順位として出している。",
    "",
    mdTable(["項目", "sitelinks", "取得", "経路・理由", "importance", "全体での順位", "地域内での順位"], rows, ["l", "r", "l", "l", "r", "l", "l"]),
  ].join("\n");
};

/** @param {readonly Item[]} mapped */
const sectionTop = (mapped) => {
  const sorted = [...mapped].sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid));
  const tops = [100, 500, 1000, 5000].filter((n) => n <= sorted.length);
  const rows = REGION_KEYS.map((r) => [
    regionLabel(r),
    ...tops.flatMap((n) => {
      const c = sorted.slice(0, n).filter((i) => i.region === r).length;
      return [c, percent(c, n)];
    }),
    percent(mapped.filter((i) => i.region === r).length, mapped.length),
  ]);
  const domainRows = DOMAINS.map((d) => [
    DOMAIN_LABELS[d],
    ...tops.map((n) => sorted.slice(0, n).filter((i) => i.classification.status === "mapped" && i.classification.domain === d).length),
  ]);
  const eraRows = COARSE_ERAS.map((e) => [e, ...tops.map((n) => sorted.slice(0, n).filter((i) => coarseEra(/** @type {any} */ (i.start).year) === e).length)]);
  const list = sorted.slice(0, 100).map((i, idx) => [
    idx + 1,
    `[${i.label}](https://www.wikidata.org/wiki/${i.qid})`,
    formatYear(/** @type {any} */ (i.start).year),
    regionLabel(i.region),
    i.classification.status === "mapped" ? DOMAIN_LABELS[i.classification.domain] : "",
    i.sitelinks,
  ]);
  return [
    "## f) sitelinks 上位の地域別内訳",
    "",
    mdTable(["地域", ...tops.flatMap((n) => [`上位${n}`, "割合"]), "（参考）全体での割合"], rows),
    "",
    `上位100件に入る最小の sitelinks は ${sorted[Math.min(99, sorted.length - 1)]?.sitelinks}。`,
    "",
    "### 上位 N 件の分類別・年代別内訳",
    "",
    mdTable(["分類", ...tops.map((n) => `上位${n}`)], domainRows),
    "",
    mdTable(["年代", ...tops.map((n) => `上位${n}`)], eraRows),
    "",
    "### 上位100件の一覧",
    "",
    mdTable(["順位", "項目", "開始年", "地域", "分類", "sitelinks"], list, ["r", "l", "r", "l", "l", "r"]),
  ].join("\n");
};

/**
 * @param {readonly AnyItem[]} inRange
 * @param {Record<string, { ja?: string, en?: string }>} classLabels
 */
const sectionUnmapped = (inRange, classLabels) => {
  const candidates = inRange.filter((i) => i.classification.status !== "excluded");
  const occurrences = candidates.flatMap((i) => i.p31.filter((q) => !isMappedClass(q)).map((q) => ({ q, item: i })));
  const groups = [...Map.groupBy(occurrences, (o) => o.q).entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const rows = groups.slice(0, 50).map(([q, os], idx) => {
    const onlyUnmapped = os.filter((o) => o.item.classification.status === "unmapped").length;
    const example = [...os].sort((a, b) => b.item.sitelinks - a.item.sitelinks)[0].item;
    const l = classLabels[q] ?? {};
    return [idx + 1, `[${q}](https://www.wikidata.org/wiki/${q})`, l.en ?? "", l.ja ?? "", os.length, onlyUnmapped, `${example.label}（${example.sitelinks}）`];
  });
  const noP31 = candidates.filter((i) => i.p31.length === 0).length;
  return [
    "## 写像漏れの P31（出現回数の上位50）",
    "",
    "- 「出現回数」は、その P31 を持つ項目の数（対象外の項目は除く）。",
    "- 「うち未分類」は、そのうち他の P31 でも写像できず、どの分類にも入らなかった項目の数。ここが大きい P31 から写像表に足すと効く。",
    `- 表に無い P31 は全部で ${groups.length} 種類。P31 を1つも持たない項目は ${noP31} 件。`,
    "",
    mdTable(["#", "P31", "en", "ja", "出現回数", "うち未分類", "例（sitelinks 最多の項目）"], rows, ["r", "l", "l", "l", "r", "r", "l"]),
  ].join("\n");
};

/**
 * @param {readonly AnyItem[]} allItems
 * @param {readonly Item[]} mapped
 */
const sectionQuality = (allItems, mapped) => {
  const PRECISION_LABELS = /** @type {Record<number, string>} */ ({ 6: "千年紀", 7: "世紀", 8: "10年", 9: "年", 10: "月", 11: "日" });
  const precision = countBy(mapped, (i) => String(/** @type {any} */ (i.start).precision));
  const precisionRows = [...precision.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([p, n]) => [`${p}（${PRECISION_LABELS[Number(p)] ?? "その他"}）`, n, percent(n, mapped.length)]);
  const endOnly = mapped.filter((i) => i.start?.source === "P582").length;
  const reversed = mapped.filter((i) => i.end !== null && i.start !== null && i.end < i.start.year).length;
  const disagree = mapped.filter((i) => i.times.P585.length > 0 && i.times.P580.length > 0 && i.times.P585[0].year !== i.times.P580[0].year).length;
  const multiTime = mapped.filter((i) => i.times.P585.length > 1 || i.times.P580.length > 1).length;
  const multiCoord = mapped.filter((i) => i.coords.length > 1).length;
  const isRound = (/** @type {number} */ x) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-9;
  const roundCoord = mapped.filter((i) => isRound(i.coords[0].lon) && isRound(i.coords[0].lat)).length;
  const coordGroups = [...Map.groupBy(mapped, (i) => `${i.coords[0].lat},${i.coords[0].lon}`).entries()]
    .filter(([, g]) => g.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  const sharedCoordItems = coordGroups.reduce((s, [, g]) => s + g.length, 0);
  const coordRows = coordGroups.slice(0, 10).map(([c, g]) => [c, g.length, g[0].country ?? "", g.slice(0, 3).map((i) => i.label).join("、")]);
  const dupGroups = [...Map.groupBy(mapped, (i) => `${i.coords[0].lat},${i.coords[0].lon}|${i.start?.year}`).entries()].filter(([, g]) => g.length > 1);
  const dupRows = dupGroups
    .sort((a, b) => Math.max(...b[1].map((i) => i.sitelinks)) - Math.max(...a[1].map((i) => i.sitelinks)))
    .slice(0, 10)
    .map(([, g]) => [formatYear(/** @type {any} */ (g[0].start).year), g.map((i) => `${i.label}（${i.qid}, ${i.sitelinks}）`).join(" ／ ")]);
  const jaRows = REGION_KEYS.map((r) => {
    const m = mapped.filter((i) => i.region === r);
    const top = [...m].sort((a, b) => b.sitelinks - a.sitelinks).slice(0, 100);
    return [regionLabel(r), m.length, percent(m.filter((i) => i.labels.ja).length, m.length), percent(top.filter((i) => i.labels.ja).length, top.length)];
  });
  const noLabel = mapped.filter((i) => !i.labels.ja && !i.labels.en).length;
  const outOfRange = allItems.filter((i) => !i.inAppRange).length;
  const excluded = allItems.filter((i) => i.inAppRange && i.classification.status === "excluded");
  const excludedBy = countBy(
    excluded.flatMap((i) => i.p31.filter((q) => P31_DOMAIN_MAP.some((e) => e.qid === q && e.domain === "exclude"))),
    (q) => q,
  );
  const excludedRows = [...excludedBy.entries()].map(([q, n]) => [q, P31_DOMAIN_MAP.find((e) => e.qid === q)?.label ?? "", n]);
  return [
    "## データの質に関する計測",
    "",
    "### 年",
    "",
    mdTable(["開始年の精度（wikibase:timePrecision）", "件数", "割合"], precisionRows),
    "",
    `- 精度が「世紀」以下の項目は、年の値が区間の代表値でしかない（例: 5世紀 → 401 や 500）。`,
    `- 終了年（P582）しか無く、それを開始年として使った項目: ${endOnly} 件`,
    `- 終了年が開始年より前になっている項目: ${reversed} 件`,
    `- P585 と P580 の両方があり、年が食い違う項目: ${disagree} 件`,
    `- P585 または P580 を複数持つ項目（最小の年を採用）: ${multiTime} 件`,
    `- 開始年がアプリの表示範囲（${formatYear(APP_YEAR_MIN)}〜${APP_YEAR_MAX}）の外で、母集団から除いた項目: ${outOfRange} 件`,
    "",
    "### 座標",
    "",
    `- 座標を複数持つ項目（1つめを採用）: ${multiCoord} 件`,
    `- 経度・緯度がともに 0.1 度単位ちょうどの項目（手入力の概略値の疑い）: ${roundCoord} 件（${percent(roundCoord, mapped.length)}）`,
    `- 他の項目とまったく同じ座標を持つ項目: ${sharedCoordItems} 件（${percent(sharedCoordItems, mapped.length)}）、${coordGroups.length} か所。都市や国の代表点をそのまま使っている疑いがある。`,
    "",
    mdTable(["座標（lat,lon）", "項目数", "国", "例"], coordRows, ["l", "r", "l", "l"]),
    "",
    "### 重複の疑い（同じ座標・同じ開始年の項目）",
    "",
    `${dupGroups.length} 組。sitelinks の多い順に10組:`,
    "",
    mdTable(["開始年", "項目"], dupRows, ["r", "l"]),
    "",
    "### ラベル",
    "",
    `日本語ラベルの有無（アプリの表示言語は日本語）。日本語も英語もラベルが無い項目は ${noLabel} 件。`,
    "",
    mdTable(["地域", "件数", "ja ラベルあり", "地域内 sitelinks 上位100件での ja ラベルあり"], jaRows),
    "",
    "### 対象外（exclude）にした項目",
    "",
    "件数は、7分類のどれにも当たらず対象外になった項目のうち、その P31 を持つものの数。",
    "",
    excludedRows.length > 0 ? mdTable(["P31", "label", "件数"], excludedRows, ["l", "l", "r"]) : "なし",
  ].join("\n");
};

/**
 * @param {readonly any[]} log
 * @param {Record<string, any>} coordLoss
 * @param {readonly AnyItem[]} allItems
 */
const sectionFetch = (log, coordLoss, allItems) => {
  const ok = log.filter((c) => c.status === "ok");
  const timeouts = log.filter((c) => c.status === "timeout");
  const failed = log.filter((c) => c.status === "error" || (c.status === "timeout" && c.slice && c.slice.to - c.slice.from <= 1));
  const dates = ok.map((c) => c.fetchedAt).sort();
  const perRoot = ROOTS.map((r) => {
    const chunks = log.filter((c) => c.rootQid === r.qid);
    const n = allItems.filter((i) => i.roots.includes(r.qid)).length;
    const loss = coordLoss[r.qid];
    const counted = loss && typeof loss.withTime === "number";
    return [
      `${r.label}（${r.qid}）${r.subclasses ? "" : " ※直接の P31 のみ"}`,
      chunks.filter((c) => c.status === "ok").length,
      chunks.filter((c) => c.status === "timeout").length,
      n,
      counted ? loss.withTime : loss ? `（${loss.status}）` : "（未計測）",
      counted ? percent(loss.withTime - loss.withCoord, loss.withTime) : "–",
      counted ? loss.viaLocation : "–",
    ];
  });
  const total = Object.values(coordLoss).filter((l) => typeof l.withTime === "number");
  return [
    "## 取得の概要",
    "",
    `- 取得日時（UTC）: ${dates[0] ?? "–"} 〜 ${dates[dates.length - 1] ?? "–"}`,
    `- ルート ${ROOTS.length} 個、成功したクエリ ${ok.length} 回、タイムアウトして年代で分割したクエリ ${timeouts.length} 回、取得を諦めたチャンク ${failed.length} 個`,
    `- P31 ベースで取得できた項目（年あり。ルート間の重複を除く。戦争のルートは座標の無い項目も含む）: **${allItems.filter((i) => i.fromP31).length} 件**`,
    `- 選抜リストだけから来た項目（年・場所あり）: ${allItems.filter((i) => !i.fromP31).length} 件。合わせて ${allItems.length} 件`,
    "- 取得日時の幅が広いのは、R4a で取得したチャンク（P625 必須のルート）を再利用しているため。戦争・会戦のルートと選抜リストは R4b-1 で取得した。",
    "",
    "### ルート別の件数と、座標が無くて落ちた割合",
    "",
    "「年あり」は P585/P580/P582 のどれかを持つ項目数（座標の有無を問わない）。「座標なしで脱落」はそのうち P625 を持たない割合。",
    "戦争のルート（war / rebellion / civil war / revolution）は R4b-1 から座標を必須にしていないので、「取得項目数」には座標の無い項目も含む。",
    "「P276 経由で救える数」は、P625 は無いが P276（場所）の先の項目に P625 がある数。ルート同士は重なっているので、列の合計に意味は無い。",
    "",
    mdTable(["ルート", "成功", "分割", "取得項目数", "年あり", "座標なしで脱落", "P276 経由で救える数"], perRoot),
    "",
    total.length > 0
      ? `（参考）計測できた ${total.length} ルートの単純合計では、年あり ${total.reduce((s, l) => s + l.withTime, 0)} に対し座標あり ${total.reduce((s, l) => s + l.withCoord, 0)}。`
      : "",
    failed.length > 0 ? `\n取得を諦めたチャンク: ${failed.map((c) => `${c.rootQid} [${c.slice ? `${c.slice.from}_${c.slice.to}` : "all"}] ${c.status}`).join("、")}` : "",
  ].join("\n");
};

// ── メイン ────────────────────────────────────────────────

/** @type {readonly RawItem[]} */
const rawItems = await readJson(EVENTS_PATH);
const [classLabels, coordLoss, manual, log, countries, outsideParents, titles, attrs, populated] = await Promise.all([
  readJson(CLASS_LABELS_PATH),
  readJson(COORD_LOSS_PATH),
  readJson(MANUAL_ITEMS_PATH),
  readJson(FETCH_LOG_PATH),
  loadCountries(),
  readJsonOr(PARENTS_PATH, {}),
  readJsonOr(LIST_TITLES_PATH, {}),
  readJsonOr(LIST_ATTRS_PATH, {}),
  readJsonOr(LIST_POPULATED_PATH, {}),
]);

// 選抜リスト: 保存済みのページ → 項目 → QID・属性を引き当てる
const vitalPages = (
  await Promise.all(VITAL_PAGES.map(async (cfg) => ({ cfg, page: await readJsonOr(pageFile(vitalPageTitle(cfg)), null) })))
).filter((p) => p.page !== null);
const timelinePages = (
  await Promise.all(TIMELINE_PAGES.map(async (cfg) => ({ cfg, page: await readJsonOr(pageFile(cfg.page), null) })))
).filter((p) => p.page !== null);
const listRecords = [
  ...vitalPages.flatMap(({ cfg, page }) =>
    vitalEntries(cfg, page.wikitext).map((e) => {
      const qid = titles[e.title]?.qid ?? null;
      return listRecord({ source: e.source, domain: e.domain, title: e.title, listKind: "vital", level: e.level }, qid, qid ? attrs[qid] : undefined);
    }),
  ),
  ...timelinePages.flatMap(({ cfg, page }) =>
    timelineEntries(cfg, page.wikitext).map((e) => {
      const subject = timelineSubject(e, titles, attrs, populated);
      return listRecord(
        { source: e.source, domain: e.domain, title: subject?.title ?? e.links[0], listKind: "timeline", yearLabel: e.yearLabel, text: e.text },
        subject?.qid ?? null,
        subject ? attrs[subject.qid] : undefined,
      );
    }),
  ),
];
const listRevisions = [...vitalPages, ...timelinePages].map(({ page }) => `${page.page}（rev ${page.revid}）`);

const countryIndex = buildCountryIndex(countries);
const { all: allItems, population: mapped, thresholds } = buildItems({ rawItems, outsideParents, listRecords, countryIndex });
const inRange = allItems.filter((i) => i.inAppRange && i.places.length > 0);

const report = [
  "# Wikidata 取得結果の分布レポート（R4b-1）",
  "",
  "> このファイルは `pnpm wikidata:report`（scripts/wikidata/report.mjs）が自動生成する。手で編集しない。",
  "> 数値の出所はすべて、`pnpm wikidata:fetch` と `pnpm wikidata:fetch-lists` が data/raw/ に保存した取得結果（コミット対象外）。",
  "> 数値の読み方と所見は [FINDINGS.md](FINDINGS.md)。R4a 時点のレポートは [REPORT-R4a.md](REPORT-R4a.md)。",
  "",
  "母集団は「開始年がアプリの表示範囲内にあり、座標が1つ以上あり、7分類のどれかに入った項目」。以降、断りが無ければこの母集団で数える。",
  "",
  sectionFetch(log, coordLoss, allItems),
  "",
  sectionComparison(mapped),
  "",
  sectionConflict(allItems, mapped),
  "",
  sectionLists(listRecords, mapped),
  "",
  sectionImportance(mapped, thresholds),
  "",
  "# 全体の分布（R4a と同じ集計を、新しい母集団で）",
  "",
  sectionRegions(mapped, inRange),
  "",
  sectionEras(mapped),
  "",
  sectionDomains(inRange, mapped),
  "",
  sectionSitelinks(mapped),
  "",
  sectionManual(mapped, manual, allItems, countryIndex, listRecords),
  "",
  sectionTop(mapped),
  "",
  sectionUnmapped(inRange.filter((i) => i.fromP31), classLabels),
  "",
  sectionQuality(allItems, mapped),
  "",
  "## 出典リストの版",
  "",
  "英語版 Wikipedia（CC BY-SA 4.0）。取得した版:",
  "",
  ...listRevisions.map((r) => `- ${r}`),
  "",
].join("\n");

await writeFile(REPORT_PATH, report);
await writeFile(LIST_MISSING_PATH, JSON.stringify(missingRecords(listRecords), null, 1));
console.log(
  `${allItems.length} 件（母集団 ${mapped.length}、うち R4a 条件 ${r4aSubset(mapped).length}）→ ${REPORT_PATH}\n` +
    `年か場所が取れなかったリスト項目 ${missingRecords(listRecords).length} 件 → ${LIST_MISSING_PATH}`,
);
