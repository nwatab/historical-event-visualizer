// 年表のラベルがパンに対して不変であること（R5d）などを確かめる。src/ の TypeScript を、書き写さずにそのまま読み込む。
//
//   pnpm test
//
// テストの枠組みは Node の組み込み（node:test）。依存を足さないため。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { APP_DATA_DIR } from "../scripts/wikidata/config.mjs";
import { importFromSrc } from "../scripts/wikidata/load-ts.mjs";

const [chart, { TIMELINE_HALF_SPAN_LEVELS, quantizeHalfSpan }, { mergeEventFiles }] = await Promise.all([
  importFromSrc("lib/timelineChart.ts"),
  importFromSrc("lib/timeline.ts"),
  importFromSrc("lib/eventData.ts"),
]);

/** 年表の実際の寸法（design.ts の TIMELINE と textStyle.caption）。幅は 1440×900 の画面での年表の幅に近い値 */
const WIDTH = 870;
const GEOMETRY = { width: WIDTH, pointRadius: 5.5, minBandWidth: 4 };
const LABEL = { fontSize: 11, gap: 4 };

/** アプリと同じ手順で、窓に描くラベルを求める。段階ごとの計算（layout）は窓に依らないので、呼び出し側で 1 回だけ作る。 */
const layoutFor = (events, halfSpan) => {
  const items = chart.timelineItems(events, halfSpan, []);
  const modes = chart.itemModes(items, halfSpan, GEOMETRY);
  return { items, labels: chart.timelineLabels(items, halfSpan, GEOMETRY, LABEL, modes) };
};
const visibleIds = (layout, window) => new Set(chart.labelsInWindow(layout.labels, window, WIDTH, LABEL).map((l) => l.id));
const fullyInside = (item, window) =>
  item.start >= window.center - window.halfSpan && item.end <= window.center + window.halfSpan;

/**
 * 同じ段階で窓を k 年ずらしたとき、両方の窓に完全に入っている項目について、ラベルの付いた項目の集合が一致するか。
 * 一致しなかった項目の id と、比べた項目の数・ラベルの数を返す。
 */
const panDifference = (layout, center, halfSpan, k) => {
  const a = { center, halfSpan };
  const b = { center: center + k, halfSpan };
  const both = layout.items.filter((item) => fullyInside(item, a) && fullyInside(item, b)).map((item) => item.id);
  const [inA, inB] = [visibleIds(layout, a), visibleIds(layout, b)];
  const labeledA = both.filter((id) => inA.has(id));
  const labeledB = both.filter((id) => inB.has(id));
  return {
    compared: both.length,
    labeled: labeledA.length,
    onlyA: labeledA.filter((id) => !inB.has(id)),
    onlyB: labeledB.filter((id) => !inA.has(id)),
  };
};

/** 決まった種から作る疑似乱数（線形合同法）。テストの再現性のため */
const random = (seed) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
};

const DOMAINS = ["conflict", "polity", "science", "technology", "economy", "culture", "population"];

/** 混んだ年表を作る合成データ。期間の長さ・importance・題名の長さがばらつくようにする */
const syntheticEvents = (count, seed) => {
  const next = random(seed);
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor(1400 + next() * 600);
    const period = next() < 0.4;
    return {
      id: `e${i}`,
      title: { ja: `出来事${"あ".repeat(Math.floor(next() * 12))}${i}`, en: `e${i}` },
      domain: DOMAINS[Math.floor(next() * DOMAINS.length)],
      importance: 1 + Math.floor(next() * 3),
      kind: period ? "period" : "instant",
      start,
      ...(period ? { end: start + Math.floor(next() * 80) } : {}),
      places: [{ lon: 0, lat: 0, label: "x" }],
    };
  });
};

const loadEvents = async (files) =>
  mergeEventFiles(await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(APP_DATA_DIR, file), "utf8")))));

describe("ラベルはパンに対して不変（同じ段階なら平行移動だけ）", () => {
  const shifts = (halfSpan) => [...new Set([1, 3, 17, Math.round(halfSpan / 2), halfSpan])];

  test("生成データ（1500〜1999 年）", async () => {
    const events = await loadEvents(["1500.json", "1600.json", "1700.json", "1800.json", "1900.json"]);
    const totals = TIMELINE_HALF_SPAN_LEVELS.map((halfSpan) => {
      const layout = layoutFor(events, halfSpan);
      const results = [1600, 1687, 1750, 1850, 1914].flatMap((center) =>
        shifts(halfSpan).flatMap((k) => [k, -k]).map((k) => ({ k, center, ...panDifference(layout, center, halfSpan, k) })),
      );
      results.forEach((r) =>
        assert.deepEqual([r.onlyA, r.onlyB], [[], []], `±${halfSpan} 年、${r.center} 年から ${r.k} 年ずらした窓`),
      );
      return results.reduce((sum, r) => sum + r.labeled, 0);
    });
    // 比べたラベルが 0 件だと、何も確かめていないことになる
    totals.forEach((total, i) => assert.ok(total > 0, `±${TIMELINE_HALF_SPAN_LEVELS[i]} 年で比べたラベルが無い`));
  });

  test("合成データ（点と帯が混み合い、ヒストグラムの区画が混ざる）", () => {
    const events = syntheticEvents(6000, 42);
    TIMELINE_HALF_SPAN_LEVELS.forEach((halfSpan) => {
      const layout = layoutFor(events, halfSpan);
      [1500, 1623, 1800].forEach((center) =>
        shifts(halfSpan)
          .flatMap((k) => [k, -k])
          .forEach((k) => {
            const r = panDifference(layout, center, halfSpan, k);
            assert.deepEqual([r.onlyA, r.onlyB], [[], []], `±${halfSpan} 年、${center} 年から ${k} 年ずらした窓`);
          }),
      );
    });
  });

  test("点／ヒストグラムの判定は、区画の境目をまたいでも項目ごとに同じ（窓に依らない）", () => {
    const events = syntheticEvents(6000, 7);
    const halfSpan = 50;
    const items = chart.timelineItems(events, halfSpan, []);
    const modes = chart.itemModes(items, halfSpan, GEOMETRY);
    // 1 つのレーンの中に、点の区画とヒストグラムの区画が混ざる
    const mixedLane = DOMAINS.some((domain) => {
      const lane = items.filter((item) => item.domain === domain);
      return lane.some((item) => modes.get(item.id) === "histogram") && lane.some((item) => modes.get(item.id) === "items");
    });
    assert.ok(mixedLane, "混ざったレーンが無い（合成データの密度を見直す）");
    // 同じ区画の項目は、同じ描き方
    items.forEach((item) => {
      const sameBlock = items.filter(
        (other) => other.domain === item.domain && chart.blockOf(other.start, halfSpan) === chart.blockOf(item.start, halfSpan),
      );
      assert.ok(sameBlock.every((other) => modes.get(other.id) === modes.get(item.id)));
    });
  });
});

describe("窓の幅の段階", () => {
  test("いちばん近い段階に丸める（対数の上で）", () => {
    assert.deepEqual(
      [1, 10, 14, 15, 30, 61, 75, 140, 150, 300, 330, 9999].map((h) => quantizeHalfSpan(h)),
      [10, 10, 10, 20, 20, 50, 100, 100, 200, 200, 500, 500],
    );
  });
});

describe("優先順", () => {
  const item = (id, importance, start, end) => ({ id, title: id, domain: "conflict", importance, kind: "period", start, end, offMap: false });

  test("importance → 期間の長さ → start → id。現在年は使わない", () => {
    const items = [item("d", 2, 1700, 1800), item("c", 3, 1600, 1601), item("b", 3, 1500, 1550), item("a", 3, 1650, 1720)];
    assert.deepEqual([...items].sort(chart.byTimelinePriority()).map((i) => i.id), ["a", "b", "c", "d"]);
  });

  test("同順位の決め方は差し替えられる", () => {
    const items = [item("x", 3, 1500, 1600), item("y", 3, 1500, 1501)];
    const shortFirst = (a, b) => a.end - a.start - (b.end - b.start);
    assert.deepEqual([...items].sort(chart.byTimelinePriority(shortFirst)).map((i) => i.id), ["y", "x"]);
  });
});

describe("窓に描くラベル", () => {
  test("省略記号で切る", () => {
    assert.equal(chart.truncateText("三十年戦争", 100, 11), "三十年戦争");
    assert.equal(chart.truncateText("三十年戦争", 33, 11), "三十…");
    assert.equal(chart.truncateText("三十年戦争", 5, 11), "");
  });

  test("左外から続く帯のラベルを左端に貼り付け、次のラベルの手前で切る", () => {
    const halfSpan = 50;
    const events = [
      { id: "war", title: { ja: "とても長い名前の戦争" }, domain: "conflict", importance: 3, kind: "period", start: 1600, end: 1700, places: [] },
      { id: "battle", title: { ja: "会戦" }, domain: "conflict", importance: 3, kind: "instant", start: 1650, places: [] },
    ];
    const layout = layoutFor(events, halfSpan);
    const window = { center: 1690, halfSpan }; // 窓は 1640〜1740。戦争は窓の左外から続く
    const shown = chart.labelsInWindow(layout.labels, window, WIDTH, LABEL);
    const war = shown.find((l) => l.id === "war");
    const battle = shown.find((l) => l.id === "battle");
    assert.ok(war?.pinned && battle !== undefined);
    assert.equal(war.x, LABEL.gap);
    assert.ok(war.text.endsWith("…"), war.text);
    assert.ok(war.x + war.width + LABEL.gap <= battle.x);
    // 現在年（1690）を含むのは戦争だけ
    assert.deepEqual([war.current, battle.current], [true, false]);
  });
});
