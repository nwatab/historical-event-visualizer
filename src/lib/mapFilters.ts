import type { ExpressionSpecification } from "maplibre-gl";
import type { Domain, HistEvent, PlaceGranularity } from "@/types/event";
import { COUNTRY_MAX_ZOOM, MIN_ZOOM_BY_IMPORTANCE } from "./timeline";

type Importance = HistEvent["importance"];

const IMPORTANCES: readonly Importance[] = [1, 2, 3];

/** ズーム z で表示する importance の一覧 */
export const importancesVisibleAt = (
  zoom: number,
  thresholds: Readonly<Record<Importance, number>> = MIN_ZOOM_BY_IMPORTANCE,
): readonly Importance[] => IMPORTANCES.filter((i) => thresholds[i] <= zoom);

/** ズーム z で、その粒度の場所を表示するか。country（国の代表点）は COUNTRY_MAX_ZOOM 以上で出さない。 */
export const granularityVisibleAt = (
  zoom: number,
  granularity: PlaceGranularity,
  countryMaxZoom: number = COUNTRY_MAX_ZOOM,
): boolean => granularity !== "country" || zoom < countryMaxZoom;

/**
 * マーカーの表示条件（MapLibre の filter 式）。
 * - 非表示の分類を除く
 * - 地図に出さない項目（placeKind が "none"。国の代表点しか無い項目など）を除く
 * - ズームに応じて importance で絞る（ズームを変えても GeoJSON は作り直さない）
 * - 粒度が country の場所は、COUNTRY_MAX_ZOOM 以上で除く（拡大すると、国の重心は場所として嘘になるため）。
 *   ラベルのレイヤもこの式を使うので、ラベルも同じズームで消える
 * 式は ["step", ["zoom"], …] の1段構成にし、分類などの条件は各段に入れている。
 * extra を渡すと、その条件も各段に加える（選択中のマーカーの強調レイヤーで使う）。
 */
export const markerFilter = (
  hiddenDomains: readonly Domain[],
  extra: ExpressionSpecification | null = null,
  thresholds: Readonly<Record<Importance, number>> = MIN_ZOOM_BY_IMPORTANCE,
  countryMaxZoom: number = COUNTRY_MAX_ZOOM,
): ExpressionSpecification => {
  const domainVisible: ExpressionSpecification = [
    "!",
    ["in", ["get", "domain"], ["literal", [...hiddenDomains]]],
  ];
  const onMap: ExpressionSpecification = ["!=", ["get", "placeKind"], "none"];
  const notCountry: ExpressionSpecification = ["!=", ["get", "granularity"], "country"];
  const at = (zoom: number): ExpressionSpecification =>
    [
      "all",
      domainVisible,
      onMap,
      ["in", ["get", "importance"], ["literal", [...importancesVisibleAt(zoom, thresholds)]]],
      ...(granularityVisibleAt(zoom, "country", countryMaxZoom) ? [] : [notCountry]),
      ...(extra === null ? [] : [extra]),
    ] as ExpressionSpecification;
  const stops = [...new Set([...Object.values(thresholds), countryMaxZoom].filter(Number.isFinite))].sort((a, b) => a - b);
  if (stops.length === 0) return at(-Infinity);
  return [
    "step",
    ["zoom"],
    at(-Infinity),
    ...stops.flatMap((zoom) => [zoom, at(zoom)]),
  ] as unknown as ExpressionSpecification;
};
