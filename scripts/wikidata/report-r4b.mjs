// R4b-1 で追加した節（紛争の構造・選抜リスト・importance・R4a 条件との比較）。純粋関数のみ（項目の列 → Markdown）。
import { LIST_PLACE_PROPS_SPEC, LIST_TIME_PROPS_SPEC, VITAL_PAGES } from "./lists.mjs";
import {
  COARSE_ERAS,
  DOMAINS,
  DOMAIN_LABELS,
  REGION_KEYS,
  coarseEra,
  formatYear,
  regionLabel,
  yearOf,
} from "./report-common.mjs";
import { countBy, fmt, mdTable, percent, summarize } from "./stats.mjs";

/** @typedef {import("./analyze.mjs").Item} Item */
/** @typedef {import("./analyze.mjs").AnyItem} AnyItem */
/** @typedef {import("./analyze.mjs").ListRecord} ListRecord */

/** @param {Item} i */
const domainOf = (i) => (i.classification.status === "mapped" ? i.classification.domain : null);

/** @param {string} qid @param {string} label */
const wdLink = (qid, label) => `[${label}](https://www.wikidata.org/wiki/${qid})`;

// ── R4a 条件との比較 ────────────────────────────────────────

/**
 * 「R4a 条件」は、今回のデータのうち R4a の取得条件（自前の P625 を持ち、P31 の写像表で分類できた）を満たす項目。
 * R4a のレポートの数値そのものではなく、同じ日のデータで条件だけを変えた比較にするため、ここで数え直す。
 * @param {readonly Item[]} population
 */
export const r4aSubset = (population) =>
  population.filter((i) => i.fromP31 && i.places[0].via === "P625" && i.classification.by === "p31");

/** @param {readonly Item[]} population */
export const sectionComparison = (population) => {
  const before = r4aSubset(population);
  /** @param {readonly Item[]} items @param {(i: Item) => boolean} pred */
  const share = (items, pred) => percent(items.filter(pred).length, items.length);
  /** @param {readonly Item[]} items */
  const top100 = (items) => [...items].sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid)).slice(0, 100);
  /** @param {string} name @param {(i: Item) => boolean} pred */
  const row = (name, pred) => [
    name,
    before.filter(pred).length,
    share(before, pred),
    population.filter(pred).length,
    share(population, pred),
    top100(before).filter(pred).length,
    top100(population).filter(pred).length,
  ];
  const header = ["", "R4a 条件: 件数", "割合", "R4b-1: 件数", "割合", "R4a 条件: 上位100", "R4b-1: 上位100"];
  return [
    "## R4a の取得条件との比較",
    "",
    "「R4a 条件」は、今回取得したデータのうち、R4a の条件（項目自身が P625 を持ち、P31 の写像表で分類できた）を満たす項目だけで数え直したもの。",
    "「R4b-1」は、それに P276 経由の戦争と、選抜リスト由来の項目を足した全体。上位100 は sitelinks 順。",
    "",
    `- 母集団: R4a 条件 ${before.length} 件 → R4b-1 ${population.length} 件`,
    "",
    mdTable(header, DOMAINS.map((d) => row(DOMAIN_LABELS[d], (i) => domainOf(i) === d))),
    "",
    mdTable(header, REGION_KEYS.map((r) => row(regionLabel(r), (i) => i.region === r))),
    "",
    mdTable(header, COARSE_ERAS.map((e) => row(e, (i) => coarseEra(yearOf(i)) === e))),
  ].join("\n");
};

// ── 1. 紛争: 戦争を主、会戦を従 ─────────────────────────────

/**
 * @param {readonly AnyItem[]} all
 * @param {readonly Item[]} population
 */
export const sectionConflict = (all, population) => {
  const wars = all.filter((i) => i.kind === "war" && i.inAppRange);
  const withPlace = wars.filter((i) => i.places.length > 0);
  const viaP276 = wars.filter((i) => i.places.some((p) => p.via === "P276"));
  const ownOnly = wars.filter((i) => i.places.length > 0 && i.places.every((p) => p.via === "P625"));
  const multi = viaP276.filter((i) => i.places.length > 1);
  const warsInPopulation = population.filter((i) => i.kind === "war");

  const engagements = population.filter((i) => i.kind === "engagement");
  const withP361 = engagements.filter((i) => i.parents.length > 0);
  const withWar = engagements.filter((i) => i.parentWar !== null);
  const byWar = countBy(withWar, (i) => /** @type {string} */ (i.parentWar));
  const counts = [...byWar.values()];
  const s = summarize(counts);
  const labelOf = new Map(all.map((i) => [i.qid, i]));
  const top = [...byWar.entries()].slice(0, 10).map(([qid, n], idx) => {
    const war = labelOf.get(qid);
    return [
      idx + 1,
      wdLink(qid, war?.label ?? qid),
      war?.start ? formatYear(war.start.year) : "–",
      n,
      war?.sitelinks ?? "–",
      war ? (war.places.length > 0 ? `${regionLabel(war.region)}（${war.places.length} か所）` : "座標なし") : "取得項目の外",
    ];
  });
  const sizeBins = [1, 2, 5, 10, 20, 50, 100];
  const sizeRows = sizeBins.map((from, i) => {
    const to = sizeBins[i + 1] ?? null;
    const n = counts.filter((c) => c >= from && (to === null || c < to)).length;
    return [to === null ? `${from} 以上` : to - from === 1 ? String(from) : `${from}〜${to - 1}`, n];
  });
  const warsWithBattles = wars.filter((i) => byWar.has(i.qid)).length;
  const warRegion = REGION_KEYS.map((r) => {
    const w = warsInPopulation.filter((i) => i.region === r).length;
    const e = engagements.filter((i) => i.region === r).length;
    return [regionLabel(r), w, percent(w, warsInPopulation.length), e, percent(e, engagements.length)];
  });
  return [
    "## 1. 紛争: 戦争を主、会戦を従にした結果",
    "",
    "「戦争」は war / civil war / rebellion / revolution のルート（下位クラスを含む）から取れた項目、「会戦」は battle / siege / military operation のルートから取れた項目。",
    "両方から取れた項目は戦争として数える。件数は、開始年がアプリの表示範囲内のもの。",
    "",
    "### 戦争の件数と、座標が付いた割合",
    "",
    mdTable(
      ["", "件数", "戦争に占める割合"],
      [
        ["戦争（年あり）", wars.length, "100.0%"],
        ["座標が付いた", withPlace.length, percent(withPlace.length, wars.length)],
        ["　うち P276（場所）経由", viaP276.length, percent(viaP276.length, wars.length)],
        ["　　うち places が複数", multi.length, percent(multi.length, wars.length)],
        ["　うち P276 に座標が無く、自前の P625 を使った", ownOnly.length, percent(ownOnly.length, wars.length)],
        ["座標が付かなかった", wars.length - withPlace.length, percent(wars.length - withPlace.length, wars.length)],
        ["（参考）7分類に写像でき、母集団に入った戦争", warsInPopulation.length, percent(warsInPopulation.length, wars.length)],
      ],
    ),
    "",
    "### 会戦のうち、P361 で戦争に紐づく割合",
    "",
    "「親の戦争が見つかった」は、P361 を最大 4 段辿って（会戦 → 方面作戦・戦線 → 戦争）、戦争のルートの項目に行き着いたもの。",
    "",
    mdTable(
      ["", "件数", "会戦に占める割合"],
      [
        ["会戦（母集団）", engagements.length, "100.0%"],
        ["P361 を持つ", withP361.length, percent(withP361.length, engagements.length)],
        ["　うち親の戦争が見つかった", withWar.length, percent(withWar.length, engagements.length)],
        ["　うち P361 はあるが、戦争に行き着かない", withP361.length - withWar.length, percent(withP361.length - withWar.length, engagements.length)],
        ["P361 が無い", engagements.length - withP361.length, percent(engagements.length - withP361.length, engagements.length)],
      ],
    ),
    "",
    "### 戦争1件あたりの会戦数",
    "",
    `会戦が1件以上紐づいた戦争は ${byWar.size} 件（うち今回取得した戦争の項目に含まれるのは ${warsWithBattles} 件。残りは年を持たないなどで取得項目の外にある戦争）。`,
    `会戦数の分布: 中央値 ${fmt(s.median)}、Q3 ${fmt(s.q3)}、90%点 ${fmt(s.p90)}、最大 ${fmt(s.max)}。`,
    "",
    mdTable(["会戦数", "戦争の数"], sizeRows),
    "",
    mdTable(["#", "戦争", "開始年", "会戦数", "戦争の sitelinks", "戦争の場所"], top, ["r", "l", "r", "r", "r", "l"]),
    "",
    "### 戦争と会戦の地域別件数（母集団）",
    "",
    mdTable(["地域", "戦争", "割合", "会戦", "割合"], warRegion),
  ].join("\n");
};

// ── 2. 選抜リスト ───────────────────────────────────────────

/**
 * @param {readonly ListRecord[]} records
 * @param {readonly Item[]} population
 */
export const sectionLists = (records, population) => {
  const sources = VITAL_PAGES.map((p) => p.page);
  /** @param {readonly ListRecord[]} rs @param {string} name */
  const row = (rs, name) => {
    const n = rs.length;
    const resolved = rs.filter((r) => r.qid && r.attrs);
    const both = resolved.filter((r) => r.start && r.places.length > 0);
    return [
      name,
      n,
      percent(resolved.length, n),
      percent(resolved.filter((r) => r.startSpecOnly).length, n),
      percent(resolved.filter((r) => r.start).length, n),
      percent(resolved.filter((r) => r.placesSpecOnly.length > 0).length, n),
      percent(resolved.filter((r) => r.places.length > 0).length, n),
      both.length,
      percent(both.length, n),
    ];
  };
  const rows = [...sources.map((src) => row(records.filter((r) => r.source === src), src)), row(records, "**合計（のべ）**")];
  const resolved = records.filter((r) => r.qid && r.attrs);
  const timeVia = countBy(resolved.filter((r) => r.start), (r) => /** @type {any} */ (r.start).source);
  const placeVia = countBy(resolved.filter((r) => r.places.length > 0), (r) => r.places[0].via);
  const reasons = countBy(records.flatMap((r) => r.reasons), (x) => x);

  const four = /** @type {const} */ (["science", "technology", "economy", "culture"]);
  const fromLists = population.filter((i) => i.classification.by === "list");
  const domainRows = four.map((d) => {
    const items = fromLists.filter((i) => domainOf(i) === d);
    const s = summarize(items.map((i) => i.sitelinks));
    return [
      DOMAIN_LABELS[d],
      items.length,
      items.filter((i) => i.vital).length,
      items.filter((i) => i.countryLevelPlace).length,
      percent(items.filter((i) => i.countryLevelPlace).length, items.length),
      fmt(s.q1),
      fmt(s.median),
      fmt(s.q3),
    ];
  });
  const regionRows = REGION_KEYS.map((r) => [
    regionLabel(r),
    ...four.flatMap((d) => {
      const items = fromLists.filter((i) => domainOf(i) === d);
      const n = items.filter((i) => i.region === r).length;
      return [n, percent(n, items.length)];
    }),
  ]);
  const eraRows = COARSE_ERAS.map((e) => [
    e,
    ...four.flatMap((d) => {
      const items = fromLists.filter((i) => domainOf(i) === d);
      const n = items.filter((i) => coarseEra(yearOf(i)) === e).length;
      return [n, percent(n, items.length)];
    }),
  ]);
  const history = records.filter((r) => r.domain === null);
  const historyQids = new Set(history.flatMap((r) => (r.qid ? [r.qid] : [])));
  const historyIn = population.filter((i) => historyQids.has(i.qid));
  const examples = four.map((d) => {
    const items = fromLists.filter((i) => domainOf(i) === d).sort((a, b) => b.sitelinks - a.sitelinks);
    return `- ${DOMAIN_LABELS[d]}: ${items.slice(0, 8).map((i) => `${i.label}（${formatYear(yearOf(i))}、${regionLabel(i.region)}、${i.sitelinks}）`).join("、")}`;
  });
  return [
    "## 2. 選抜リスト（英語版 Wikipedia）からの取得",
    "",
    "出典は lists.mjs に列挙した Vital articles Level 5 の各ページ（CC BY-SA 4.0）。年表形式の記事は R4b-2 で出典から外した。",
    "",
    "### 出典リストごとの項目数と取得率",
    "",
    `- 「年（指定）」は ${LIST_TIME_PROPS_SPEC.join("/")}、「場所（指定）」は ${LIST_PLACE_PROPS_SPEC.join("/")} だけを使った場合。「拡張」は P575（発見・発明の時点）・P580、P189（発見地）・P740・P291・P17 を足した場合で、以降の集計は拡張のほうを使う。`,
    "",
    mdTable(
      ["出典", "項目数", "QID 解決", "年（指定）", "年（拡張）", "場所（指定）", "場所（拡張）", "年・場所とも", "割合"],
      rows,
    ),
    "",
    `- 年に使ったプロパティ: ${[...timeVia.entries()].map(([k, n]) => `${k} ${n}`).join("、")}`,
    `- 場所に使ったプロパティ: ${[...placeVia.entries()].map(([k, n]) => `${k} ${n}`).join("、")}（P495・P17 は国の代表点）`,
    `- 取れなかった理由（のべ）: ${[...reasons.entries()].map(([k, n]) => `${k} ${n}`).join("、")}`,
    "- 取れなかった項目は、理由付きで data/raw/lists/missing.json に書き出している（コミット対象外）。",
    "",
    "### 4分類の取得件数",
    "",
    "リストの節で分類が決まり、母集団（年が表示範囲内・場所あり）に入った項目。同じ項目が複数のリストにあれば1件と数える。",
    "",
    mdTable(["分類", "件数", "うち Vital articles", "場所が国単位", "割合", "sitelinks Q1", "中央値", "Q3"], domainRows),
    "",
    "sitelinks 上位の例:",
    "",
    ...examples,
    "",
    "### 4分類の地域別分布",
    "",
    mdTable(["地域", ...four.flatMap((d) => [DOMAIN_LABELS[d], "割合"])], regionRows),
    "",
    "### 4分類の年代別分布",
    "",
    mdTable(["年代", ...four.flatMap((d) => [DOMAIN_LABELS[d], "割合"])], eraRows),
    "",
    "### History のリスト",
    "",
    `History のページは節が地域・時代別で 7分類と対応しないので、分類は P31 の写像表に任せ、「選抜済み」の印（importance の下限 2）だけに使った。`,
    `${history.length} 項目のうち、母集団に入ったのは ${historyIn.length} 件（${percent(historyIn.length, history.length)}）。` +
      `内訳: ${DOMAINS.map((d) => `${DOMAIN_LABELS[d]} ${historyIn.filter((i) => domainOf(i) === d).length}`).join("、")}。`,
  ].join("\n");
};

/**
 * 年か場所が取れなかった項目（手入力の候補）。missing.json に書き出す内容。
 * @param {readonly ListRecord[]} records
 */
export const missingRecords = (records) =>
  records
    .filter((r) => r.reasons.length > 0)
    .map((r) => ({
      source: r.source,
      domain: r.domain,
      title: r.title,
      qid: r.qid,
      label: r.attrs?.labels.ja ?? r.attrs?.labels.en ?? null,
      sitelinks: r.attrs?.sitelinks ?? null,
      vitalLevel: r.level,
      reasons: r.reasons,
      // 取れていた側の値
      year: r.start?.year ?? null,
      place: r.places[0] ? { lon: r.places[0].lon, lat: r.places[0].lat, via: r.places[0].via } : null,
    }))
    .sort((a, b) => (b.sitelinks ?? -1) - (a.sitelinks ?? -1));

// ── 3. importance の試算 ────────────────────────────────────

/**
 * @param {readonly Item[]} population
 * @param {Record<"p31" | "list", Record<string, { n: number, top5: number, top25: number }>>} thresholds 由来別の閾値
 */
export const sectionImportance = (population, thresholds) => {
  const three = population.filter((i) => i.importance === 3);
  const levels = /** @type {const} */ ([3, 2, 1]);
  const levelRows = levels.map((lv) => {
    const items = population.filter((i) => i.importance === lv);
    return [lv, items.length, percent(items.length, population.length), population.filter((i) => i.base === lv).length];
  });
  const capped = population.filter((i) => i.base === 3 && i.importance < 3);
  const raised = population.filter((i) => i.base === 1 && i.importance > 1);
  /** @param {"p31" | "list"} by */
  const thresholdRows = (by) =>
    COARSE_ERAS.map((e) => {
      const t = thresholds[by][e];
      const n3 = three.filter((i) => i.classification.by === by && coarseEra(yearOf(i)) === e).length;
      return [e, t.n, fmt(t.top25), fmt(t.top5), n3, percent(n3, t.n)];
    });
  /** @param {string} name @param {(i: Item) => boolean} pred */
  const breakdown = (name, pred) => {
    const n3 = three.filter(pred).length;
    const all = population.filter(pred).length;
    return [name, n3, percent(n3, three.length), all, percent(all, population.length), percent(n3, all)];
  };
  const header = ["importance 3 の件数", "3 に占める割合", "母集団の件数", "母集団に占める割合", "その区分で 3 になる割合"];
  const top = [...three]
    .sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid))
    .slice(0, 100)
    .map((i, idx) => [
      idx + 1,
      wdLink(i.qid, i.label),
      formatYear(yearOf(i)),
      regionLabel(i.region),
      DOMAIN_LABELS[/** @type {NonNullable<ReturnType<typeof domainOf>>} */ (domainOf(i))],
      i.kind === "war" ? "戦争" : i.kind === "engagement" ? "会戦" : i.classification.by === "list" ? "リスト" : "",
      i.sitelinks,
    ]);
  const cappedTop = [...capped].sort((a, b) => b.sitelinks - a.sitelinks).slice(0, 10);

  // 由来別の sitelinks の水準。出来事の記事と、物・概念・作品・組織の記事とでは、sitelinks の桁が違う
  const origins = /** @type {const} */ ([
    ["会戦", (/** @type {Item} */ i) => i.kind === "engagement" && i.classification.by === "p31"],
    ["戦争", (/** @type {Item} */ i) => i.kind === "war" && i.classification.by === "p31"],
    ["その他の P31 ベースの項目", (/** @type {Item} */ i) => i.kind === "other" && i.classification.by === "p31"],
    ["リストで分類が決まった項目", (/** @type {Item} */ i) => i.classification.by === "list"],
  ]);
  const originRows = origins.map(([name, pred]) => {
    const items = population.filter(pred);
    const q = summarize(items.map((i) => i.sitelinks));
    const n3 = items.filter((i) => i.importance === 3).length;
    return [name, items.length, fmt(q.q1), fmt(q.median), fmt(q.q3), fmt(q.p90), n3, percent(n3, items.length)];
  });

  return [
    "## 3. importance",
    "",
    "規則（importance.mjs）: 年代5区分ごとに sitelinks の上位 5% → 3、上位 25% → 2、それ以外 → 1。会戦は親の戦争が見つかれば上限 2。Vital articles に載っている項目は下限 2。",
    "パーセンタイルは由来別に取る（「P31 で分類した項目」と「Vital articles の節で分類した項目」は別の母集団）。",
    "「上位 5%」は区分内の 95% 点以上として判定する（同じ sitelinks の項目を同じ扱いにするため、5% を少し超えることがある）。",
    "",
    mdTable(["importance", "件数", "割合", "（参考）上限・下限を掛ける前の件数"], levelRows, ["r", "r", "r", "r"]),
    "",
    `- 会戦の上限で 3 → 2 に下がった項目: ${capped.filter((i) => i.kind === "engagement").length} 件。例: ${cappedTop.map((i) => `${i.label}（${i.sitelinks}）`).join("、")}`,
    `- Vital articles の下限で 1 → 2 に上がった項目: ${raised.length} 件`,
    "",
    "### 由来別の sitelinks の水準と、importance 3 になる割合",
    "",
    mdTable(["由来", "件数", "Q1", "中央値", "Q3", "90%点", "importance 3", "割合"], originRows),
    "",
    "### 年代区分ごとの閾値（P31 で分類した項目）",
    "",
    mdTable(["年代", "母集団", "上位 25% の閾値（sitelinks）", "上位 5% の閾値", "importance 3 の件数", "割合"], thresholdRows("p31")),
    "",
    "### 年代区分ごとの閾値（Vital articles の節で分類した項目）",
    "",
    mdTable(["年代", "母集団", "上位 25% の閾値（sitelinks）", "上位 5% の閾値", "importance 3 の件数", "割合"], thresholdRows("list")),
    "",
    `### importance 3 の内訳（${three.length} 件）`,
    "",
    mdTable(["地域", ...header], REGION_KEYS.map((r) => breakdown(regionLabel(r), (i) => i.region === r))),
    "",
    mdTable(["分類", ...header], DOMAINS.map((d) => breakdown(DOMAIN_LABELS[d], (i) => domainOf(i) === d))),
    "",
    mdTable(["年代", ...header], COARSE_ERAS.map((e) => breakdown(e, (i) => coarseEra(yearOf(i)) === e))),
    "",
    mdTable(
      ["種別", ...header],
      [
        breakdown("戦争", (i) => i.kind === "war"),
        breakdown("会戦", (i) => i.kind === "engagement"),
        breakdown("リストで分類が決まった項目", (i) => i.classification.by === "list"),
        breakdown("Vital articles に載っている項目", (i) => i.vital),
      ],
    ),
    "",
    "### importance 3 の上位100件（sitelinks 順）",
    "",
    mdTable(["順位", "項目", "開始年", "地域", "分類", "種別", "sitelinks"], top, ["r", "l", "r", "l", "l", "l", "r"]),
  ].join("\n");
};
