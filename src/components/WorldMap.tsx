"use client";

import { useEffect, useRef } from "react";
import {
  LngLat,
  Map as MapLibreMap,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type LayerSpecification,
  type MapLayerMouseEvent,
  type StyleSpecification,
  type TransformConstrainFunction,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { publicPath } from "@/lib/config";
import {
  DIFFUSION,
  DOMAIN_COLORS,
  GRAY,
  MAP_COLORS,
  MAP_LABEL,
  MAP_LINE,
  MARKER,
  MARKER_HIT_TOLERANCE,
  SELECTION_RING,
  SPACE,
} from "@/lib/design";
import { DOMAINS } from "@/lib/domain";
import { markerFilter } from "@/lib/mapFilters";
import { popupContent, type PopupItem } from "@/lib/popupContent";
import type { DiffusionLineCollection } from "@/lib/diffusion";
import {
  LABEL_MIN_ZOOM_BY_IMPORTANCE,
  MIN_ZOOM_BY_IMPORTANCE,
  promotedThresholds,
  type DensityLevel,
  type EventMarkerCollection,
  type MarkerKind,
} from "@/lib/timeline";
import type { Domain } from "@/types/event";

const EVENTS_SOURCE_ID = "events";
const LINES_SOURCE_ID = "diffusion-lines";
const EVENTS_LAYER_ID = "events-circle";
const LINE_CASING_LAYER_ID = "diffusion-line-casing";
const LINE_LAYER_ID = "diffusion-line";
const ORIGIN_HALO_LAYER_ID = "diffusion-origin-halo";
const ORIGIN_RING_LAYER_ID = "diffusion-origin-ring";
const PERIOD_HALO_LAYER_ID = "events-period-halo";
const PERIOD_LAYER_ID = "events-period";
const SELECTED_LAYER_ID = "events-selected";
const LABEL_LAYER_ID = "events-label";
const LABEL_BLOCKER_LAYER_ID = "events-label-blocker";
const PRIORITY_LABEL_LAYER_ID = "events-label-priority";
/** イベント名のラベルのレイヤ（フィルタと不透明度を同じように更新する） */
const LABEL_LAYER_IDS = [LABEL_LAYER_ID, PRIORITY_LABEL_LAYER_ID];

/** ホバーの対象になるレイヤー。diffusion の起点・到達点の円は、instant と同じ EVENTS_LAYER_ID に入る */
const INTERACTIVE_LAYER_IDS = [EVENTS_LAYER_ID, PERIOD_LAYER_ID, ORIGIN_RING_LAYER_ID];
/** クリックで選択できるレイヤー。ラベルをクリックしても、そのイベントを選ぶ */
const CLICKABLE_LAYER_IDS = [...INTERACTIVE_LAYER_IDS, ...LABEL_LAYER_IDS];

const kindIn = (...kinds: readonly MarkerKind[]): ExpressionSpecification => ["in", ["get", "kind"], ["literal", [...kinds]]];
const isOrigin: ExpressionSpecification = ["==", ["get", "role"], "origin"];

/**
 * マーカーのレイヤーと、それぞれが描くもの。
 * diffusion の起点・到達点は instant と同じ塗りつぶしの円で描き、起点にはその外側の輪（ORIGIN_*）を足す。
 */
const MARKER_LAYERS: readonly { readonly id: string; readonly only: ExpressionSpecification }[] = [
  { id: ORIGIN_HALO_LAYER_ID, only: isOrigin },
  { id: ORIGIN_RING_LAYER_ID, only: isOrigin },
  { id: PERIOD_HALO_LAYER_ID, only: kindIn("period") },
  { id: PERIOD_LAYER_ID, only: kindIn("period") },
  { id: EVENTS_LAYER_ID, only: kindIn("instant", "diffusion") },
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

/**
 * importance による基準半径 × 年の差による倍率（fade）。MARKER.minRadius を下回らない。
 * diffusion の到達点（role が "stage"）は MARKER.minRadius で固定。現在年に到達した点（"front"）は、その年だけ他と同じ式。
 */
const markerRadius: ExpressionSpecification = [
  "case",
  ["==", ["get", "role"], "stage"],
  MARKER.minRadius,
  [
    "max",
    [
      "*",
      ["match", ["get", "importance"], 3, MARKER.radius[3], 2, MARKER.radius[2], MARKER.radius[1]],
      ["get", "fade"],
    ],
    MARKER.minRadius,
  ],
];

/** diffusion の起点の、外側の輪の内径（＝円の白い縁取りの外側）。 */
const originRingInnerRadius: ExpressionSpecification = ["+", markerRadius, MARKER.strokeWidth];

/**
 * マーカーが占める半径（白い縁取りの外側まで）。diffusion の起点は、外側の輪とその白い縁取りのぶん大きい。
 * 選択中の輪、ラベルの位置、ラベル除けの大きさに使う。
 */
const markerOuterRadius: ExpressionSpecification = [
  "+",
  markerRadius,
  MARKER.strokeWidth,
  ["case", isOrigin, DIFFUSION.ringWidth + MARKER.strokeWidth, 0],
];

/** period の輪の内側（白で抜く部分）の半径。輪の太さは markerRadius との差。 */
const periodHoleRadius: ExpressionSpecification = ["*", markerRadius, MARKER.periodHoleRatio];

/** 重要度の高いもの・強調中の分類を上に描く */
const markerSortKey = (highlighted: Domain | null): ExpressionSpecification =>
  highlighted === null
    ? ["get", "importance"]
    : ["+", ["get", "importance"], ["case", ["==", ["get", "domain"], highlighted], 10, 0]];

/**
 * 優先ラベルの対象: importance 3 の period と diffusion（世界大戦のような、長く続く最重要の出来事）。
 * こういう出来事の primary の周りは、その戦争の会戦のマーカーで埋まっていることが多く、マーカーを避ける通常のラベルだと
 * どのズームでも出ない（1916 年の第一次世界大戦）。そこで、マーカーを避けない別のレイヤ（events-label-priority）に出す。
 */
const isPriorityLabel: ExpressionSpecification = [
  "all",
  ["==", ["get", "importance"], 3],
  kindIn("period", "diffusion"),
];

/**
 * ラベルを出す条件。マーカーの表示条件に加えて、ラベル用のズームの閾値と「places の最初の1点だけ」を掛ける。
 * priority が true なら優先ラベルの対象だけ、false ならそれ以外。
 */
const labelFilter = (
  hiddenDomains: readonly Domain[],
  priority: boolean,
  level: DensityLevel = 0,
): ExpressionSpecification =>
  markerFilter(
    hiddenDomains,
    ["all", ["==", ["get", "primary"], true], priority ? isPriorityLabel : ["!", isPriorityLabel]],
    promotedThresholds(LABEL_MIN_ZOOM_BY_IMPORTANCE, level),
  );

/** マーカー（と経路の線、ラベル除け）の表示条件。密度による繰り上げ（timeline.ts の densityLevel）を閾値に反映する。 */
const densityFilter = (
  hiddenDomains: readonly Domain[],
  level: DensityLevel,
  extra: ExpressionSpecification | null = null,
): ExpressionSpecification => markerFilter(hiddenDomains, extra, promotedThresholds(MIN_ZOOM_BY_IMPORTANCE, level));

/** マーカーの白い縁取りの外側から MAP_LABEL.gap だけ離す（text-radial-offset は em 単位）。 */
const labelOffset: ExpressionSpecification = ["/", ["+", markerOuterRadius, MAP_LABEL.gap], MAP_LABEL.fontSize];

/**
 * マーカーの領域を、ラベルの衝突判定に占有させるための見えない symbol（events-label-blocker レイヤ）。
 * MapLibre の衝突判定は symbol どうしでしか働かず、circle レイヤのマーカーは避けてくれないので、
 * ラベルが他のマーカーを横切ってしまう。そこで、各マーカーと同じ位置に、マーカーの直径と同じ大きさの
 * 透明な文字を置く（必ず置かれ、場所を占有する）。ラベルのレイヤより後ろ（＝上）に置くのは、
 * MapLibre が上のレイヤの symbol から先に配置するため。
 */
const BLOCKER_TEXT = "●";
const blockerSize: ExpressionSpecification = ["*", 2, markerOuterRadius];

/**
 * ラベルを置く優先順。symbol-sort-key は小さいほど先に置かれる（＝重なったときに残る）ので、
 * importance の高いもの、同じなら現在年に近いもの（fade が大きいもの）ほど小さくする。
 */
const labelSortKey: ExpressionSpecification = ["-", 0, ["+", ["*", ["get", "importance"], 10], ["get", "fade"]]];

/**
 * イベント名のラベルのレイヤ。instant も period も出す。見た目と置く優先順は、通常のラベルも優先ラベルも同じ。
 * スタイルに glyphs の URL を置いていないので、文字は端末のフォントで描かれる（design.ts の MAP_LABEL）。
 */
const labelLayer = (id: string, priority: boolean): LayerSpecification => ({
  id,
  type: "symbol",
  source: EVENTS_SOURCE_ID,
  filter: labelFilter([], priority),
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
});

/** diffusion の経路の太さ。end の後は fade を掛けて細くする。 */
const lineWidth: ExpressionSpecification = ["*", DIFFUSION.lineWidth, ["get", "fade"]];

const createStyle = (
  landUrl: string,
  markers: EventMarkerCollection,
  lines: DiffusionLineCollection,
): StyleSpecification => ({
  version: 8,
  sources: {
    land: { type: "geojson", data: landUrl },
    [EVENTS_SOURCE_ID]: { type: "geojson", data: markers },
    [LINES_SOURCE_ID]: { type: "geojson", data: lines },
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
    // diffusion の経路: 白い縁の上に分類色の線。どのマーカーよりも下に描く。
    {
      id: LINE_CASING_LAYER_ID,
      type: "line",
      source: LINES_SOURCE_ID,
      filter: markerFilter([]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": MARKER.strokeColor,
        "line-width": ["+", lineWidth, 2 * DIFFUSION.lineCasingWidth],
        "line-opacity": markerOpacity(null),
      },
    },
    {
      id: LINE_LAYER_ID,
      type: "line",
      source: LINES_SOURCE_ID,
      filter: markerFilter([]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": markerColor, "line-width": lineWidth, "line-opacity": markerOpacity(null) },
    },
    // diffusion の起点の外側の輪（二重輪）。白い縁取り（下のレイヤー）の上に、白い円と分類色の輪を描き、
    // その上に instant と同じ円（EVENTS_LAYER_ID）が乗る。輪の色が接するのは、内側も外側も白だけ。
    {
      id: ORIGIN_HALO_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      filter: markerFilter([], isOrigin),
      layout: { "circle-sort-key": markerSortKey(null) },
      paint: {
        "circle-color": MARKER.strokeColor,
        "circle-radius": ["+", originRingInnerRadius, DIFFUSION.ringWidth],
        "circle-opacity": markerOpacity(null),
        "circle-stroke-color": MARKER.strokeColor,
        "circle-stroke-width": MARKER.strokeWidth,
        "circle-stroke-opacity": markerOpacity(null),
      },
    },
    {
      id: ORIGIN_RING_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      filter: markerFilter([], isOrigin),
      layout: { "circle-sort-key": markerSortKey(null) },
      paint: {
        "circle-color": MARKER.strokeColor,
        "circle-radius": originRingInnerRadius,
        "circle-opacity": markerOpacity(null),
        "circle-stroke-color": markerColor,
        "circle-stroke-width": DIFFUSION.ringWidth,
        "circle-stroke-opacity": markerOpacity(null),
      },
    },
    // period: 中抜きの輪。白い縁取り（下のレイヤー）の上に、白い中心と分類色の輪を描く。
    // 外径は instant と同じ（半径 + 縁取り 2px）で、輪の色が接するのは白だけ。
    {
      id: PERIOD_HALO_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      filter: markerFilter([], kindIn("period")),
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
      filter: markerFilter([], kindIn("period")),
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
    // instant と、diffusion の起点・到達点: 塗りつぶしの円。period より上に描く。
    {
      id: EVENTS_LAYER_ID,
      type: "circle",
      source: EVENTS_SOURCE_ID,
      filter: markerFilter([], kindIn("instant", "diffusion")),
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
        "circle-radius": markerOuterRadius,
        "circle-opacity": 0,
        "circle-stroke-color": SELECTION_RING.color,
        "circle-stroke-width": SELECTION_RING.width,
      },
    },
    // イベント名のラベル（優先ラベルの対象を除く）。重なるものは MapLibre が間引き、他のマーカー（下の blocker）も避ける。
    labelLayer(LABEL_LAYER_ID, false),
    {
      id: LABEL_BLOCKER_LAYER_ID,
      type: "symbol",
      source: EVENTS_SOURCE_ID,
      // 地図に出ているマーカーすべて（ラベルと違い、places の全点・マーカーと同じズームの閾値）
      filter: markerFilter([]),
      layout: {
        "text-field": BLOCKER_TEXT,
        "text-font": [...MAP_LABEL.fontStack],
        "text-size": blockerSize,
        "text-padding": 0,
        "text-allow-overlap": true,
        "text-ignore-placement": false,
      },
      paint: { "text-opacity": 0 },
    },
    // 優先ラベル（importance 3 の period）。MapLibre は上のレイヤの symbol から先に配置するので、blocker より後ろ（＝上）に
    // 置いたこのレイヤは、マーカーの領域に関係なく先に置かれる。通常のラベルは、このラベルも避けて置かれる。
    labelLayer(PRIORITY_LABEL_LAYER_ID, true),
  ],
});

/** 選択中のイベント（表示条件を満たすもの）だけに輪を付けるための filter */
const selectedFilter = (hiddenDomains: readonly Domain[], selectedIds: readonly string[], level: DensityLevel = 0) =>
  densityFilter(hiddenDomains, level, ["in", ["get", "id"], ["literal", [...selectedIds]]]);

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

/** カーソル位置に重なっているマーカー（タイトルで重複除去）。 */
const itemsAt = (event: MapLayerMouseEvent): readonly PopupItem[] => {
  const items = (event.features ?? []).map((f) => ({
    title: String(f.properties?.title ?? ""),
    domain: f.properties?.domain as Domain,
  }));
  return items.filter((item, i) => items.findIndex((other) => other.title === item.title) === i);
};

interface WorldMapProps {
  readonly markers: EventMarkerCollection;
  /** diffusion の経路（現在年までに到達した stage への線） */
  readonly lines: DiffusionLineCollection;
  readonly highlightedDomain: Domain | null;
  readonly hiddenDomains: readonly Domain[];
  /** 密度による importance の繰り上げの段階（現在年のマーカー数から決まる。timeline.ts の densityLevel） */
  readonly densityLevel: DensityLevel;
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
  readonly densityLevel: DensityLevel;
  readonly selectedIds: readonly string[];
}

export function WorldMap({
  markers,
  lines,
  highlightedDomain,
  hiddenDomains,
  densityLevel,
  selectedIds,
  onSelectEvents,
  onClickEmpty,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(markers);
  const linesRef = useRef(lines);
  const viewRef = useRef<MapViewState>({ highlightedDomain, hiddenDomains, densityLevel, selectedIds });
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
      style: createStyle(publicPath("/geo/ne_110m_land.geojson"), markersRef.current, linesRef.current),
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
      map.getSource<GeoJSONSource>(LINES_SOURCE_ID)?.setData(linesRef.current);
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
    linesRef.current = lines;
    mapRef.current?.getSource<GeoJSONSource>(LINES_SOURCE_ID)?.setData(lines);
  }, [lines]);

  useEffect(() => {
    onSelectRef.current = onSelectEvents;
    onClickEmptyRef.current = onClickEmpty;
  }, [onSelectEvents, onClickEmpty]);

  useEffect(() => {
    const view = { highlightedDomain, hiddenDomains, densityLevel, selectedIds };
    viewRef.current = view;
    const map = mapRef.current;
    if (map?.getLayer(EVENTS_LAYER_ID)) applyViewState(map, view);
  }, [highlightedDomain, hiddenDomains, densityLevel, selectedIds]);

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
  MARKER_LAYERS.forEach(({ id, only }) => {
    map.setPaintProperty(id, "circle-opacity", opacity);
    map.setPaintProperty(id, "circle-stroke-opacity", opacity);
    map.setLayoutProperty(id, "circle-sort-key", markerSortKey(view.highlightedDomain));
    map.setFilter(id, densityFilter(view.hiddenDomains, view.densityLevel, only));
  });
  [LINE_CASING_LAYER_ID, LINE_LAYER_ID].forEach((id) => {
    map.setPaintProperty(id, "line-opacity", opacity);
    map.setFilter(id, densityFilter(view.hiddenDomains, view.densityLevel));
  });
  map.setFilter(SELECTED_LAYER_ID, selectedFilter(view.hiddenDomains, view.selectedIds, view.densityLevel));
  map.setFilter(LABEL_LAYER_ID, labelFilter(view.hiddenDomains, false, view.densityLevel));
  map.setFilter(PRIORITY_LABEL_LAYER_ID, labelFilter(view.hiddenDomains, true, view.densityLevel));
  map.setFilter(LABEL_BLOCKER_LAYER_ID, densityFilter(view.hiddenDomains, view.densityLevel));
  LABEL_LAYER_IDS.forEach((id) => map.setPaintProperty(id, "text-opacity", opacity));
};
