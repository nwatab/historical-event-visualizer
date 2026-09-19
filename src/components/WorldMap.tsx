"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { publicPath } from "@/lib/config";

const OCEAN_COLOR = "#a8c8e0";
const LAND_COLOR = "#e8e0c8";
const COASTLINE_COLOR = "#7a7060";

const createStyle = (landUrl: string): StyleSpecification => ({
  version: 8,
  sources: {
    land: { type: "geojson", data: landUrl },
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
  ],
});

export function WorldMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ワーカーファイルは scripts/copy-maplibre-worker.mjs が public/maplibre/ に配置する。
    setWorkerUrl(publicPath("/maplibre/maplibre-gl-worker.mjs"));
    const map = new MapLibreMap({
      container,
      style: createStyle(publicPath("/geo/ne_110m_land.geojson")),
      center: [0, 20],
      zoom: 0,
      renderWorldCopies: false,
      attributionControl: false,
    });
    map.fitBounds(
      [
        [-180, -60],
        [180, 80],
      ],
      { padding: 16, animate: false },
    );

    return () => map.remove();
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
