import type { FeatureCollection, Point } from "geojson";
import type { Domain, HistEvent, PlaceKind, TemporalKind, Year } from "@/types/event";

/** 年スライダーの範囲（天文年）。 */
export const YEAR_MIN: Year = -3000;
export const YEAR_MAX: Year = 2025;
export const INITIAL_YEAR: Year = 1687;

/** instant イベントを表示する窓幅。|start - 現在年| がこの値以下なら表示する。 */
export const EVENT_WINDOW_YEARS = 20;

/**
 * 窓の端（差 = EVENT_WINDOW_YEARS）でのマーカーの大きさの倍率。差 0 で 1。
 * 年の差は不透明度ではなく大きさで表す（不透明度を下げると色の識別性とコントラストが失われるため）。
 */
export const EVENT_EDGE_SCALE = 0.5;

/** 地図に描く時間種別。diffusion は R6 で実装する（それまでは地図に出さない）。 */
export type MarkerKind = Extract<TemporalKind, "instant" | "period">;

export interface EventMarkerProperties {
  readonly id: string;
  readonly title: string;
  readonly domain: Domain;
  readonly importance: HistEvent["importance"];
  readonly kind: MarkerKind;
  /** "none" は地図に出さない（mapFilters.ts の filter 式で除く） */
  readonly placeKind: PlaceKind;
  /** 年の差に応じた大きさの倍率（EVENT_EDGE_SCALE〜1）。period は常に 1。 */
  readonly fade: number;
}

export type EventMarkerCollection = FeatureCollection<Point, EventMarkerProperties>;

/** 現在年との差から大きさの倍率を求める。窓の外なら null。 */
export const eventFade = (
  start: Year,
  year: Year,
  windowYears: number = EVENT_WINDOW_YEARS,
): number | null => {
  const distance = Math.abs(start - year);
  if (distance > windowYears) return null;
  if (windowYears === 0) return 1;
  return 1 - (1 - EVENT_EDGE_SCALE) * (distance / windowYears);
};

/**
 * period は start 以上 end 以下の年に表示する（両端を含む）。窓による前後の延長はしない。
 * 大きさは常に 1 倍。期間中はその出来事が「進行中」で、現在年との差が 0 にあたるため。
 * 開始・終了からの距離で縮めると、期間の端で「起きていない」ように見えてしまう。
 */
export const periodFade = (start: Year, end: Year, year: Year): number | null =>
  start <= year && year <= end ? 1 : null;

/** 現在年での大きさの倍率。表示しないなら null。 */
const markerFade = (event: HistEvent, year: Year): number | null => {
  switch (event.kind) {
    case "instant":
      return eventFade(event.start, year);
    case "period":
      return event.end === undefined ? null : periodFade(event.start, event.end, year);
    case "diffusion":
      return null;
  }
};

/** 現在年に表示すべき instant / period イベントを、places の全点ぶんのマーカーに展開する。 */
export const eventMarkers = (
  events: readonly HistEvent[],
  year: Year,
): EventMarkerCollection => ({
  type: "FeatureCollection",
  features: events.flatMap((event) => {
    const fade = markerFade(event, year);
    if (fade === null || event.kind === "diffusion") return [];
    const kind: MarkerKind = event.kind;
    return event.places.map((place) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
      properties: {
        id: event.id,
        title: event.title.ja,
        domain: event.domain,
        importance: event.importance,
        kind,
        placeKind: event.placeKind ?? "point",
        fade,
      },
    }));
  }),
});

/** 一覧（場所を特定できない出来事）に、絞り込まずに出す件数の上限。超えたら importance 3 だけにする。 */
export const PLACELESS_LIST_LIMIT = 12;

/**
 * 現在年の窓に入る、地図に出さないイベント（placeKind が "none"）。窓の判定はマーカーと同じ。
 * 件数が多いときは importance 3 だけにする。並びは重要度の高い順、同じなら現在年に近い順。
 */
export const placelessEvents = (
  events: readonly HistEvent[],
  year: Year,
  hiddenDomains: readonly Domain[],
  limit: number = PLACELESS_LIST_LIMIT,
): { readonly shown: readonly HistEvent[]; readonly total: number } => {
  const inWindow = events
    .filter((e) => e.placeKind === "none" && !hiddenDomains.includes(e.domain) && markerFade(e, year) !== null)
    .sort((a, b) => b.importance - a.importance || Math.abs(a.start - year) - Math.abs(b.start - year));
  const shown = inWindow.length > limit ? inWindow.filter((e) => e.importance === 3) : inWindow;
  return { shown, total: inWindow.length };
};

/**
 * importance ごとの表示を始めるズームレベル。ズームがこの値以上のときに表示する。
 * 値を変えれば調整できる（-Infinity は常に表示）。世界全体の初期表示は、幅の広い画面で zoom ≈ 1.3、
 * 縦長の画面で ≈ -0.6 なので、どちらでも importance 3 だけが出る。
 *
 * 世界全体の表示（zoom 1.3 でも -0.6 でも同じ）でのマーカー数は、1500年 13、1800年 53、1950年 125
 * （2026-09-20 に生成したデータを scripts/wikidata/count-markers.mjs で数えた実測値。地図に出ない項目は除く）。
 * 上限の目安にしている 500 を下回るので、閾値は 3 → 常時、2 → zoom 2 以上、1 → zoom 4 以上とした。
 * zoom 2 では全世界で 120 / 414 / 909、zoom 4 では 252 / 1584 / 2493（画面に入るのはその一部）。
 * データを作り直したら数え直すこと（CLAUDE.md「データパイプライン」）。
 */
export const MIN_ZOOM_BY_IMPORTANCE: Readonly<Record<HistEvent["importance"], number>> = {
  3: -Infinity,
  2: 2,
  1: 4,
};
