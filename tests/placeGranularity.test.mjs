// 場所の粒度の判定（scripts/wikidata/place-granularity.mjs）を確かめる。R4e-2: 都市のクラスを持つ場所は、行政区画・政治的な領域のクラスより都市を優先する。
//
//   pnpm test
//
// P31 は、2026-09-22 に pnpm wikidata:fetch-places が取得した data/raw/app/place-classes.json の値（一部）を書き写したもの。
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CITY_CLASSES, PLACE_GRANULARITY, granularityOf, isCityOverRegion } from "../scripts/wikidata/place-granularity.mjs";

const P31 = {
  // ロンドン: metropolis / city / global city / national capital / political territorial entity
  london: ["Q200250", "Q1066984", "Q515", "Q208511", "Q174844", "Q51929311", "Q108178728", "Q1048835"],
  // モスクワ: capital of Russia / federal city of Russia / big city / federal subject of Russia / federal capital
  moscow: ["Q4442912", "Q183342", "Q1549591", "Q174844", "Q51929311", "Q7930989", "Q43263", "Q257391", "Q486972", "Q106389302"],
  // ストラスブール: commune of France / big city / border city / free imperial city / state in the Holy Roman Empire
  strasbourg: ["Q484170", "Q1549591", "Q902814", "Q57318", "Q26830017"],
  // エルサレム: city / big city / disputed territory / national capital / city council
  jerusalem: ["Q515", "Q1549591", "Q15239622", "Q108178728", "Q3505887"],
  // シンガポール: sovereign state / city-state / island country / city / national capital
  singapore: ["Q3624078", "Q133442", "Q112099", "Q515", "Q2264924", "Q1549591", "Q6256", "Q208511", "Q108178728"],
  // モナコ: sovereign state / unitary state / principality / city-state / border city / country
  monaco: ["Q3624078", "Q179164", "Q208500", "Q133442", "Q902814", "Q6256"],
  // 香港: special administrative region of China / city / dependent territory / city-state
  hongKong: ["Q779415", "Q515", "Q1549591", "Q200250", "Q208511", "Q161243", "Q133442", "Q125470455"],
  // 鎌倉（Q10939227）: former capital / historical region
  kamakura: ["Q27554677", "Q1620908"],
  // 村のある谷（Q106564809）: village / valley
  villageValley: ["Q532", "Q39816"],
  // ペシャーワル: city / administrative territorial entity / big city
  peshawar: ["Q515", "Q56061", "Q1549591"],
};

describe("granularityOf（R4e-2: 都市を行政区画より優先する）", () => {
  test("都市のクラスを持つ場所は、政治的な領域・行政区画のクラスがあっても fine", () => {
    assert.equal(granularityOf(P31.london), "fine");
    assert.equal(granularityOf(P31.moscow), "fine");
    assert.equal(granularityOf(P31.strasbourg), "fine");
    assert.equal(granularityOf(P31.jerusalem), "fine");
    assert.equal(granularityOf(P31.peshawar), "fine");
  });
  test("国家のクラスは都市に譲らない（都市国家・属領は country のまま）", () => {
    assert.equal(granularityOf(P31.singapore), "country");
    assert.equal(granularityOf(P31.monaco), "country");
    assert.equal(granularityOf(P31.hongKong), "country");
  });
  test("地形・文化的な地域のクラスは都市に譲らない", () => {
    assert.equal(granularityOf(P31.kamakura), "region");
    assert.equal(granularityOf(P31.villageValley), "region");
  });
  test("都市のクラスが無ければ、以前と同じく、いちばん粗いもの", () => {
    assert.equal(granularityOf(["Q56061"]), "region");
    assert.equal(granularityOf(["Q1048835"]), "country");
    assert.equal(granularityOf(["Q56061", "Q3624078"]), "country");
    assert.equal(granularityOf(["Q5107"]), "coarse");
    assert.equal(granularityOf([]), "fine");
    assert.equal(granularityOf(["Q515"]), "fine");
  });
});

describe("isCityOverRegion", () => {
  test("都市の規則が効いた場所だけ true（places の並びで、ほかの fine の後ろに置く）", () => {
    assert.equal(isCityOverRegion(P31.london), true);
    assert.equal(isCityOverRegion(P31.moscow), true);
    assert.equal(isCityOverRegion(["Q515"]), false, "行政区画のクラスの無い都市");
    assert.equal(isCityOverRegion(["Q56061"]), false, "都市のクラスの無い行政区画");
    assert.equal(isCityOverRegion(P31.singapore), false, "国家のクラスは yieldsToCity ではない");
  });
});

describe("表の整合", () => {
  test("都市のクラスは表（region / country / coarse）に入っていない", () => {
    const inTable = new Set(PLACE_GRANULARITY.map((e) => e.qid));
    assert.deepEqual([...CITY_CLASSES.keys()].filter((qid) => inTable.has(qid)), []);
  });
  test("yieldsToCity は region と country のクラスにだけ付く（coarse は大陸・海洋で、都市と併せ持つことは無い）", () => {
    assert.deepEqual(PLACE_GRANULARITY.filter((e) => e.yieldsToCity && e.granularity === "coarse").map((e) => e.qid), []);
  });
  test("都市国家は都市のクラスに入れない", () => {
    assert.equal(CITY_CLASSES.has("Q133442"), false);
    assert.equal(CITY_CLASSES.has("Q4115680"), false);
  });
});
