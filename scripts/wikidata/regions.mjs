// 座標 → 地域（10区分）。純粋関数のみ。
//
// 方法: Natural Earth 1:50m の国ポリゴンで「現代のどの国の範囲にあるか」を判定し、
// その国の SUBREGION（国連の地理区分にほぼ準拠）を 10 区分に畳む。
// 海上や海岸線の外（1:50m の簡略化で陸から外れた沿岸の点）は、最も近い国に寄せる。
//
// 限界: 現代の国境で切っているので、歴史上の地域概念とは一致しない。
// 例: コンスタンティノープルはトルコ＝「西アジア・北アフリカ」、アナトリア西岸のギリシア植民市も同じ。

export const REGIONS = Object.freeze([
  "europe",
  "wana",
  "subSaharanAfrica",
  "southAsia",
  "eastAsia",
  "southeastAsia",
  "centralNorthAsia",
  "northAmerica",
  "latinAmerica",
  "oceania",
]);

/** @typedef {(typeof REGIONS)[number]} Region */

/** @type {Readonly<Record<Region, string>>} */
export const REGION_LABELS = Object.freeze({
  europe: "ヨーロッパ",
  wana: "西アジア・北アフリカ",
  subSaharanAfrica: "サハラ以南アフリカ",
  southAsia: "南アジア",
  eastAsia: "東アジア",
  southeastAsia: "東南アジア",
  centralNorthAsia: "中央アジア・北アジア",
  northAmerica: "北アメリカ",
  latinAmerica: "中央・南アメリカ",
  oceania: "オセアニア",
});

// Natural Earth の SUBREGION → 10区分（人が編集する表）。
// メキシコとカリブ海は「中央・南アメリカ」。スーダンは Natural Earth（国連区分）に従い北アフリカ。
// アフガニスタンも同じく南アジア。モンゴルは東アジア。
/** @type {Readonly<Record<string, Region>>} */
const REGION_BY_SUBREGION = Object.freeze({
  "Northern Europe": "europe",
  "Western Europe": "europe",
  "Southern Europe": "europe",
  "Eastern Europe": "europe",
  "Western Asia": "wana",
  "Northern Africa": "wana",
  "Eastern Africa": "subSaharanAfrica",
  "Middle Africa": "subSaharanAfrica",
  "Southern Africa": "subSaharanAfrica",
  "Western Africa": "subSaharanAfrica",
  "Southern Asia": "southAsia",
  "Eastern Asia": "eastAsia",
  "South-Eastern Asia": "southeastAsia",
  "Central Asia": "centralNorthAsia",
  "Northern America": "northAmerica",
  "Central America": "latinAmerica",
  Caribbean: "latinAmerica",
  "South America": "latinAmerica",
  "Australia and New Zealand": "oceania",
  Melanesia: "oceania",
  Micronesia: "oceania",
  Polynesia: "oceania",
});

/** ロシアをヨーロッパと北アジアに分ける経度（ウラル山脈のおおよその位置）。 */
const URAL_LON = 60;

/**
 * 国単位の区分では決まらない場合の上書き。
 * @param {string} adm0 Natural Earth の ADM0_A3
 * @param {Region | undefined} region SUBREGION から決まった地域
 * @param {{ lon: number, lat: number }} p
 * @returns {Region | undefined}
 */
const overrideRegion = (adm0, region, { lon, lat }) => {
  // Natural Earth（国連区分）ではイランは南アジアだが、歴史の文脈に合わせて西アジアにする
  if (adm0 === "IRN") return "wana";
  // ロシアはウラル以東（とチュクチ半島の西経部分）を北アジアにする
  if (adm0 === "RUS") return lon >= URAL_LON || lon < 0 ? "centralNorthAsia" : "europe";
  // ハワイはアメリカ合衆国のポリゴンに含まれる
  if (adm0 === "USA" && lon < -140 && lat < 30) return "oceania";
  // ヨーロッパの国のポリゴンに含まれる海外領土（仏領ギアナ、カリブ海、レユニオンなど）
  if (region === "europe" && lon < -30 && lat < 30) return "latinAmerica";
  if (region === "europe" && lon > 40 && lat < 0) return "subSaharanAfrica";
  return region;
};

// ── 幾何 ──────────────────────────────────────────────────

/** @typedef {readonly (readonly [number, number])[]} Ring */
/** @typedef {{ adm0: string, name: string, subregion: string, rings: readonly Ring[], bbox: readonly [number, number, number, number] }} CountryPolygon */

/** @param {Ring} ring @param {number} lon @param {number} lat */
const inRing = (ring, lon, lat) =>
  ring.reduce((inside, [xi, yi], i) => {
    const [xj, yj] = ring[(i + ring.length - 1) % ring.length];
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    return crosses ? !inside : inside;
  }, false);

/** 外周の内側にあり、どの穴の内側にも無い。 @param {CountryPolygon} poly @param {number} lon @param {number} lat */
const inPolygon = (poly, lon, lat) =>
  lon >= poly.bbox[0] &&
  lon <= poly.bbox[2] &&
  lat >= poly.bbox[1] &&
  lat <= poly.bbox[3] &&
  inRing(poly.rings[0], lon, lat) &&
  !poly.rings.slice(1).some((hole) => inRing(hole, lon, lat));

/**
 * 点から外周までの距離（度。経度は cos(緯度) で縮めた正距円筒図法での近似）。
 * @param {CountryPolygon} poly @param {number} lon @param {number} lat
 */
const distanceToPolygon = (poly, lon, lat) => {
  const k = Math.cos((lat * Math.PI) / 180);
  const ring = poly.rings[0];
  return ring.reduce((best, [x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length];
    const [ax, ay, bx, by] = [(x1 - lon) * k, y1 - lat, (x2 - lon) * k, y2 - lat];
    const [dx, dy] = [bx - ax, by - ay];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    return Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }, Infinity);
};

/** 最も近い国に寄せる距離の上限（度）。これより遠い外洋の点は判定不能にする。約 550km。 */
const NEAREST_LIMIT_DEG = 5;

/**
 * GeoJSON（Natural Earth admin-0）から判定用の索引を作る。
 * @param {{ features: readonly any[] }} geojson
 * @returns {readonly CountryPolygon[]}
 */
export const buildCountryIndex = (geojson) =>
  geojson.features.flatMap((f) => {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    return polygons.map((/** @type {Ring[]} */ rings) => {
      const xs = rings[0].map((c) => c[0]);
      const ys = rings[0].map((c) => c[1]);
      return {
        adm0: f.properties.ADM0_A3,
        name: f.properties.NAME,
        subregion: f.properties.SUBREGION,
        rings,
        bbox: /** @type {const} */ ([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]),
      };
    });
  });

/**
 * @param {readonly CountryPolygon[]} index
 * @param {{ lon: number, lat: number }} point
 * @returns {{ region: Region | null, country: string | null, method: "inside" | "nearest" | "none" }}
 */
export const regionOf = (index, point) => {
  const { lon, lat } = point;
  const inside = index.find((poly) => inPolygon(poly, lon, lat));
  const nearest = inside
    ? null
    : index
        .filter(
          (poly) =>
            lon >= poly.bbox[0] - NEAREST_LIMIT_DEG / Math.max(0.1, Math.cos((lat * Math.PI) / 180)) &&
            lon <= poly.bbox[2] + NEAREST_LIMIT_DEG / Math.max(0.1, Math.cos((lat * Math.PI) / 180)) &&
            lat >= poly.bbox[1] - NEAREST_LIMIT_DEG &&
            lat <= poly.bbox[3] + NEAREST_LIMIT_DEG,
        )
        .map((poly) => ({ poly, d: distanceToPolygon(poly, lon, lat) }))
        .filter((x) => x.d <= NEAREST_LIMIT_DEG)
        .reduce((best, x) => (best === null || x.d < best.d ? x : best), /** @type {{ poly: CountryPolygon, d: number } | null} */ (null));
  const hit = inside ?? nearest?.poly ?? null;
  if (!hit) return { region: null, country: null, method: "none" };
  const region = overrideRegion(hit.adm0, REGION_BY_SUBREGION[hit.subregion], point) ?? null;
  return { region, country: hit.name, method: inside ? "inside" : "nearest" };
};
