"use client";

import { useEffect, useRef } from "react";
import {
  LngLat,
  Map as MapLibreMap,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
  type TransformConstrainFunction,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { publicPath } from "@/lib/config";
import type { EventMarkerCollection } from "@/lib/timeline";

const OCEAN_COLOR = "#a8c8e0";
const LAND_COLOR = "#e8e0c8";
const COASTLINE_COLOR = "#7a7060";
const EVENT_COLOR = "#b3261e";

const EVENTS_SOURCE_ID = "events";
const EVENTS_LAYER_ID = "events-circle";

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
      paint: { "background-color": OCEAN_COLOR },
    },
    {
      id: "land-fill",
      type: "fill",
      source: "land",
      paint: { "fill-color": LAND_COLOR },
    },
    {
      id: "land-outline",
      type: "line",
      source: "land",
      paint: { "line-color": COASTLINE_COLOR, "line-width": 0.5 },
    },
    {
      id: EVENTS_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      paint: {
        "circle-color": EVENT_COLOR,
        "circle-radius": ["match", ["get", "importance"], 3, 8, 2, 6, 4],
        "circle-opacity": ["get", "opacity"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
        "circle-stroke-opacity": ["get", "opacity"],
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

/** カーソル位置に重なっているマーカーのタイトル（重複除去）。 */
const titlesAt = (event: MapLayerMouseEvent): readonly string[] => [
  ...new Set((event.features ?? []).map((f) => String(f.properties?.title ?? ""))),
];

const popupContent = (titles: readonly string[]): HTMLElement => {
  const root = document.createElement("div");
  root.className = "text-sm leading-snug";
  titles.forEach((title) => {
    const line = document.createElement("div");
    line.textContent = title;
    root.append(line);
  });
  return root;
};

interface WorldMapProps {
  readonly markers: EventMarkerCollection;
}

export function WorldMap({ markers }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(markers);
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
      { padding: 16, animate: false },
    );
    mapRef.current = map;

    // style 読み込み前に年が変わっていた場合に備え、読み込み完了時に最新データを反映する。
    map.on("load", () => {
      map.getSource<GeoJSONSource>(EVENTS_SOURCE_ID)?.setData(markersRef.current);
    });

    const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    const clickPopup = new Popup({ closeButton: true, offset: 10 });
    popupsRef.current = [hoverPopup, clickPopup];

    map.on("mouseenter", EVENTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mousemove", EVENTS_LAYER_ID, (e) => {
      hoverPopup.setLngLat(e.lngLat).setDOMContent(popupContent(titlesAt(e))).addTo(map);
    });
    map.on("mouseleave", EVENTS_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });
    // タッチ端末向けにクリックでも表示する。
    map.on("click", EVENTS_LAYER_ID, (e) => {
      hoverPopup.remove();
      clickPopup.setLngLat(e.lngLat).setDOMContent(popupContent(titlesAt(e))).addTo(map);
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

  // 縦長画面では世界の外側（上下）も見えるため、コンテナ自体も海の色で塗る。
  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: OCEAN_COLOR }}
    />
  );
}
