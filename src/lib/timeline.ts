import type { FeatureCollection, Point } from "geojson";
import type { Domain, HistEvent, Year } from "@/types/event";

/** 年スライダーの範囲（天文年）。 */
export const YEAR_MIN: Year = -3000;
export const YEAR_MAX: Year = 2025;
export const INITIAL_YEAR: Year = 1687;

/** instant イベントを表示する窓幅。|start - 現在年| がこの値以下なら表示する。 */
export const EVENT_WINDOW_YEARS = 20;

/** 窓の端（差 = EVENT_WINDOW_YEARS）での不透明度。差 0 で 1。 */
export const EVENT_EDGE_OPACITY = 0.15;

export interface EventMarkerProperties {
  readonly id: string;
  readonly title: string;
  readonly domain: Domain;
  readonly importance: HistEvent["importance"];
  readonly opacity: number;
}

export type EventMarkerCollection = FeatureCollection<Point, EventMarkerProperties>;

/** 現在年との差から不透明度を求める。窓の外なら null。 */
export const eventOpacity = (
  start: Year,
  year: Year,
  windowYears: number = EVENT_WINDOW_YEARS,
): number | null => {
  const distance = Math.abs(start - year);
  if (distance > windowYears) return null;
  if (windowYears === 0) return 1;
  return 1 - (1 - EVENT_EDGE_OPACITY) * (distance / windowYears);
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
      const opacity = eventOpacity(event.start, year);
      if (opacity === null) return [];
      return event.places.map((place) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
        properties: {
          id: event.id,
          title: event.title.ja,
          domain: event.domain,
          importance: event.importance,
          opacity,
        },
      }));
    }),
});
