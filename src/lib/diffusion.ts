import type { FeatureCollection, MultiLineString } from "geojson";
import type { Domain, HistEvent, Place, PlaceKind, Year } from "@/types/event";
import { greatCircle, splitAtAntimeridian, type LonLat } from "./geo";
import { markerFade, reachedStages } from "./timeline";

/*
 * diffusion（時間とともに地理的に広がる出来事）の経路。起点・到達点のマーカーは timeline.ts の eventMarkers が作る。
 */

/** 経路の 1 本ぶんの線を何分割するか（大圏の線を折れ線で近似する） */
export const DIFFUSION_LINE_SEGMENTS = 20;

/** マーカーと同じ名前のプロパティを持たせ、表示条件（mapFilters.ts の markerFilter）をそのまま使えるようにする。 */
export interface DiffusionLineProperties {
  readonly id: string;
  readonly domain: Domain;
  readonly importance: HistEvent["importance"];
  readonly placeKind: PlaceKind;
  /** 線そのものに粒度は無い。国の代表点を除く条件（COUNTRY_MAX_ZOOM）に掛からないように、常に "fine" */
  readonly granularity: "fine";
  /** 太さの倍率。マーカーの fade と同じ値（期間中は 1、end の後は縮める） */
  readonly fade: number;
}

/** 1 本の経路は、180 度の経線をまたぐと 2 本に分かれるので、MultiLineString にしている */
export type DiffusionLineCollection = FeatureCollection<MultiLineString, DiffusionLineProperties>;

const lonLat = (place: Place): LonLat => [place.lon, place.lat];

/**
 * 現在年までに到達した stage への線（from → stage）。まだ到達していない stage への線は描かない。
 * from が起点（-1）なら places の最初の 1 点から。from の指す stage が無い（データの誤り）なら、その線は出さない。
 */
export const diffusionLines = (events: readonly HistEvent[], year: Year): DiffusionLineCollection => ({
  type: "FeatureCollection",
  features: events.flatMap((event) => {
    if (event.kind !== "diffusion") return [];
    const fade = markerFade(event, year);
    const origin = event.places[0];
    if (fade === null || origin === undefined) return [];
    return reachedStages(event, year).flatMap(({ stage, from }) => {
      const source = from === -1 ? origin : event.stages?.[from]?.place;
      if (source === undefined) return [];
      return [
        {
          type: "Feature" as const,
          geometry: {
            type: "MultiLineString" as const,
            coordinates: splitAtAntimeridian(greatCircle(lonLat(source), lonLat(stage.place), DIFFUSION_LINE_SEGMENTS)).map((line) =>
              line.map(([lon, lat]) => [lon, lat]),
            ),
          },
          properties: {
            id: event.id,
            domain: event.domain,
            importance: event.importance,
            placeKind: event.placeKind ?? "point",
            granularity: "fine" as const,
            fade,
          },
        },
      ];
    });
  }),
});
