import type { FeatureCollection, Point } from "geojson";
import type { Domain, HistEvent, Year } from "@/types/event";

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

export interface EventMarkerProperties {
  readonly id: string;
  readonly title: string;
  readonly domain: Domain;
  readonly importance: HistEvent["importance"];
  /** 年の差に応じた大きさの倍率（EVENT_EDGE_SCALE〜1） */
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

/** 現在年に表示すべき instant イベントを、places の全点ぶんのマーカーに展開する。 */
export const instantEventMarkers = (
  events: readonly HistEvent[],
  year: Year,
): EventMarkerCollection => ({
  type: "FeatureCollection",
  features: events
    .filter((event) => event.kind === "instant")
    .flatMap((event) => {
      const fade = eventFade(event.start, year);
      if (fade === null) return [];
      return event.places.map((place) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
        properties: {
          id: event.id,
          title: event.title.ja,
          domain: event.domain,
          importance: event.importance,
          fade,
        },
      }));
    }),
});
