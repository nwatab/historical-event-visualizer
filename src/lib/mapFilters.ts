import type { ExpressionSpecification } from "maplibre-gl";
import type { Domain, HistEvent } from "@/types/event";
import { MIN_ZOOM_BY_IMPORTANCE } from "./timeline";

type Importance = HistEvent["importance"];

const IMPORTANCES: readonly Importance[] = [1, 2, 3];

/** ズーム z で表示する importance の一覧 */
export const importancesVisibleAt = (
  zoom: number,
  thresholds: Readonly<Record<Importance, number>> = MIN_ZOOM_BY_IMPORTANCE,
): readonly Importance[] => IMPORTANCES.filter((i) => thresholds[i] <= zoom);

/**
 * マーカーの表示条件（MapLibre の filter 式）。
 * - 非表示の分類を除く
 * - ズームに応じて importance で絞る（ズームを変えても GeoJSON は作り直さない）
 * 式は ["step", ["zoom"], …] の1段構成にし、分類などの条件は各段に入れている。
 * extra を渡すと、その条件も各段に加える（選択中のマーカーの強調レイヤーで使う）。
 */
export const markerFilter = (
  hiddenDomains: readonly Domain[],
  extra: ExpressionSpecification | null = null,
  thresholds: Readonly<Record<Importance, number>> = MIN_ZOOM_BY_IMPORTANCE,
): ExpressionSpecification => {
  const domainVisible: ExpressionSpecification = [
    "!",
    ["in", ["get", "domain"], ["literal", [...hiddenDomains]]],
  ];
  const at = (zoom: number): ExpressionSpecification =>
    [
      "all",
      domainVisible,
      ["in", ["get", "importance"], ["literal", [...importancesVisibleAt(zoom, thresholds)]]],
      ...(extra === null ? [] : [extra]),
    ] as ExpressionSpecification;
  const stops = [...new Set(Object.values(thresholds).filter(Number.isFinite))].sort((a, b) => a - b);
  if (stops.length === 0) return at(Infinity);
  return [
    "step",
    ["zoom"],
    at(-Infinity),
    ...stops.flatMap((zoom) => [zoom, at(zoom)]),
  ] as unknown as ExpressionSpecification;
};
