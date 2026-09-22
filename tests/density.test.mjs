// 密度による繰り上げ（R6e。src/lib/timeline.ts の densityRuns など）を確かめる。
//
//   pnpm test
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { APP_DATA_DIR, APP_YEAR_MAX, APP_YEAR_MIN } from "../scripts/wikidata/config.mjs";
import { importFromSrc } from "../scripts/wikidata/load-ts.mjs";

const [timeline, { mergeEventFiles }] = await Promise.all([importFromSrc("lib/timeline.ts"), importFromSrc("lib/eventData.ts")]);
const { mapSpan, markerFade, eventCountsByYear, movingAverage, densityLevelOf, densityRuns, densityLevelAt, DENSITY_FLOOR, DENSITY_WINDOW_YEARS } = timeline;

const place = { lon: 0, lat: 0, label: "x" };
const instant = (id, start, importance = 3) => ({ id, title: { ja: id }, domain: "culture", tags: [], kind: "instant", start, places: [place], importance, source: "" });
const period = (id, start, end, importance = 3) => ({ ...instant(id, start, importance), kind: "period", end });
const diffusion = (id, start, end, stageYears, importance = 3) => ({
  ...period(id, start, end, importance),
  kind: "diffusion",
  stages: stageYears.map((year) => ({ year, place })),
});

describe("mapSpan", () => {
  test("markerFade が null でない年と一致する（instant / period / diffusion）", () => {
    for (const event of [instant("a", 100), period("b", 100, 130), diffusion("c", 100, 110, [102, 105])]) {
      const [from, to] = mapSpan(event);
      for (let year = 50; year <= 180; year++) assert.equal(markerFade(event, year) !== null, from <= year && year <= to, `${event.kind} ${year}`);
    }
  });
  test("地図に出ない項目（places が空）は null", () => {
    assert.equal(mapSpan({ ...instant("a", 100), places: [], placeKind: "none" }), null);
  });
});

describe("eventCountsByYear", () => {
  test("数えるのはイベントで、diffusion の到達点の数ではない", () => {
    const counts = eventCountsByYear([diffusion("d", 100, 110, [101, 102, 103, 104, 105])], 3, 100, 110);
    assert.deepEqual([...counts], new Array(11).fill(1));
  });
  test("importance で分けて数え、範囲の外は切る", () => {
    const events = [instant("a", 100), instant("b", 100, 2), period("c", 95, 105)];
    assert.deepEqual([...eventCountsByYear(events, 3, 100, 105)], [2, 2, 2, 2, 2, 2]);
    assert.deepEqual([...eventCountsByYear(events, 3, 106, 121)], [...new Array(15).fill(1), 0]);
    assert.deepEqual([...eventCountsByYear(events, 2, 100, 101)], [1, 1]);
  });
});

describe("movingAverage", () => {
  test("前後 ±w の平均。端は範囲の中の値だけで平均する", () => {
    assert.deepEqual([...movingAverage([0, 3, 6, 9], 1)], [1.5, 3, 6, 7.5]);
    assert.deepEqual([...movingAverage([4, 8], 0)], [4, 8]);
  });
});

describe("densityLevelOf", () => {
  test("importance 3 が下限以上なら 0、3 と 2 の合計が下限以上なら 1、それ以外は 2", () => {
    assert.equal(densityLevelOf(15, 0, 15), 0);
    assert.equal(densityLevelOf(14.9, 0.1, 15), 1);
    assert.equal(densityLevelOf(10, 4.9, 15), 2);
  });
});

describe("densityRuns / densityLevelAt", () => {
  // importance 3 のイベント数が、年ごとに下限の前後（14 と 18。平均は約 16）を交互に行き来する
  const oscillating = Array.from({ length: 60 }, (_, i) => i).flatMap((i) =>
    Array.from({ length: i % 2 === 0 ? 14 : 18 }, (_, k) => period(`p${i}-${k}`, 1000 + i, 1000 + i)),
  );
  test("その年だけの値（窓 0）だと毎年切り替わるが、平均すると切り替わらない", () => {
    assert.ok(densityRuns(oscillating, 1010, 1049, 0, DENSITY_FLOOR).length > 30);
    assert.deepEqual(densityRuns(oscillating, 1010, 1049, DENSITY_WINDOW_YEARS, DENSITY_FLOOR), [[1010, 0]]);
  });
  test("同じ段階の続く年はまとめ、表から年ごとの段階を引ける", () => {
    const events = [...Array.from({ length: 15 }, (_, k) => period(`a${k}`, 200, 300)), ...Array.from({ length: 15 }, (_, k) => period(`b${k}`, 100, 400, 2))];
    const runs = densityRuns(events, 0, 500, 0, 15);
    assert.deepEqual(runs, [[0, 2], [100, 1], [200, 0], [301, 1], [401, 2]]);
    assert.equal(densityLevelAt(runs, 250), 0);
    assert.equal(densityLevelAt(runs, 300), 0);
    assert.equal(densityLevelAt(runs, 301), 1);
    assert.equal(densityLevelAt(runs, -10), 0, "表より前の年は繰り上げない");
    assert.equal(densityLevelAt([], 250), 0, "表が空なら繰り上げない");
  });
  test("分類（domain）は数え方に効かない（分類を非表示にしても段階は変わらない）", () => {
    const events = Array.from({ length: 20 }, (_, k) => ({ ...period(`c${k}`, 0, 10), domain: k % 2 === 0 ? "conflict" : "science" }));
    const runs = densityRuns(events, 0, 10, 0, 15);
    assert.deepEqual(runs, densityRuns(events.map((e) => ({ ...e, domain: "culture" })), 0, 10, 0, 15));
  });
});

describe("生成データ（public/data/events/）", async () => {
  const names = (await readdir(APP_DATA_DIR)).filter((f) => /^-?\d+\.json$/.test(f));
  const events = mergeEventFiles(await Promise.all(names.map(async (f) => JSON.parse(await readFile(join(APP_DATA_DIR, f), "utf8")))));
  const manifest = JSON.parse(await readFile(join(APP_DATA_DIR, "manifest.json"), "utf8"));
  test("manifest の表は、いまのデータと定数から計算したものと一致する（データや定数を変えたら build-app-data を回す）", () => {
    assert.equal(manifest.density.windowYears, DENSITY_WINDOW_YEARS);
    assert.equal(manifest.density.floor, DENSITY_FLOOR);
    assert.deepEqual(manifest.density.runs, densityRuns(events, APP_YEAR_MIN, APP_YEAR_MAX));
  });
  test("製紙法の伝播（importance 2）は、1000〜1050 年に世界全体の表示に出る（繰り上げの段階が 1 以上）", () => {
    for (let year = 1000; year <= 1050; year++) assert.ok(densityLevelAt(manifest.density.runs, year) >= 1, `${year}`);
  });
});
