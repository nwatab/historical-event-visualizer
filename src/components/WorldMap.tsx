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
  MAP_LABEL,
  MAP_LINE,
  MARKER,
  MARKER_HIT_TOLERANCE,
  SELECTION_RING,
  SPACE,
  swatchStyle,
  textStyle,
} from "@/lib/design";
import { DOMAINS, DOMAIN_LABELS } from "@/lib/domain";
import { markerFilter } from "@/lib/mapFilters";
import { LABEL_MIN_ZOOM_BY_IMPORTANCE, type EventMarkerCollection, type MarkerKind } from "@/lib/timeline";
import type { Domain } from "@/types/event";

const EVENTS_SOURCE_ID = "events";
const EVENTS_LAYER_ID = "events-circle";
const PERIOD_HALO_LAYER_ID = "events-period-halo";
const PERIOD_LAYER_ID = "events-period";
const SELECTED_LAYER_ID = "events-selected";
const LABEL_LAYER_ID = "events-label";

/** ホバーの対象になるレイヤー */
const INTERACTIVE_LAYER_IDS = [EVENTS_LAYER_ID, PERIOD_LAYER_ID];
/** クリックで選択できるレイヤー。ラベルをクリックしても、そのイベントを選ぶ */
const CLICKABLE_LAYER_IDS = [...INTERACTIVE_LAYER_IDS, LABEL_LAYER_ID];

const kindIs = (kind: MarkerKind): ExpressionSpecification => ["==", ["get", "kind"], kind];

/** マーカーのレイヤーと、それぞれが描く時間種別 */
const MARKER_LAYERS: readonly { readonly id: string; readonly kind: MarkerKind }[] = [
  { id: PERIOD_HALO_LAYER_ID, kind: "period" },
  { id: PERIOD_LAYER_ID, kind: "period" },
  { id: EVENTS_LAYER_ID, kind: "instant" },
];

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

/** period の輪の内側（白で抜く部分）の半径。輪の太さは markerRadius との差。 */
const periodHoleRadius: ExpressionSpecification = ["*", markerRadius, MARKER.periodHoleRatio];

/** 重要度の高いもの・強調中の分類を上に描く */
const markerSortKey = (highlighted: Domain | null): ExpressionSpecification =>
  highlighted === null
    ? ["get", "importance"]
    : ["+", ["get", "importance"], ["case", ["==", ["get", "domain"], highlighted], 10, 0]];

/** ラベルを出す条件。マーカーの表示条件に加えて、ラベル用のズームの閾値と「places の最初の1点だけ」を掛ける。 */
const labelFilter = (hiddenDomains: readonly Domain[]): ExpressionSpecification =>
  markerFilter(hiddenDomains, ["==", ["get", "primary"], true], LABEL_MIN_ZOOM_BY_IMPORTANCE);

/** マーカーの白い縁取りの外側から MAP_LABEL.gap だけ離す（text-radial-offset は em 単位）。 */
const labelOffset: ExpressionSpecification = [
  "/",
  ["+", markerRadius, MARKER.strokeWidth + MAP_LABEL.gap],
  MAP_LABEL.fontSize,
];

/**
 * ラベルを置く優先順。symbol-sort-key は小さいほど先に置かれる（＝重なったときに残る）ので、
 * importance の高いもの、同じなら現在年に近いもの（fade が大きいもの）ほど小さくする。
 */
const labelSortKey: ExpressionSpecification = ["-", 0, ["+", ["*", ["get", "importance"], 10], ["get", "fade"]]];

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
    // period: 中抜きの輪。白い縁取り（下のレイヤー）の上に、白い中心と分類色の輪を描く。
    // 外径は instant と同じ（半径 + 縁取り 2px）で、輪の色が接するのは白だけ。
    {
      id: PERIOD_HALO_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      filter: markerFilter([], kindIs("period")),
      layout: { "circle-sort-key": markerSortKey(null) },
      paint: {
        "circle-color": MARKER.strokeColor,
        "circle-radius": markerRadius,
        "circle-opacity": markerOpacity(null),
        "circle-stroke-color": MARKER.strokeColor,
        "circle-stroke-width": MARKER.strokeWidth,
        "circle-stroke-opacity": markerOpacity(null),
      },
    },
    {
      id: PERIOD_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      filter: markerFilter([], kindIs("period")),
      layout: { "circle-sort-key": markerSortKey(null) },
      paint: {
        "circle-color": MARKER.strokeColor,
        "circle-radius": periodHoleRadius,
        "circle-opacity": markerOpacity(null),
        "circle-stroke-color": markerColor,
        "circle-stroke-width": ["-", markerRadius, periodHoleRadius],
        "circle-stroke-opacity": markerOpacity(null),
      },
    },
    // instant: 塗りつぶしの円。period より上に描く。
    {
      id: EVENTS_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      filter: markerFilter([], kindIs("instant")),
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
    {
      // 選択中のマーカーに、白い縁取りの外側の輪を付ける
      id: SELECTED_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      filter: selectedFilter([], []),
      paint: {
        "circle-radius": ["+", markerRadius, MARKER.strokeWidth],
        "circle-opacity": 0,
        "circle-stroke-color": SELECTION_RING.color,
        "circle-stroke-width": SELECTION_RING.width,
      },
    },
    // イベント名のラベル。instant も period も出す。重なるものは MapLibre が間引く。
    // スタイルに glyphs の URL を置いていないので、文字は端末のフォントで描かれる（design.ts の MAP_LABEL）。
    {
      id: LABEL_LAYER_ID,
      type: "symbol",
      source: EVENTS_SOURCE_ID,
      filter: labelFilter([]),
      layout: {
        "text-field": ["get", "title"],
        "text-font": [...MAP_LABEL.fontStack],
        "text-size": MAP_LABEL.fontSize,
        // マーカーの横（右）を第一候補にし、置けなければ左・上・下を試す
        "text-variable-anchor": ["left", "right", "top", "bottom"],
        "text-radial-offset": labelOffset,
        "text-justify": "auto",
        "text-allow-overlap": false,
        "symbol-sort-key": labelSortKey,
      },
      paint: {
        "text-color": MAP_LABEL.color,
        "text-halo-color": MAP_LABEL.haloColor,
        "text-halo-width": MAP_LABEL.haloWidth,
        "text-opacity": markerOpacity(null),
      },
    },
  ],
});

/** 選択中のイベント（表示条件を満たすもの）だけに輪を付けるための filter */
const selectedFilter = (hiddenDomains: readonly Domain[], selectedIds: readonly string[]) =>
  markerFilter(hiddenDomains, ["in", ["get", "id"], ["literal", [...selectedIds]]]);

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
  readonly hiddenDomains: readonly Domain[];
  /** 詳細パネルで選択中のイベント（地図上で輪を付ける） */
  readonly selectedIds: readonly string[];
  /** マーカー（またはラベル）をクリックしたとき。重なっていれば複数の id が渡る。 */
  readonly onSelectEvents: (eventIds: readonly string[]) => void;
  /** 地図の何もない所をクリックしたとき */
  readonly onClickEmpty: () => void;
}

/** 地図に反映する表示状態 */
interface MapViewState {
  readonly highlightedDomain: Domain | null;
  readonly hiddenDomains: readonly Domain[];
  readonly selectedIds: readonly string[];
}

export function WorldMap({
  markers,
  highlightedDomain,
  hiddenDomains,
  selectedIds,
  onSelectEvents,
  onClickEmpty,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(markers);
  const viewRef = useRef<MapViewState>({ highlightedDomain, hiddenDomains, selectedIds });
  const onSelectRef = useRef(onSelectEvents);
  const onClickEmptyRef = useRef(onClickEmpty);
  const hoverPopupRef = useRef<Popup | null>(null);

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
    // 開発時だけ、ブラウザのコンソールや自動検証から地図を調べられるようにする（本番ビルドには含まれない）
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __hvMap?: MapLibreMap }).__hvMap = map;
    }

    // style 読み込み前に年や強調が変わっていた場合に備え、読み込み完了時に最新の状態を反映する。
    map.on("load", () => {
      map.getSource<GeoJSONSource>(EVENTS_SOURCE_ID)?.setData(markersRef.current);
      applyViewState(map, viewRef.current);
    });

    const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: SPACE[12] });
    hoverPopupRef.current = hoverPopup;

    map.on("mouseenter", INTERACTIVE_LAYER_IDS, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mousemove", INTERACTIVE_LAYER_IDS, (e) => {
      hoverPopup.setLngLat(e.lngLat).setDOMContent(popupContent(itemsAt(e))).addTo(map);
    });
    map.on("mouseleave", INTERACTIVE_LAYER_IDS, () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });
    // クリック（タップ）で詳細パネルを開く。小さいマーカーも選べるよう、判定に余裕を持たせる。
    // 何もない所のクリックは親に知らせる（詳細パネルを閉じる）。ドラッグでの移動は click にならない。
    map.on("click", (e) => {
      const t = MARKER_HIT_TOLERANCE;
      const features = map.queryRenderedFeatures(
        [
          [e.point.x - t, e.point.y - t],
          [e.point.x + t, e.point.y + t],
        ],
        { layers: CLICKABLE_LAYER_IDS },
      );
      if (features.length === 0) {
        onClickEmptyRef.current();
        return;
      }
      hoverPopup.remove();
      // 同じイベントのマーカーとラベルの両方に当たることがあるので、id の重複を除く
      onSelectRef.current([...new Set(features.map((f) => String(f.properties?.id ?? "")))]);
    });

    return () => {
      mapRef.current = null;
      hoverPopupRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    markersRef.current = markers;
    // 年が変わると表示中のマーカーが入れ替わるため、古いタイトルのポップアップは閉じる。
    hoverPopupRef.current?.remove();
    mapRef.current?.getSource<GeoJSONSource>(EVENTS_SOURCE_ID)?.setData(markers);
  }, [markers]);

  useEffect(() => {
    onSelectRef.current = onSelectEvents;
    onClickEmptyRef.current = onClickEmpty;
  }, [onSelectEvents, onClickEmpty]);

  useEffect(() => {
    const view = { highlightedDomain, hiddenDomains, selectedIds };
    viewRef.current = view;
    const map = mapRef.current;
    if (map?.getLayer(EVENTS_LAYER_ID)) applyViewState(map, view);
  }, [highlightedDomain, hiddenDomains, selectedIds]);

  // 縦長画面では世界の外側（上下）も見えるため、コンテナ自体も海の色で塗る。
  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: MAP_COLORS.ocean }}
    />
  );
}

const applyViewState = (map: MapLibreMap, view: MapViewState): void => {
  const opacity = markerOpacity(view.highlightedDomain);
  MARKER_LAYERS.forEach(({ id, kind }) => {
    map.setPaintProperty(id, "circle-opacity", opacity);
    map.setPaintProperty(id, "circle-stroke-opacity", opacity);
    map.setLayoutProperty(id, "circle-sort-key", markerSortKey(view.highlightedDomain));
    map.setFilter(id, markerFilter(view.hiddenDomains, kindIs(kind)));
  });
  map.setFilter(SELECTED_LAYER_ID, selectedFilter(view.hiddenDomains, view.selectedIds));
  map.setFilter(LABEL_LAYER_ID, labelFilter(view.hiddenDomains));
  map.setPaintProperty(LABEL_LAYER_ID, "text-opacity", opacity);
};
