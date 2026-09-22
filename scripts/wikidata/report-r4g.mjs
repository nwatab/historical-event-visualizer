// R4g（調査のみ）: 基準のリスト（A: Vital articles Level 4、B: 地域別の発明・発見の一覧、C: 回帰用）の各項目が、
// パイプラインのどの段階で落ちたかを判定し、レポート scripts/wikidata/REPORT-R4g.md と、落ちた項目の一覧を作る
// （全件は data/raw/r4g/dropped-all.md。コミットするのは、年が表示範囲内にあるのに落ちた項目だけの REPORT-R4g-dropped-dated.md）。
//
//   node scripts/wikidata/fetch-r4g.mjs   # 先に取得（data/raw/r4g/）
//   node scripts/wikidata/report-r4g.mjs
//
// 実際の判定は、いまのパイプラインの結果そのもの（load-analysis.mjs の母集団と、public/data/events/ の生成データ）を見る。
// 修正の効果の見積もりだけは、Wikidata の値から規則をなぞる simulate（r4g-survey.mjs）を使う。
// 2 つのファイルは自動生成なので手で編集しない。読み方・所見・案は FINDINGS-R4g.md に手で書く。src/ と public/data/ は変えない。
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_YEAR_MAX, APP_YEAR_MIN, CLASS_LABELS_PATH, DIFFUSION_DIR } from "./config.mjs";
import { classify } from "./classify.mjs";
import { loadAnalysis, readJsonOr } from "./load-analysis.mjs";
import { importFromSrc, loadSampleEvents } from "./load-ts.mjs";
import { LIST_PLACE_PROPS, LIST_TIME_PROPS, WORK_CLASSES } from "./lists.mjs";
import {
  R4G_ATTRS_PATH,
  R4G_DROPPED_ALL_PATH,
  R4G_DROPPED_DATED_PATH,
  R4G_LABELS_PATH,
  R4G_PLACE_CLASSES_PATH,
  R4G_REPORT_PATH,
  R4G_ROOTS_PATH,
  R4G_TITLES_PATH,
  REF_A_PAGES,
  REF_B_PAGES,
  REF_C_ITEMS,
  STAGES,
  STAGE_LABELS,
  pickSubject,
  placeSummary,
  r4gPageFile,
  refAEntries,
  refBEntries,
  simulate,
  timePropsSummary,
} from "./r4g-survey.mjs";
import { REGIONS, regionOf } from "./regions.mjs";
import { eraLabel, eraOf, formatYear, regionLabel } from "./report-common.mjs";
import { ROOTS } from "./roots.mjs";
import { mdTable, percent } from "./stats.mjs";

/** @typedef {import("./p31-domain-map.mjs").Domain} Domain */
/** @typedef {import("./r4g-survey.mjs").R4gAttrs} R4gAttrs */
/** @typedef {import("./r4g-survey.mjs").Stage} Stage */

// ── 読み込み（副作用） ─────────────────────────────────────

const analysis = await loadAnalysis();
/** @type {Record<string, R4gAttrs>} */
const attrs = await readJsonOr(R4G_ATTRS_PATH, {});
/** @type {Record<string, string[]>} */
const rootsOf = await readJsonOr(R4G_ROOTS_PATH, {});
/** @type {Record<string, { qid: string | null, resolved: string | null }>} */
const titles = await readJsonOr(R4G_TITLES_PATH, {});
const placeClasses = { ...analysis.placeClasses, ...(await readJsonOr(R4G_PLACE_CLASSES_PATH, {})) };
/** @type {Record<string, { ja?: string, en?: string }>} */
const labels = { ...(await readJsonOr(CLASS_LABELS_PATH, {})), ...(await readJsonOr(R4G_LABELS_PATH, {})) };
const eventFiles = (await readdir(join(import.meta.dirname, "..", "..", "public", "data", "events"))).filter((f) => f !== "manifest.json");
/** @type {Map<string, any>} */
const generated = new Map(
  (await Promise.all(eventFiles.map(async (f) => JSON.parse(await readFile(join(import.meta.dirname, "..", "..", "public", "data", "events", f), "utf8")))))
    .flat()
    .map((e) => [e.id, e]),
);
const sampleIds = new Set((await loadSampleEvents()).map((e) => e.id));
const diffusionIds = new Set(
  await Promise.all((await readdir(DIFFUSION_DIR)).filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await readFile(join(DIFFUSION_DIR, f), "utf8")).id)),
);
const { neverOnMap } = await importFromSrc("lib/mapFilters.ts");
const aPages = await Promise.all(REF_A_PAGES.map(async (cfg) => ({ cfg, page: JSON.parse(await readFile(r4gPageFile(cfg.page), "utf8")) })));
const bPages = await Promise.all(REF_B_PAGES.map(async (cfg) => ({ cfg, page: JSON.parse(await readFile(r4gPageFile(cfg.page), "utf8")) })));

// ── パイプラインの結果の索引 ─────────────────────────────────

const allByQid = new Map(analysis.all.map((i) => [i.qid, i]));
const p31RouteQids = new Set(analysis.all.filter((i) => i.fromP31).map((i) => i.qid));
const l5ByQid = Map.groupBy(analysis.listRecords.filter((r) => r.qid), (r) => /** @type {string} */ (r.qid));
const populationQids = new Set(analysis.population.map((i) => i.qid));
const excludedByHand = new Set(analysis.placeOverrides.exclude.map((e) => e.qid));

/** @param {string} id */
const labelOf = (id) => labels[id]?.ja ?? labels[id]?.en ?? id;
/** @param {R4gAttrs | undefined} a @param {string} fallback */
const itemLabel = (a, fallback) => (a?.labels.ja ?? a?.labels.en ?? fallback).replace(/\|/g, "／");
/** @param {readonly number[]} xs */
const sum = (xs) => xs.reduce((a, x) => a + x, 0);
const OTHER_TIME_EXCLUDE = new Set(["P569", "P570", "P813", "P5017"]); // 生没年・参照日・最終更新は、出来事の年として読まない

// ── 1 項目の実際の判定（パイプラインの結果を見る） ─────────────────

/**
 * @param {string} qid
 * @returns {{ dropped: Stage | null, reason: string, route: string, year: string, place: string, note: string }}
 */
const evaluateActual = (qid) => {
  const a = attrs[qid];
  const item = allByQid.get(qid);
  const l5 = l5ByQid.get(qid) ?? [];
  const inP31 = p31RouteQids.has(qid);
  const ev = generated.get(qid);
  const place = placeSummary(a, placeClasses);
  const placeText = place.via ? `${place.via}（${{ usable: "地図に置ける", countryPoint: "国の代表点のみ", coarse: "大陸・海洋のみ", none: "" }[place.kind]}）` : "なし";
  const times = timePropsSummary(a);
  const route = [inP31 ? "P31" : "", l5.length > 0 ? `L5:${[...new Set(l5.map((r) => r.source))].join("/")}` : ""].filter(Boolean).join("+") || "–";
  const note = ev && !populationQids.has(qid) ? (sampleIds.has(qid) ? "手書きのサンプルで入っている" : diffusionIds.has(qid) ? "diffusion で入っている" : "") : "";
  const start = item?.start ?? l5.find((r) => r.start)?.start ?? null;
  const yearText = start ? `${formatYear(start.year)}（${start.source}・精度 ${start.precision}）` : times.length > 0 ? `–（Wikidata: ${times.slice(0, 4).join(" ")}）` : "–（時間のプロパティなし）";
  const base = { route, year: yearText, place: placeText, note };
  /** @param {Stage} stage @param {string} reason */
  const drop = (stage, reason) => ({ ...base, dropped: stage, reason });
  // 生成データにある（サンプル・diffusion を含む）なら、生成と地図だけを見る
  const tail = () => {
    if (!ev) return drop("generated", a && !a.labels.ja && !a.labels.en ? "日本語・英語のラベルが無い" : "母集団にあるが生成データに無い");
    if (ev.places.length === 0) {
      const kinds = item ? [...new Set(item.allPlaces.map((/** @type {any} */ p) => (["P495", "P17"].includes(p.via) ? "国の代表点（P495/P17）" : p.granularity === "coarse" ? "大陸・海洋" : p.granularity)))] : [];
      return drop("map", `placeKind: none（${kinds.join("・") || "場所なし"}）`);
    }
    if (neverOnMap(ev)) return drop("map", `場所が国だけで importance ${ev.importance}（どのズームでも地図に出ない）`);
    return { ...base, dropped: null, reason: "" };
  };
  if (!a) return drop("qid", "属性を取得できなかった");
  if (ev && !populationQids.has(qid)) return tail();
  if (!inP31 && l5.length === 0) {
    const roots = rootsOf[qid] ?? [];
    return drop(
      "route",
      roots.length > 0
        ? `ルート（${roots.map((r) => ROOTS.find((x) => x.qid === r)?.label ?? r).join(", ")}）のインスタンスだが、fetch.mjs の条件（P585/P580/P582 と P625）を満たさない`
        : "Level 5 に無く、P31 がルート（出来事のクラス）の下に無い",
    );
  }
  if (!start) {
    const other = times.filter((t) => !OTHER_TIME_EXCLUDE.has(t.split(":")[0]));
    return drop("year", other.length > 0 ? `LIST_TIME_PROPS に値が無い（他の時間のプロパティ: ${other.map((t) => t.split(":")[0]).join(", ")}）` : "時間のプロパティが無い");
  }
  if (start.year < APP_YEAR_MIN || start.year > APP_YEAR_MAX) return drop("year", `年が表示範囲外（${formatYear(start.year)}、精度 ${start.precision}）`);
  const listDomain = l5.find((r) => r.domain)?.domain ?? null;
  const c = item ? item.classification : listDomain ? { status: "mapped" } : classify(a.p31);
  if (c.status !== "mapped") {
    return drop("domain", `${c.status === "excluded" ? "P31 が写像表で exclude" : "P31 が写像表に無い"}（${a.p31.map(labelOf).slice(0, 3).join(", ") || "P31 なし"}）`);
  }
  if (!populationQids.has(qid)) {
    const places = item ? item.places : [];
    const workOnly = item && item.countryLevelPlace && item.p31.some((/** @type {string} */ q) => WORK_CLASSES.includes(q));
    const reason =
      places.length === 0
        ? `場所が無い（${LIST_PLACE_PROPS.join("/")}）`
        : (item?.sitelinks ?? a.sitelinks) < 2
          ? "sitelinks が 2 未満"
          : workOnly
            ? "作品類で、場所が国の代表点だけ"
            : excludedByHand.has(qid)
              ? "人が除外した（place-overrides.json の exclude）"
              : "不明";
    return drop("filters", reason);
  }
  return tail();
};

// ── 基準のリストの項目 ──────────────────────────────────────

/**
 * A: ページごとの項目。同じ QID が複数のページにあれば 1 件（最初のページ）。
 * @type {{ list: "A" | "B" | "C", source: string, title: string, qid: string | null, unmatched?: string, refDomain: Domain, region: string | null, lineNo?: number, text?: string }[]}
 */
const refA = [
  ...new Map(
    aPages
      .flatMap(({ cfg, page }) => refAEntries(cfg, page.wikitext).map((e) => ({ cfg, e })))
      .map(({ cfg, e }) => {
        const qid = titles[e.title]?.qid ?? null;
        return /** @type {const} */ ([qid ?? `title:${e.title}`, { list: /** @type {const} */ ("A"), source: cfg.label, title: e.title, qid, refDomain: cfg.domain, region: null }]);
      }),
  ).values(),
];

/** B: 行ごと。主題の QID で照合する。同じ記事の中で同じ QID が複数の行にあれば 1 件。記事が違えば別に数える（地域ごとの集計のため）。 */
const refBLines = bPages.flatMap(({ cfg, page }) =>
  refBEntries(cfg, page.wikitext).map((e) => {
    const s = pickSubject(e.links, titles, attrs);
    return {
      list: /** @type {const} */ ("B"),
      source: cfg.label,
      title: s.status === "subject" ? s.title : (e.links[0] ?? ""),
      qid: s.status === "subject" ? s.qid : null,
      unmatched: s.status === "subject" ? undefined : s.status === "unresolved" ? (e.links.length === 0 ? "照合不能（行にリンクが無い）" : "照合不能（リンクが QID に解決できない）") : "照合不能（リンクが人・地名だけ）",
      refDomain: cfg.domain,
      region: /** @type {string | null} */ (cfg.region),
      lineNo: e.lineNo,
      text: e.text,
    };
  }),
);
const refB = [...new Map(refBLines.map((r) => [r.qid ? `${r.source}|${r.qid}` : `${r.source}|line:${r.lineNo}`, r])).values()];
const refC = REF_C_ITEMS.map((c) => ({ list: /** @type {const} */ ("C"), source: c.label, title: c.title, qid: titles[c.title]?.qid ?? null, refDomain: /** @type {Domain} */ ("science"), region: null, note: c.note }));

/** @param {{ qid: string | null, unmatched?: string, title: string }} r */
const judge = (r) =>
  r.qid ? evaluateActual(r.qid) : { dropped: /** @type {Stage} */ ("qid"), reason: r.unmatched ?? "記事に Wikidata の項目が無い", route: "–", year: "–", place: "–", note: "" };

const judgedA = refA.map((r) => ({ ...r, ...judge(r) }));
const judgedB = refB.map((r) => ({ ...r, ...judge(r) }));
const judgedC = refC.map((r) => ({ ...r, ...judge(r) }));
/** @typedef {(typeof judgedA)[number]} Judged */

// ── 地域と年代（再現率の表の軸） ─────────────────────────────

/**
 * 年代: Wikidata の年。LIST_TIME_PROPS の順で最初にあるプロパティの最も早い値、無ければ他の時間のプロパティ（生没年などを除く）の最も早い値。
 * @param {string | null} qid
 */
const referenceYear = (qid) => {
  const a = qid ? attrs[qid] : undefined;
  if (!a) return null;
  const prop = LIST_TIME_PROPS.find((p) => (a.times[p] ?? []).length > 0);
  if (prop) return a.times[prop][0].year;
  const others = Object.entries(a.times).filter(([p]) => !OTHER_TIME_EXCLUDE.has(p)).flatMap(([, ts]) => ts.map((t) => t.year));
  return others.length > 0 ? Math.min(...others) : null;
};
/** 地域: B は記事の地域。A は Wikidata の場所（LIST_PLACE_PROPS の順。国の代表点も含む）の過半数の地域。 @param {Judged} r */
const referenceRegion = (r) => {
  if (r.region) return r.region;
  const a = r.qid ? attrs[r.qid] : undefined;
  const via = LIST_PLACE_PROPS.find((p) => (a?.places ?? []).some((x) => x.prop === p));
  if (!a || !via) return "unknown";
  const located = a.places.filter((x) => x.prop === via).map((p) => regionOf(analysis.countryIndex, p).region);
  return located.find((x) => located.filter((y) => y === x).length * 2 > located.length) ?? "multi";
};

// ── 表（純粋関数） ─────────────────────────────────────────

/** 段階 s を通過した件数。 @param {readonly Judged[]} xs @param {Stage} s */
const passed = (xs, s) => xs.filter((x) => x.dropped === null || STAGES.indexOf(x.dropped) > STAGES.indexOf(s)).length;

/** @param {readonly Judged[]} xs */
const funnelTable = (xs) =>
  mdTable(
    ["段階", "通過", "全体に対する割合", "前の段階に対する割合", "この段階で落ちた"],
    STAGES.map((s, k) => {
      const n = passed(xs, s);
      const prev = k === 0 ? xs.length : passed(xs, STAGES[k - 1]);
      return [STAGE_LABELS[s], n, percent(n, xs.length), percent(n, prev), xs.filter((x) => x.dropped === s).length];
    }),
  );

/** @param {readonly Judged[]} xs @param {readonly string[]} sources */
const funnelBySource = (xs, sources) =>
  mdTable(
    ["出典", "項目", ...STAGES.map((s) => STAGE_LABELS[s])],
    [...sources.map((src) => xs.filter((x) => x.source === src)), xs].map((g, k) => [
      k < sources.length ? sources[k] : "**合計**",
      g.length,
      ...STAGES.map((s) => `${passed(g, s)}（${percent(passed(g, s), g.length)}）`),
    ]),
  );

/** @param {readonly Judged[]} xs */
const reasonTable = (xs) => {
  const rows = STAGES.flatMap((s) => {
    const dropped = xs.filter((x) => x.dropped === s);
    // 理由の文字列から、項目ごとに変わる部分（括弧の中のクラス名・年）を落として束ねる
    const key = (/** @type {Judged} */ x) => x.reason.replace(/（[^）]*）$/, "").replace(/（ルート[^）]*）/, "");
    return [...Map.groupBy(dropped, key).entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([reason, g]) => [STAGE_LABELS[s], reason, g.length, percent(g.length, xs.length)]);
  });
  return mdTable(["落ちた段階", "理由", "件数", "全体に対する割合"], rows, ["l", "l", "r", "r"]);
};

/** 年の詳細: 年が取れた項目の、使ったプロパティと精度。 @param {readonly Judged[]} xs */
const yearDetailTable = (xs) => {
  const withYear = xs.filter((x) => passed([x], "year") === 1 && x.qid);
  const bySource = [...Map.groupBy(withYear, (x) => {
    const item = allByQid.get(/** @type {string} */ (x.qid));
    const l5 = l5ByQid.get(/** @type {string} */ (x.qid)) ?? [];
    const start = item?.start ?? l5.find((r) => r.start)?.start;
    return `${start?.source ?? "?"}|${start?.precision ?? "?"}`;
  }).entries()].map(([k, g]) => ({ prop: k.split("|")[0], prec: Number(k.split("|")[1]), n: g.length }));
  const props = [...new Set(bySource.map((b) => b.prop))].sort();
  const precs = [11, 10, 9, 8, 7, 6];
  return mdTable(
    ["プロパティ", "件数", ...precs.map((p) => `精度 ${p}`), "精度 5 以下"],
    props.map((p) => {
      const g = bySource.filter((b) => b.prop === p);
      return [p, sum(g.map((b) => b.n)), ...precs.map((q) => sum(g.filter((b) => b.prec === q).map((b) => b.n))), sum(g.filter((b) => b.prec < 6).map((b) => b.n))];
    }),
  );
};

/** 年が取れなかった項目の、Wikidata にある時間のプロパティ。 @param {readonly Judged[]} xs */
const missingYearProps = (xs) => {
  const noYear = xs.filter((x) => x.dropped === "year" && x.qid);
  const noRoute = xs.filter((x) => x.dropped === "route" && x.qid);
  /** @param {readonly Judged[]} g */
  const count = (g) => {
    const m = new Map();
    g.forEach((x) => Object.keys(attrs[/** @type {string} */ (x.qid)]?.times ?? {}).forEach((p) => m.set(p, (m.get(p) ?? 0) + 1)));
    return m;
  };
  const [cy, cr] = [count(noYear), count(noRoute)];
  const props = [...new Set([...cy.keys(), ...cr.keys()])].sort((p, q) => (cy.get(q) ?? 0) + (cr.get(q) ?? 0) - (cy.get(p) ?? 0) - (cr.get(p) ?? 0));
  return [
    mdTable(
      ["プロパティ", "ラベル", "年の段階で落ちた項目", "入口の段階で落ちた項目"],
      [
        ...props.slice(0, 25).map((p) => [p, labelOf(p), cy.get(p) ?? 0, cr.get(p) ?? 0]),
        ["（時間のプロパティなし）", "", noYear.filter((x) => Object.keys(attrs[/** @type {string} */ (x.qid)]?.times ?? {}).length === 0).length, noRoute.filter((x) => Object.keys(attrs[/** @type {string} */ (x.qid)]?.times ?? {}).length === 0).length],
      ],
      ["l", "l", "r", "r"],
    ),
    `（年の段階で落ちた ${noYear.length} 件、入口の段階で落ちた ${noRoute.length} 件。1 項目が複数のプロパティを持てば、それぞれに数える）`,
  ].join("\n\n");
};

/** 場所の詳細（段階によらず、QID のある項目すべて）。 @param {readonly Judged[]} xs */
const placeDetailTable = (xs) => {
  const withQid = xs.filter((x) => x.qid);
  const key = (/** @type {Judged} */ x) => {
    const p = placeSummary(attrs[/** @type {string} */ (x.qid)], placeClasses);
    return p.via ? `${p.via}|${p.kind}` : "なし|none";
  };
  const groups = [...Map.groupBy(withQid, key).entries()].sort((a, b) => b[1].length - a[1].length);
  return mdTable(
    ["プロパティ", "種類", "件数", "割合", "うち生成データにある"],
    groups.map(([k, g]) => [k.split("|")[0], { usable: "地図に置ける", countryPoint: "国の代表点のみ", coarse: "大陸・海洋のみ", none: "–" }[/** @type {"usable"} */ (k.split("|")[1])], g.length, percent(g.length, withQid.length), passed(g, "generated")]),
  );
};

/** 年代 × 地域の再現率。セルは「生成データにある / 全体（地図に出る）」。 @param {readonly Judged[]} xs @param {readonly string[]} regionKeys */
const recallTable = (xs, regionKeys) => {
  const withQid = xs.filter((x) => x.qid);
  const eraKey = (/** @type {Judged} */ x) => {
    const y = referenceYear(x.qid);
    return y === null ? "unknown" : y < APP_YEAR_MIN ? "before" : y > APP_YEAR_MAX ? "after" : String(eraOf(y));
  };
  const keyed = withQid.map((x) => ({ x, era: eraKey(x), region: referenceRegion(x) }));
  const eras = [...new Set(keyed.map((k) => k.era))].sort((a, b) => {
    const rank = (/** @type {string} */ e) => (e === "before" ? -1e9 : e === "unknown" ? 1e9 : e === "after" ? 1e8 : Number(e));
    return rank(a) - rank(b);
  });
  const usedRegions = regionKeys.filter((r) => keyed.some((k) => k.region === r));
  /** @param {readonly { x: Judged }[]} g */
  const cell = (g) => (g.length === 0 ? "" : `${passed(g.map((k) => k.x), "generated")}/${g.length}（${passed(g.map((k) => k.x), "map")}）`);
  const eraName = (/** @type {string} */ e) =>
    e === "unknown" ? "年不明" : e === "before" ? `${formatYear(APP_YEAR_MIN - 1)} 以前` : e === "after" ? "2026 以降" : eraLabel(Number(e));
  const regName = (/** @type {string} */ r) => (r === "unknown" ? "場所不明" : regionLabel(/** @type {any} */ (r)));
  const rows = eras.map((e) => {
    const g = keyed.filter((k) => k.era === e);
    const n = passed(g.map((k) => k.x), "generated");
    return [eraName(e), ...usedRegions.map((r) => cell(g.filter((k) => k.region === r))), `${n}/${g.length}（${percent(n, g.length)}）`];
  });
  const totals = usedRegions.map((r) => {
    const g = keyed.filter((k) => k.region === r);
    const n = passed(g.map((k) => k.x), "generated");
    return `${n}/${g.length}（${percent(n, g.length)}）`;
  });
  return mdTable(["年代", ...usedRegions.map(regName), "合計"], [...rows, ["**合計**", ...totals, `${passed(withQid, "generated")}/${withQid.length}`]]);
};

// ── 修正の見積もり ────────────────────────────────────────

/** @param {Judged} x */
const simInput = (x) => {
  const qid = /** @type {string} */ (x.qid);
  const l5 = l5ByQid.get(qid) ?? [];
  return {
    attrs: attrs[qid],
    inRoute: p31RouteQids.has(qid) || l5.length > 0,
    listDomain: l5.find((r) => r.domain)?.domain ?? null,
    refDomain: x.refDomain,
    excludedByHand: excludedByHand.has(qid),
    placeClasses,
  };
};
/** @param {Stage | null} s */
const reachesGenerated = (s) => s === null || s === "map";

/** いまの規則での simulate と、実際の判定の一致。 @param {readonly Judged[]} xs */
const agreementTable = (xs) => {
  const withQid = xs.filter((x) => x.qid && attrs[/** @type {string} */ (x.qid)]);
  const rows = [...STAGES.slice(1), null].map((s) => {
    const g = withQid.filter((x) => x.dropped === s);
    const same = g.filter((x) => simulate(simInput(x)).dropped === s).length;
    const genSame = g.filter((x) => reachesGenerated(simulate(simInput(x)).dropped) === reachesGenerated(x.dropped)).length;
    return [s ? STAGE_LABELS[s] : "（地図まで通過）", g.length, `${same}（${percent(same, g.length)}）`, `${genSame}（${percent(genSame, g.length)}）`];
  });
  return mdTable(["実際に落ちた段階", "件数", "simulate も同じ段階", "「生成データにあるか」が一致"], rows);
};

/** 年の段階・入口の段階で落ちた項目が持つ、LIST_TIME_PROPS 以外の時間のプロパティ（上位）。F1 で足す候補。 */
const extraTimeProps = (() => {
  const dropped = [...judgedA, ...judgedB].filter((x) => x.qid && (x.dropped === "year" || x.dropped === "route"));
  const m = new Map();
  dropped.forEach((x) =>
    Object.keys(attrs[/** @type {string} */ (x.qid)]?.times ?? {})
      .filter((p) => !LIST_TIME_PROPS.includes(p) && !OTHER_TIME_EXCLUDE.has(p) && !["P582", "P576", "P2669", "P730", "P3999"].includes(p))
      .forEach((p) => m.set(p, (m.get(p) ?? 0) + 1)),
  );
  return [...m.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([p]) => p);
})();

/**
 * 修正の一覧。apply は、その修正だけを入れた simulate の結果（extra で場所の条件を外せる）。targets は、その修正で救える可能性のある項目（実際に落ちた段階で絞る）。
 * @type {readonly { key: string, label: string, detail: string, targets: (x: Judged) => boolean, apply: (x: Judged, extra?: { ignorePlace?: boolean }) => Stage | null }[]}
 */
const FIXES = [
  {
    key: "F1a",
    label: "年のプロパティの追加（Level 5 の経路）",
    detail: `LIST_TIME_PROPS（${LIST_TIME_PROPS.join(" / ")}）の後ろに、落ちた項目に 3 件以上現れた他の時間のプロパティ（${extraTimeProps.map((p) => `${p} ${labelOf(p)}`).join("、") || "なし"}）を足す`,
    targets: (x) => x.dropped === "year",
    apply: (x, extra = {}) => simulate(simInput(x), { ...extra, timeProps: [...LIST_TIME_PROPS, ...extraTimeProps] }).dropped,
  },
  {
    key: "F1b",
    label: "年のプロパティの追加（P31 経路）",
    detail: "fetch.mjs の年に P575 / P571 / P577 を足す。ルートのインスタンスで、P625 がある（戦争のルートなら不要）項目が入口に入る",
    targets: (x) => x.dropped === "route" && (rootsOf[/** @type {string} */ (x.qid)] ?? []).length > 0,
    apply: (x, extra = {}) => {
      const qid = /** @type {string} */ (x.qid);
      const a = attrs[qid];
      const war = (rootsOf[qid] ?? []).some((r) => ROOTS.find((y) => y.qid === r)?.group === "war");
      const ok = a && (war || a.places.some((p) => p.prop === "P625")) && ["P575", "P571", "P577"].some((p) => (a.times[p] ?? []).length > 0);
      return ok ? simulate({ ...simInput(x), inRoute: true }, { ...extra, timeProps: ["P585", "P580", "P582", "P575", "P571", "P577"] }).dropped : "route";
    },
  },
  {
    key: "F2",
    label: "精度の扱い（区間で範囲を判定）",
    detail: `年が表示範囲外で落ちた項目のうち、精度（世紀・千年紀など）の区間が表示範囲（${formatYear(APP_YEAR_MIN)}〜${APP_YEAR_MAX}）に掛かるものを入れる`,
    targets: (x) => x.dropped === "year" && x.reason.startsWith("年が表示範囲外"),
    apply: (x, extra = {}) => {
      const a = attrs[/** @type {string} */ (x.qid)];
      const prop = LIST_TIME_PROPS.find((p) => (a?.times[p] ?? []).length > 0);
      const t = prop && a ? a.times[prop][0] : null;
      if (!t) return "year";
      const span = t.precision >= 9 ? 0 : 10 ** (9 - t.precision);
      return t.year + span >= APP_YEAR_MIN ? simulate(simInput(x), { ...extra, yearMin: APP_YEAR_MIN - span }).dropped : "year";
    },
  },
  {
    key: "F3",
    label: "P31 の写像の追加",
    detail: "分類の段階で落ちた項目の P31 を、どれかの分類に写像する（どのクラスをどの分類にするかは下の表。件数は、全部を写像した場合の上限）",
    targets: (x) => x.dropped === "domain",
    apply: (x, extra = {}) => simulate(simInput(x), { ...extra, extraMappedClasses: new Set(attrs[/** @type {string} */ (x.qid)]?.p31 ?? []) }).dropped,
  },
  {
    key: "F4a",
    label: "除外の規則の見直し（sitelinks）",
    detail: "sitelinks 2 未満の除外（R4b-2 の決定4）をやめる",
    targets: (x) => x.dropped === "filters" && x.reason === "sitelinks が 2 未満",
    apply: (x, extra = {}) => simulate(simInput(x), { ...extra, minSitelinks: 0 }).dropped,
  },
  {
    key: "F4b",
    label: "除外の規則の見直し（作品類）",
    detail: "場所が国の代表点だけの作品類の除外（R4b-2）をやめる（入っても placeKind: none で地図には出ない）",
    targets: (x) => x.dropped === "filters" && x.reason === "作品類で、場所が国の代表点だけ",
    apply: (x, extra = {}) => simulate(simInput(x), { ...extra, keepCountryOnlyWorks: true }).dropped,
  },
  {
    key: "F5",
    label: "照合用リストの取り込み",
    detail: "基準のリスト（A は Level 4 の各ページ、B は各一覧）を Level 5 と同じ入口にする。分類はページ（記事）で決める。年・場所は Wikidata から（いまの規則）",
    targets: (x) => x.dropped === "route",
    apply: (x, extra = {}) => simulate(simInput(x), { ...extra, importLists: true }).dropped,
  },
  {
    key: "all",
    label: "F1a〜F5 をすべて",
    detail: "上の修正を同時に入れる",
    targets: (x) => x.dropped !== null && x.dropped !== "map" && x.dropped !== "qid",
    apply: (x, extra = {}) => {
      const qid = /** @type {string} */ (x.qid);
      const a = attrs[qid];
      const t = (() => {
        const prop = LIST_TIME_PROPS.find((p) => (a?.times[p] ?? []).length > 0);
        return prop && a ? a.times[prop][0] : null;
      })();
      const span = t && t.precision < 9 ? 10 ** (9 - t.precision) : 0;
      return simulate(simInput(x), {
        ...extra,
        timeProps: [...LIST_TIME_PROPS, ...extraTimeProps],
        importLists: true,
        extraMappedClasses: new Set(a?.p31 ?? []),
        minSitelinks: 0,
        keepCountryOnlyWorks: true,
        yearMin: APP_YEAR_MIN - span,
      }).dropped;
    },
  },
];

/** @param {readonly Judged[]} xs */
const fixTable = (xs) => {
  const withQid = xs.filter((x) => x.qid && attrs[/** @type {string} */ (x.qid)]);
  const baseGen = passed(xs, "generated");
  const baseMap = passed(xs, "map");
  const noPlace = { ignorePlace: true };
  // 見積もりに数えるのは、いまの規則の simulate でも生成データに届かない項目だけ（simulate と実際の判定のずれを、効果に数えないため）
  const notYet = (/** @type {Judged} */ x) => !reachesGenerated(simulate(simInput(x)).dropped) && !reachesGenerated(x.dropped);
  // 場所の条件を外すだけ（R4h の上限の参考）
  const r4hOnly = withQid.filter((x) => notYet(x) && reachesGenerated(simulate(simInput(x), noPlace).dropped)).length;
  const rows = FIXES.map((f) => {
    const targets = withQid.filter(f.targets);
    const gained = targets.filter((x) => notYet(x) && reachesGenerated(f.apply(x)));
    const gainedMap = gained.filter((x) => f.apply(x) === null);
    const gainedNoPlace = withQid.filter((x) => notYet(x) && (f.targets(x) || reachesGenerated(simulate(simInput(x), noPlace).dropped)) && reachesGenerated(f.apply(x, noPlace))).length;
    return [
      `${f.key} ${f.label}`,
      targets.length,
      gained.length,
      `${percent(baseGen, xs.length)} → ${percent(baseGen + gained.length, xs.length)}`,
      gainedMap.length,
      `${percent(baseMap, xs.length)} → ${percent(baseMap + gainedMap.length, xs.length)}`,
      `${gainedNoPlace}（${percent(baseGen + gainedNoPlace, xs.length)}）`,
    ];
  });
  return mdTable(
    ["修正", "対象（その段階で落ちた項目）", "生成データに届く", "生成データの再現率", "うち地図に出る", "地図の再現率", "R4h と合わせた場合に生成データに届く（再現率）"],
    [...rows, ["（参考）R4h: 場所の条件を外すだけ", "–", "–", "–", "–", "–", `${r4hOnly}（${percent(baseGen + r4hOnly, xs.length)}）`]],
  );
};

/** F3 の内訳: 分類の段階で落ちた項目の P31 の上位。 @param {readonly Judged[]} xs */
const domainClassTable = (xs) => {
  const dropped = xs.filter((x) => x.dropped === "domain" && x.qid);
  const pairs = dropped.flatMap((x) => (attrs[/** @type {string} */ (x.qid)]?.p31 ?? []).map((c) => ({ c, x })));
  return mdTable(
    ["P31", "ラベル", "件数", "うち F3 で生成データに届く", "例"],
    [...Map.groupBy(pairs, (p) => p.c).entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 25)
      .map(([c, g]) => [
        c,
        labelOf(c),
        g.length,
        g.filter((p) => reachesGenerated(simulate(simInput(p.x), { extraMappedClasses: new Set([c]) }).dropped)).length,
        g.slice(0, 3).map((p) => itemLabel(attrs[/** @type {string} */ (p.x.qid)], p.x.title)).join("、"),
      ]),
    ["l", "l", "r", "r", "l"],
  );
};

// ── 落ちた項目の一覧 ──────────────────────────────────────

/** @param {readonly Judged[]} xs */
const droppedRows = (xs) =>
  xs
    .filter((x) => x.dropped !== null)
    .sort((a, b) => (attrs[b.qid ?? ""]?.sitelinks ?? -1) - (attrs[a.qid ?? ""]?.sitelinks ?? -1) || a.title.localeCompare(b.title))
    .map((x) => [
      attrs[x.qid ?? ""]?.sitelinks ?? "–",
      x.qid ?? "–",
      itemLabel(x.qid ? attrs[x.qid] : undefined, x.title || `（${x.source} ${x.lineNo ?? ""} 行）`),
      x.source,
      (() => {
        const y = referenceYear(x.qid);
        return y === null ? "–" : formatYear(y);
      })(),
      STAGE_LABELS[/** @type {Stage} */ (x.dropped)],
      x.reason.replace(/\|/g, "／"),
      x.year.replace(/\|/g, "／"),
      x.place,
    ]);

// ── 出力 ──────────────────────────────────────────────────

const aSources = REF_A_PAGES.map((p) => p.label);
const bSources = REF_B_PAGES.map((p) => p.label);
const regionKeysA = [...REGIONS, "multi", "unknown"];
const revs = [...aPages, ...bPages].map(({ cfg, page }) => `${cfg.page.replace("Wikipedia:Vital articles/Level/4/", "Vital articles Level 4/")}（rev ${page.revid}）`);
const bLineStats = bSources.map((src) => {
  const lines = refBLines.filter((r) => r.source === src);
  const unmatched = lines.filter((r) => !r.qid);
  return [
    src,
    REF_B_PAGES.find((p) => p.label === src)?.page ?? "",
    lines.length,
    lines.length - unmatched.length,
    percent(lines.length - unmatched.length, lines.length),
    unmatched.filter((r) => r.unmatched?.includes("リンクが無い")).length,
    unmatched.filter((r) => r.unmatched?.includes("解決できない")).length,
    unmatched.filter((r) => r.unmatched?.includes("人・地名")).length,
    refB.filter((r) => r.source === src && r.qid).length,
  ];
});

const report = [
  "# 科学・技術・経済の欠落の調査: 独立した基準のリストとの照合（R4g、調査のみ）",
  "",
  "> このファイルは `node scripts/wikidata/report-r4g.mjs` が自動生成する。手で編集しない。読み方・所見・精度の扱いの案は [FINDINGS-R4g.md](FINDINGS-R4g.md)、",
  "> 年が表示範囲内にあるのに落ちた項目の一覧は [REPORT-R4g-dropped-dated.md](REPORT-R4g-dropped-dated.md)（全件の一覧は data/raw/r4g/dropped-all.md で、コミットしない）。",
  "> 数値の出所: 基準のリストと Wikidata の属性は `node scripts/wikidata/fetch-r4g.mjs` が data/raw/r4g/ に保存した取得結果、パイプラインの結果は",
  "> REPORT.md と同じ母集団（load-analysis.mjs。`pnpm wikidata:fetch` / `fetch-lists` の取得結果）と、コミット済みの public/data/events/。どちらもこの調査では変えていない。",
  "",
  "## 基準のリストと段階",
  "",
  "- 記事の版: " + revs.join("、"),
  `- **A**: Vital articles Level 4 の ${aSources.join("、")}。同じ QID は 1 件（最初のページ）。${refA.length} 件（うち QID に解決できない ${refA.filter((r) => !r.qid).length} 件）。`,
  `- **B**: 地域別の発明・発見の一覧 ${bPages.length} 記事。1 行 = 1 項目で、主題のリンクの QID で照合する。同じ記事で同じ QID は 1 件、記事が違えば別に数える。${refB.length} 件（うち照合不能 ${refB.filter((r) => !r.qid).length} 行）。`,
  "- **C**: 回帰用の 8 項目（「アルコールの蒸留」は 2 項目で見た）。",
  "- 段階（依頼の順。各項目は、通過できた最後の段階の次で落ちたとする）:",
  ...STAGES.map((s, k) => `  ${k + 1}. ${STAGE_LABELS[s]}`),
  "  - 「Level 5 / P31 経路にある」: Level 5（lists.mjs の Vital articles。History を含む）に載っているか、fetch.mjs の P31 経路（events.json）で取れている。",
  "  - 「年が取れる」: analyze.mjs の開始年（P31 経路は P580 → P585 → P582、Level 5 は LIST_TIME_PROPS の順）があり、表示範囲（前3000〜2025）に入る。",
  "  - 「除外の規則を通る」: 場所が 1 つ以上ある（国の代表点を含む）・sitelinks 2 以上・国の代表点だけの作品類でない・人が除外していない。つまり母集団（REPORT.md）に入る。",
  "  - 「生成データにある」: public/data/events/ にある（手書きのサンプル・diffusion で入っているものも含む。その場合は一覧の備考に書く）。",
  "  - 「地図に出る」: placeKind が none でなく、neverOnMap（mapFilters.ts。既定の閾値。場所が国だけの importance 1 は地図に出ない）でない。密度による繰り上げは見ていない。",
  "",
  "### 基準 B の照合",
  "",
  mdTable(["一覧", "記事", "行", "照合できた行", "割合", "照合不能: リンクなし", "照合不能: QID なし", "照合不能: 人・地名だけ", "項目（QID の重複を除く）"], bLineStats),
  "",
  "## 1. 基準 A（Vital articles Level 4）",
  "",
  "### 段階ごとの残存率（漏斗）",
  "",
  funnelTable(judgedA),
  "",
  funnelBySource(judgedA, aSources),
  "",
  "### 落ちた理由",
  "",
  reasonTable(judgedA),
  "",
  "## 2. 基準 B（地域別の発明・発見の一覧）",
  "",
  "### 段階ごとの残存率（漏斗）",
  "",
  funnelTable(judgedB),
  "",
  funnelBySource(judgedB, bSources),
  "",
  "### 落ちた理由",
  "",
  reasonTable(judgedB),
  "",
  "## 3. 年と場所の内訳",
  "",
  "### 年が取れた項目の、プロパティと精度（A・B）",
  "",
  "精度は Wikidata の precision（9 = 年、8 = 10 年、7 = 世紀、6 = 千年紀）。",
  "",
  "A:",
  "",
  yearDetailTable(judgedA),
  "",
  "B:",
  "",
  yearDetailTable(judgedB),
  "",
  "### 年が取れなかった項目に、Wikidata で入っている時間のプロパティ",
  "",
  "A:",
  "",
  missingYearProps(judgedA),
  "",
  "B:",
  "",
  missingYearProps(judgedB),
  "",
  "### 場所のプロパティ（QID のある項目すべて。段階によらない）",
  "",
  "LIST_PLACE_PROPS（" + LIST_PLACE_PROPS.join(" / ") + "）の優先順で最初に値のあるプロパティ。場所の欠落の修正は R4h で扱う。",
  "",
  "A:",
  "",
  placeDetailTable(judgedA),
  "",
  "B:",
  "",
  placeDetailTable(judgedB),
  "",
  "## 4. 年代（500 年刻み）× 地域の再現率",
  "",
  "セルは「生成データにある件数 / 基準の件数（うち地図に出る件数）」。QID のある項目だけ。",
  "年代は Wikidata の年（LIST_TIME_PROPS の順で最初にあるプロパティの最も早い値。無ければ他の時間のプロパティの最も早い値。生没年などは除く）。年が無い項目は「年不明」。",
  "地域は、B は一覧の地域（中国 → 東アジア、中世イスラーム世界・エジプト → 西アジア・北アフリカ、アメリカ大陸 → 中央・南アメリカ、など）。",
  "A は Wikidata の場所（国の代表点を含む）の過半数の地域で、場所が無ければ「場所不明」。",
  "",
  "### A",
  "",
  recallTable(judgedA, regionKeysA),
  "",
  "### B",
  "",
  recallTable(judgedB, [...REGIONS]),
  "",
  "## 5. 基準 C（回帰用）",
  "",
  mdTable(
    ["項目", "記事", "QID", "落ちた段階", "理由", "入口", "年", "場所"],
    judgedC.map((c) => [
      c.source,
      c.title,
      c.qid ?? "–",
      c.dropped ? STAGE_LABELS[c.dropped] : "（地図まで通過）",
      [c.reason, c.note].filter(Boolean).join("。").replace(/\|/g, "／") || "–",
      c.route,
      c.year.replace(/\|/g, "／"),
      c.place,
    ]),
    ["l", "l", "l", "l", "l", "l", "l", "l"],
  ),
  "",
  "## 6. 修正ごとの見積もり",
  "",
  "各修正を 1 つだけ入れた場合に、基準の項目のうち何件が新たに生成データ（と地図）に届くか。simulate（r4g-survey.mjs）で、Wikidata の値からパイプラインの規則をなぞって判定した。",
  "修正の対象は、その修正が効く段階で実際に落ちた項目。見積もりに数えるのは、いまの規則の simulate でも生成データに届かない項目だけ（simulate と実際の判定のずれを効果に数えないため）。",
  "「地図に出る」は、使える場所（国の代表点・大陸・海洋以外）があるかだけで見ている（importance は見ていない）。",
  "",
  "### simulate と実際の判定の一致（いまの規則で）",
  "",
  "A・B を合わせて。simulate の違い: P31 経路の項目も Level 5 の規則（年・場所の選び方）で見る、importance と place-overrides.json を見ない。",
  "",
  agreementTable([...judgedA, ...judgedB]),
  "",
  "### 修正の内容",
  "",
  ...FIXES.map((f) => `- **${f.key} ${f.label}**: ${f.detail}`),
  "- 場所が無い項目（除外の段階の「場所が無い」）は R4h で扱うので、修正の列には含めない。最後の列だけは、場所の条件を外した場合（R4h で場所をすべて補えた場合の上限。",
  "  国の代表点しか無い項目も含むので、地図に出るとは限らない）と組み合わせた数で、R4h と組み合わせたときの伸びしろを見るためのもの。",
  "",
  "### A",
  "",
  fixTable(judgedA),
  "",
  "### B",
  "",
  fixTable(judgedB),
  "",
  "### F3 の内訳: 分類の段階で落ちた項目の P31（A・B）",
  "",
  domainClassTable([...judgedA, ...judgedB]),
  "",
].join("\n");

/** 年が表示範囲内（Wikidata の年。referenceYear）か。 @param {Judged} x */
const datedInRange = (x) => {
  const y = referenceYear(x.qid);
  return y !== null && y >= APP_YEAR_MIN && y <= APP_YEAR_MAX;
};

/**
 * 落ちた項目の一覧の Markdown。
 * @param {string} title @param {readonly string[]} intro @param {(x: Judged) => boolean} keep
 */
const droppedDoc = (title, intro, keep) => {
  const [a, b] = [judgedA, judgedB].map((xs) => xs.filter((x) => x.dropped !== null && keep(x)));
  const header = ["sitelinks", "QID", "ラベル", "出典", "Wikidata の年", "落ちた段階", "理由", "パイプラインの年", "場所"];
  const align = /** @type {("l" | "r")[]} */ (["r", "l", "l", "l", "r", "l", "l", "l", "l"]);
  const rows = droppedRows;
  return [
    `# ${title}`,
    "",
    "> このファイルは `node scripts/wikidata/report-r4g.mjs` が自動生成する。手で編集しない。集計と読み方は [REPORT-R4g.md](REPORT-R4g.md)・[FINDINGS-R4g.md](FINDINGS-R4g.md)。",
    "",
    ...intro,
    "importance の推定の代わりに、sitelinks の多い順に並べた（importance はいまのパイプラインでも sitelinks の年代別パーセンタイルで決めている）。",
    "「地図に出る」の段階で落ちた項目（生成データにはあるが地図に出ない）も含む。",
    "「Wikidata の年」は、LIST_TIME_PROPS の順で最初にあるプロパティの最も早い値（無ければ他の時間のプロパティ。生没年などは除く）。",
    "「パイプラインの年」は、パイプラインが採った年（プロパティ・精度）、無ければ Wikidata にある時間のプロパティ。",
    "",
    `## A（${a.length} 件）`,
    "",
    mdTable(header, rows(a), align),
    "",
    `## B（${b.length} 件）`,
    "",
    mdTable(header, rows(b), align),
    "",
  ].join("\n");
};

const droppedAll = droppedDoc("基準のリストのうち、パイプラインで落ちた項目の全一覧（R4g）", [], () => true);
const droppedDated = droppedDoc(
  "基準のリストのうち、年が表示範囲内にあるのに落ちた項目（R4g）",
  [
    `Wikidata の年が表示範囲（${formatYear(APP_YEAR_MIN)}〜${APP_YEAR_MAX}）にあるのに、生成データまたは地図に届かなかった項目だけ。次の回（初出の記録を手で選ぶ）の候補。`,
    "全件の一覧は data/raw/r4g/dropped-all.md にあり、コミットしない（data/raw/ が無いと再生成できないため）。",
    "",
  ],
  datedInRange,
);

await writeFile(R4G_REPORT_PATH, report);
await writeFile(R4G_DROPPED_ALL_PATH, droppedAll);
await writeFile(R4G_DROPPED_DATED_PATH, droppedDated);
console.log(`→ ${R4G_REPORT_PATH}\n→ ${R4G_DROPPED_DATED_PATH}\n→ ${R4G_DROPPED_ALL_PATH}`);
console.log(`A ${judgedA.length} 件（生成 ${passed(judgedA, "generated")}、地図 ${passed(judgedA, "map")}）、B ${judgedB.length} 件（生成 ${passed(judgedB, "generated")}、地図 ${passed(judgedB, "map")}）`);
