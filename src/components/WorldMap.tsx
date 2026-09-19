"use client";

import { useEffect, useRef } from "react";
import {
  LngLat,
  Map as MapLibreMap,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
  type TransformConstrainFunction,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { publicPath } from "@/lib/config";
import {
  DOMAIN_COLORS,
  GRAY,
  MAP_COLORS,
  MAP_LINE,
  MARKER,
  SPACE,
  swatchStyle,
  textStyle,
} from "@/lib/design";
import { DOMAINS, DOMAIN_LABELS } from "@/lib/domain";
import type { EventMarkerCollection } from "@/lib/timeline";
import type { Domain } from "@/types/event";

const EVENTS_SOURCE_ID = "events";
const EVENTS_LAYER_ID = "events-circle";

/** domain プロパティから分類色を引く式 */
const markerColor: ExpressionSpecification = [
  "match",
  ["get", "domain"],
  ...DOMAINS.flatMap((domain) => [domain, DOMAIN_COLORS[domain]]),
  GRAY.weak,
] as unknown as ExpressionSpecification;

/**
 * マーカーは常に不透明度 1（縁取りも含む）。凡例で分類を強調しているときだけ、それ以外を下げる。
 * 年の差は不透明度ではなく半径（markerRadius）で表す。
 */
const markerOpacity = (highlighted: Domain | null): ExpressionSpecification | number =>
  highlighted === null
    ? 1
    : ["case", ["==", ["get", "domain"], highlighted], 1, MARKER.dimOpacity];

/** importance による基準半径 × 年の差による倍率（fade）。MARKER.minRadius を下回らない。 */
const markerRadius: ExpressionSpecification = [
  "max",
  [
    "*",
    ["match", ["get", "importance"], 3, MARKER.radius[3], 2, MARKER.radius[2], MARKER.radius[1]],
    ["get", "fade"],
  ],
  MARKER.minRadius,
];

/** 重要度の高いもの・強調中の分類を上に描く */
const markerSortKey = (highlighted: Domain | null): ExpressionSpecification =>
  highlighted === null
    ? ["get", "importance"]
    : ["+", ["get", "importance"], ["case", ["==", ["get", "domain"], highlighted], 10, 0]];

const createStyle = (landUrl: string, markers: EventMarkerCollection): StyleSpecification => ({
  version: 8,
  sources: {
    land: { type: "geojson", data: landUrl },
    [EVENTS_SOURCE_ID]: { type: "geojson", data: markers },
  },
  layers: [
    {
      id: "ocean",
      type: "background",
      paint: { "background-color": MAP_COLORS.ocean },
    },
    {
      id: "land-fill",
      type: "fill",
      source: "land",
      paint: { "fill-color": MAP_COLORS.land },
    },
    {
      id: "coastline",
      type: "line",
      source: "land",
      paint: { "line-color": MAP_LINE.coastlineColor, "line-width": MAP_LINE.coastlineWidth },
    },
    {
      id: EVENTS_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      layout: { "circle-sort-key": markerSortKey(null) },
      paint: {
        "circle-color": markerColor,
        "circle-radius": markerRadius,
        "circle-opacity": markerOpacity(null),
        "circle-stroke-color": MARKER.strokeColor,
        "circle-stroke-width": MARKER.strokeWidth,
        "circle-stroke-opacity": markerOpacity(null),
      },
    },
  ],
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * 既定の制約（renderWorldCopies: false のとき世界が画面の高さを埋めるよう zoom を下限で縛る）だと、
 * 縦長画面で世界全体が収まらない。中心座標だけを世界の範囲に留め、zoom は縛らない。
 */
const constrainCenterOnly: TransformConstrainFunction = (lngLat, zoom) => ({
  center: new LngLat(clamp(lngLat.lng, -180, 180), clamp(lngLat.lat, -85, 85)),
  zoom,
});

interface PopupItem {
  readonly title: string;
  readonly domain: Domain;
}

/** カーソル位置に重なっているマーカー（タイトルで重複除去）。 */
const itemsAt = (event: MapLayerMouseEvent): readonly PopupItem[] => {
  const items = (event.features ?? []).map((f) => ({
    title: String(f.properties?.title ?? ""),
    domain: f.properties?.domain as Domain,
  }));
  return items.filter((item, i) => items.findIndex((other) => other.title === item.title) === i);
};

const px = (value: number): string => `${value}px`;

/** ポップアップの中身。分類は色に頼らずテキストでも示す。 */
const popupContent = (items: readonly PopupItem[]): HTMLElement => {
  const root = document.createElement("div");
  Object.assign(root.style, { display: "flex", flexDirection: "column", gap: px(SPACE[8]) });
  items.forEach(({ title, domain }) => {
    const label = document.createElement("div");
    Object.assign(label.style, {
      display: "flex",
      alignItems: "center",
      gap: px(SPACE[4]),
      fontSize: px(textStyle.caption.fontSize),
      color: textStyle.caption.color,
    });
    const swatch = document.createElement("span");
    const swatchCss = swatchStyle(domain);
    Object.assign(swatch.style, {
      display: "inline-block",
      width: px(Number(swatchCss.width)),
      height: px(Number(swatchCss.height)),
      borderRadius: px(Number(swatchCss.borderRadius)),
      backgroundColor: String(swatchCss.backgroundColor),
    });
    const labelText = document.createElement("span");
    labelText.textContent = DOMAIN_LABELS[domain] ?? "";
    label.append(swatch, labelText);

    const titleEl = document.createElement("div");
    Object.assign(titleEl.style, {
      fontSize: px(textStyle.body.fontSize),
      color: textStyle.body.color,
    });
    titleEl.textContent = title;

    const item = document.createElement("div");
    item.append(label, titleEl);
    root.append(item);
  });
  return root;
};

interface WorldMapProps {
  readonly markers: EventMarkerCollection;
  readonly highlightedDomain: Domain | null;
}

export function WorldMap({ markers, highlightedDomain }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(markers);
  const highlightRef = useRef(highlightedDomain);
  const popupsRef = useRef<readonly Popup[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ワーカーファイルは scripts/copy-maplibre-worker.mjs が public/maplibre/ に配置する。
    setWorkerUrl(publicPath("/maplibre/maplibre-gl-worker.mjs"));
    const map = new MapLibreMap({
      container,
      style: createStyle(publicPath("/geo/ne_110m_land.geojson"), markersRef.current),
      center: [0, 20],
      zoom: 0,
      renderWorldCopies: false,
      transformConstrain: constrainCenterOnly,
      attributionControl: false,
      // 左右キーは年の移動に使うため、地図のキーボード操作は無効にする。
      keyboard: false,
    });
    map.fitBounds(
      [
        [-180, -60],
        [180, 80],
      ],
      { padding: SPACE[16], animate: false },
    );
    mapRef.current = map;

    // style 読み込み前に年や強調が変わっていた場合に備え、読み込み完了時に最新の状態を反映する。
    map.on("load", () => {
      map.getSource<GeoJSONSource>(EVENTS_SOURCE_ID)?.setData(markersRef.current);
      applyHighlight(map, highlightRef.current);
    });

    const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: SPACE[12] });
    const clickPopup = new Popup({ closeButton: true, offset: SPACE[12] });
    popupsRef.current = [hoverPopup, clickPopup];

    map.on("mouseenter", EVENTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mousemove", EVENTS_LAYER_ID, (e) => {
      hoverPopup.setLngLat(e.lngLat).setDOMContent(popupContent(itemsAt(e))).addTo(map);
    });
    map.on("mouseleave", EVENTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });
    // タッチ端末向けにクリックでも表示する。
    map.on("click", EVENTS_LAYER_ID, (e) => {
      hoverPopup.remove();
      clickPopup.setLngLat(e.lngLat).setDOMContent(popupContent(itemsAt(e))).addTo(map);
    });

    return () => {
      mapRef.current = null;
      popupsRef.current = [];
      map.remove();
    };
  }, []);

  useEffect(() => {
    markersRef.current = markers;
    // 年が変わると表示中のマーカーが入れ替わるため、古いタイトルのポップアップは閉じる。
    popupsRef.current.forEach((popup) => popup.remove());
    mapRef.current?.getSource<GeoJSONSource>(EVENTS_SOURCE_ID)?.setData(markers);
  }, [markers]);

  useEffect(() => {
    highlightRef.current = highlightedDomain;
    const map = mapRef.current;
    if (map?.getLayer(EVENTS_LAYER_ID)) applyHighlight(map, highlightedDomain);
  }, [highlightedDomain]);

  // 縦長画面では世界の外側（上下）も見えるため、コンテナ自体も海の色で塗る。
  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: MAP_COLORS.ocean }}
    />
  );
}

const applyHighlight = (map: MapLibreMap, highlighted: Domain | null): void => {
  const opacity = markerOpacity(highlighted);
  map.setPaintProperty(EVENTS_LAYER_ID, "circle-opacity", opacity);
  map.setPaintProperty(EVENTS_LAYER_ID, "circle-stroke-opacity", opacity);
  map.setLayoutProperty(EVENTS_LAYER_ID, "circle-sort-key", markerSortKey(highlighted));
};
