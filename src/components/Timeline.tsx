"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DOMAIN_COLORS,
  GRAY,
  MARKER,
  PLAYBACK,
  RADIUS,
  SELECTION_RING,
  SPACE,
  TIMELINE,
  surfaceStyle,
  textStyle,
} from "@/lib/design";
import { DOMAIN_LABELS } from "@/lib/domain";
import { popupContent } from "@/lib/popupContent";
import {
  TIMELINE_HALF_SPAN_LEVELS,
  TIMELINE_WHEEL_SENSITIVITY,
  quantizeHalfSpan,
  type PlaybackSpeed,
} from "@/lib/timeline";
import {
  byTimelinePaintOrder,
  existsInYear,
  histogramBins,
  inWindow,
  itemExtent,
  itemModes,
  itemsAtX,
  itemsInYear,
  labelsInWindow,
  laneHistogram,
  modeOf,
  pxToYears,
  timelineAxisLabel,
  timelineAxisStep,
  timelineAxisTicks,
  timelineItems,
  timelineLabels,
  timelineLanes,
  timelineX,
  yearAtX,
  zoomedHalfSpan,
  type HistogramBin,
  type LabelStyle,
  type TimelineGeometry,
  type TimelineItem,
  type TimelineWindow,
} from "@/lib/timelineChart";
import { useWidth } from "@/lib/useWidth";
import { formatYear } from "@/lib/year";
import type { Domain, HistEvent, Year } from "@/types/event";

interface TimelineProps {
  readonly year: Year;
  /** 年スライダーの範囲。窓がこの外にはみ出した部分には、目盛りを出さない */
  readonly min: Year;
  readonly max: Year;
  /** 窓の片側の幅（年） */
  readonly halfSpan: number;
  readonly events: readonly HistEvent[];
  readonly hiddenDomains: readonly Domain[];
  /** 地図のマーカーの、importance ごとの表示を始めるズーム（密度による繰り上げ後）。地図に出ない項目の判定に使う */
  readonly mapThresholds: Readonly<Record<1 | 2 | 3, number>>;
  /** 凡例でホバー中の分類。そのレーンだけを強調する */
  readonly highlightedDomain: Domain | null;
  readonly selectedIds: readonly string[];
  /** 再生中か、その速度（年/秒） */
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  readonly onTogglePlayback: () => void;
  readonly onCycleSpeed: () => void;
  readonly onSetYear: (year: Year) => void;
  readonly onSetHalfSpan: (halfSpan: number) => void;
  /** 項目をクリックしたとき。重なっていれば複数の id が渡る（地図のマーカーと同じ） */
  readonly onSelectEvents: (eventIds: readonly string[]) => void;
  /** 年表の何もない所をクリックしたとき */
  readonly onClickEmpty: () => void;
}

interface Hover {
  readonly x: number;
  readonly y: number;
  readonly items: readonly TimelineItem[];
  /** ヒストグラムのレーンでは、その年と件数を見出しに出す */
  readonly heading: string | null;
}

const POINT_RADIUS = TIMELINE.pointDiameter / 2;

const LABEL_STYLE: LabelStyle = { fontSize: textStyle.caption.fontSize, gap: TIMELINE.labelGap };

/** 項目の描画を年表の枠で切る clipPath の id（年表は画面に 1 つだけ） */
const CLIP_ID = "timeline-lanes-clip";

/** ホバーの吹き出しで、どのズームでも地図に出ない項目に添える注記 */
const OFF_MAP_NOTE = "（地図に位置なし）";

/**
 * ヒストグラムの項目の棒。1 年刻みの棒を、1つの path にまとめて描く（±500 年で 1,000 本になるため）。
 * 棒は、その年を中心に 1 年ぶんの幅。高さは、レーンの全期間でいちばん件数の多い年（max）をレーンの高さに合わせて正規化する
 * （窓の中の最大にすると、パンで高さが変わる）。
 */
function LaneHistogram({
  bins,
  max: laneMax,
  view,
  width,
  bottom,
  color,
}: {
  readonly bins: readonly HistogramBin[];
  readonly max: number;
  readonly view: TimelineWindow;
  readonly width: number;
  readonly bottom: number;
  readonly color: string;
}) {
  const max = Math.max(1, laneMax);
  const clampX = (x: number): number => Math.min(width, Math.max(0, x));
  const d = bins
    .filter((bin) => bin.count > 0)
    .map((bin) => {
      const x0 = clampX(timelineX(bin.year - 0.5, view, width));
      const x1 = clampX(timelineX(bin.year + 0.5, view, width));
      const top = bottom - (bin.count / max) * TIMELINE.laneHeight * TIMELINE.histogramMaxHeightRatio;
      return `M${x0} ${bottom}V${top}H${x1}V${bottom}Z`;
    })
    .join("");
  return <path data-timeline-histogram data-max={max} d={d} fill={color} fillOpacity={TIMELINE.histogramFillOpacity} />;
}

/**
 * 再生ボタンと速度の切り替え（年表の左）。年表を閉じている狭い画面でも出す。
 * アイコンは SVG で描く（絵文字は使わない）。
 */
function PlaybackControls({
  playing,
  speed,
  onTogglePlayback,
  onCycleSpeed,
  atEnd,
}: Pick<TimelineProps, "playing" | "speed" | "onTogglePlayback" | "onCycleSpeed"> & {
  /** 現在年が年スライダーの最後の年で、これ以上進めない */
  readonly atEnd: boolean;
}) {
  const size = PLAYBACK.iconSize;
  return (
    <div className="flex shrink-0 flex-col items-center" style={{ gap: SPACE[4] }}>
      <button
        type="button"
        className="flex items-center justify-center"
        style={{
          width: PLAYBACK.buttonSize,
          height: PLAYBACK.buttonSize,
          borderRadius: RADIUS.small,
          backgroundColor: PLAYBACK.buttonColor,
          // 進める年が無いときは押せない
          opacity: atEnd ? PLAYBACK.disabledOpacity : 1,
          cursor: atEnd ? "default" : "pointer",
        }}
        disabled={atEnd}
        aria-label={playing ? "停止（スペースキー）" : "再生（スペースキー）"}
        aria-pressed={playing}
        data-playback={playing ? "playing" : "stopped"}
        onClick={onTogglePlayback}
      >
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden fill={PLAYBACK.iconColor}>
          {playing ? (
            <>
              <rect x={1} y={0} width={4} height={12} />
              <rect x={7} y={0} width={4} height={12} />
            </>
          ) : (
            <path d="M1 0L12 6L1 12Z" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="whitespace-nowrap"
        style={{
          ...textStyle.caption,
          textDecoration: "underline",
          fontVariantNumeric: "tabular-nums",
        }}
        aria-label={`再生の速度: ${speed}年/秒（押すと切り替え）`}
        data-playback-speed={speed}
        onClick={onCycleSpeed}
      >
        {speed}年/秒
      </button>
    </div>
  );
}

/** レーンの中心の y 座標 */
const laneCenterY = (index: number): number => index * TIMELINE.laneHeight + TIMELINE.laneHeight / 2;

/**
 * 年表。横軸は現在年を中心とした窓、縦軸は分類のレーン（凡例と同じ順・色）。
 * - ドラッグで現在年が動き（年スライダーと同じ setYear）、ホイールで窓の幅が変わる
 * - 項目のクリックで詳細パネルが開き、空白のクリックで閉じる（地図と同じ）
 * - 狭い画面では既定で閉じ、ボタンで開く
 */
export function Timeline({
  year,
  min,
  max,
  halfSpan,
  events,
  hiddenDomains,
  mapThresholds,
  highlightedDomain,
  selectedIds,
  playing,
  speed,
  onTogglePlayback,
  onCycleSpeed,
  onSetYear,
  onSetHalfSpan,
  onSelectEvents,
  onClickEmpty,
}: TimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const [bodyRef, width] = useWidth();
  const [hover, setHover] = useState<Hover | null>(null);

  const view = useMemo<TimelineWindow>(() => ({ center: year, halfSpan }), [year, halfSpan]);
  const geometry = useMemo<TimelineGeometry>(
    () => ({
      width,
      pointRadius: POINT_RADIUS,
      minBandWidth: TIMELINE.minBandWidth,
    }),
    [width],
  );
  const lanes = useMemo(() => timelineLanes(hiddenDomains), [hiddenDomains]);
  // ── 段階ごとに 1 回だけ計算するもの（窓の位置に依らない。パンでは作り直さない） ──
  // 項目は窓で絞らない。出す importance は段階で決まる
  const allItems = useMemo(
    () => timelineItems(events, halfSpan, hiddenDomains, mapThresholds),
    [events, halfSpan, hiddenDomains, mapThresholds],
  );
  // 項目が多すぎて点が並びきらない区画（年の絶対座標にそろえた区画）の項目は、ヒストグラムにする
  const modes = useMemo(() => itemModes(allItems, halfSpan, geometry), [allItems, halfSpan, geometry]);
  // ヒストグラムの項目の、レーンごと・年ごとの件数（全期間）
  const histograms = useMemo(
    () => new Map(lanes.map((domain) => [domain, laneHistogram(allItems, domain, modes)])),
    [allItems, lanes, modes],
  );
  // どのラベルを出すか。位置は年の絶対座標
  const layoutLabels = useMemo(
    () => (width === 0 ? [] : timelineLabels(allItems, halfSpan, geometry, LABEL_STYLE, modes)),
    [allItems, halfSpan, geometry, width, modes],
  );

  // ── 窓で絞る（描画のみ） ──
  const items = useMemo(() => allItems.filter((item) => inWindow(item, view)), [allItems, view]);
  const painted = useMemo(
    () => items.filter((item) => modeOf(modes, item) === "items").sort(byTimelinePaintOrder),
    [items, modes],
  );
  const histogramItems = useMemo(() => items.filter((item) => modeOf(modes, item) === "histogram"), [items, modes]);
  const labels = useMemo(() => labelsInWindow(layoutLabels, view, width, LABEL_STYLE), [layoutLabels, view, width]);
  const axisStep = timelineAxisStep(view, width, TIMELINE.axisLabelMinSpacing);
  const ticks = useMemo(
    () => timelineAxisTicks(view, axisStep).filter((tick) => tick.year >= min && tick.year <= max),
    [view, axisStep, min, max],
  );

  const lanesHeight = lanes.length * TIMELINE.laneHeight;
  const height = lanesHeight + TIMELINE.axisHeight;

  /**
   * ポインタの位置にある項目（レーンの外なら空）。点と帯を先に見て、無ければヒストグラムの項目のうち、その年に存在するもの。
   * 1 つのレーンに点の区画とヒストグラムの区画が混ざるので、レーン単位ではなく位置で決める。
   */
  const hitAt = (x: number, y: number): Pick<Hover, "items" | "heading"> => {
    const lane = lanes[Math.floor(y / TIMELINE.laneHeight)];
    if (lane === undefined || y < 0) return { items: [], heading: null };
    const points = itemsAtX(painted, lane, x, TIMELINE.hitTolerance, view, geometry);
    if (points.length > 0) return { items: points, heading: null };
    const hitYear = yearAtX(x, view, width);
    const found = itemsInYear(histogramItems, lane, hitYear);
    return found.length === 0
      ? { items: [], heading: null }
      : { items: found, heading: `${formatYear(hitYear)}: ${found.length}件` };
  };

  // ── ドラッグ（現在年を動かす）、クリック、ピンチ（窓の幅を変える） ──
  // ドラッグ中は、押した時点の年と窓を基準に年を決める（窓は現在年と一緒に動くので、直前の位置との差分では決められない）
  const drag = useRef<{
    readonly x: number;
    readonly year: Year;
    readonly moved: boolean;
  } | null>(null);
  // 触れている指（pointerId → x）。2本になったらピンチで、押した時点の指の間隔と窓の幅を基準に、窓の幅を決める
  const pointers = useRef<ReadonlyMap<number, number>>(new Map());
  const pinch = useRef<{
    readonly distance: number;
    readonly halfSpan: number;
  } | null>(null);
  const pointerDistance = (): number => {
    const xs = [...pointers.current.values()];
    return Math.abs(xs[0] - xs[1]);
  };
  const localPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current = new Map([...pointers.current, [event.pointerId, event.clientX]]);
    if (pointers.current.size === 2) {
      // 2本目の指が触れたら、ドラッグをやめてピンチにする（指を離してもクリックにしない）
      drag.current = null;
      pinch.current = { distance: Math.max(1, pointerDistance()), halfSpan };
      setHover(null);
      return;
    }
    drag.current = { x: event.clientX, year, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(event.pointerId)) {
      pointers.current = new Map([...pointers.current, [event.pointerId, event.clientX]]);
    }
    if (pinch.current !== null && pointers.current.size === 2) {
      // 指を広げると、同じ年数が広い幅を占める＝窓が狭まる
      onSetHalfSpan(pinch.current.halfSpan * (pinch.current.distance / Math.max(1, pointerDistance())));
      return;
    }
    const started = drag.current;
    if (started === null) {
      if (pointers.current.size > 0) return;
      const { x, y } = localPoint(event);
      const hit = hitAt(x, y);
      setHover(hit.items.length === 0 ? null : { x, y, ...hit });
      return;
    }
    const dx = event.clientX - started.x;
    if (!started.moved && Math.abs(dx) < TIMELINE.dragThreshold) return;
    drag.current = { ...started, moved: true };
    setHover(null);
    // 年表を右に引くと、過去の年が中央に来る
    onSetYear(started.year - pxToYears(dx, { center: started.year, halfSpan }, width));
  };
  const releasePointer = (pointerId: number) => {
    pointers.current = new Map([...pointers.current].filter(([id]) => id !== pointerId));
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const started = drag.current;
    drag.current = null;
    releasePointer(event.pointerId);
    if (started === null || started.moved) return;
    const { x, y } = localPoint(event);
    const hit = hitAt(x, y).items;
    if (hit.length === 0) onClickEmpty();
    else onSelectEvents(hit.map((item) => item.id));
  };
  const onPointerCancel = (event: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = null;
    releasePointer(event.pointerId);
  };

  // ── ホイール（窓の幅を変える） ──
  // React の onWheel は passive で preventDefault できないので、自前で登録する。最新の値は ref から読む。
  // 窓の幅は段階に丸められる（reducer）ので、ホイールの回転は丸める前の値（target）に積み上げる。
  // 段階の値に直接掛けると、1 目盛りぶんの回転では隣の段階に届かず、いつまでも動かない
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef({ target: halfSpan, onSetHalfSpan });
  useEffect(() => {
    // ピンチなど、ホイール以外で段階が変わったら、積み上げをその段階からやり直す
    const target = quantizeHalfSpan(zoomRef.current.target) === halfSpan ? zoomRef.current.target : halfSpan;
    zoomRef.current = { target, onSetHalfSpan };
  }, [halfSpan, onSetHalfSpan]);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const [minLevel, maxLevel] = [TIMELINE_HALF_SPAN_LEVELS[0], TIMELINE_HALF_SPAN_LEVELS[TIMELINE_HALF_SPAN_LEVELS.length - 1]];
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { target: current, onSetHalfSpan: set } = zoomRef.current;
      // 端の段階を越えて積み上げない（戻すときに、余計に回さなくて済むように）
      const target = Math.min(maxLevel, Math.max(minLevel, zoomedHalfSpan(current, event.deltaY, TIMELINE_WHEEL_SENSITIVITY)));
      zoomRef.current = { ...zoomRef.current, target };
      set(target);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [width]);

  // ── ホバーの吹き出し（地図と同じ中身） ──
  const tooltipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hover === null || tooltipRef.current === null) return;
    const shown = hover.items
      .slice(0, TIMELINE.tooltipMaxItems)
      .map((item) => ({ title: item.title, domain: item.domain, ...(item.offMap ? { note: OFF_MAP_NOTE } : {}) }));
    tooltipRef.current.replaceChildren(popupContent(shown, hover.items.length - shown.length, hover.heading));
  }, [hover]);

  const laneOpacity = (domain: Domain): number =>
    highlightedDomain === null || highlightedDomain === domain ? 1 : MARKER.dimOpacity;

  return (
    <section aria-label="年表" className="flex items-start" style={{ ...surfaceStyle, gap: SPACE[12] }}>
      <PlaybackControls
        playing={playing}
        speed={speed}
        onTogglePlayback={onTogglePlayback}
        onCycleSpeed={onCycleSpeed}
        atEnd={year >= max}
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="flex w-full items-center justify-between roomy:hidden"
          style={textStyle.caption}
          aria-expanded={expanded}
          aria-controls="timeline-body"
          onClick={() => setExpanded((v) => !v)}
        >
          <span>年表</span>
          <span style={{ textDecoration: "underline" }}>{expanded ? "閉じる" : "開く"}</span>
        </button>
        <div
          id="timeline-body"
          ref={bodyRef}
          className={`relative ${expanded ? "block" : "hidden roomy:block"}`}
          style={expanded ? { marginTop: SPACE[8] } : undefined}
        >
          {width > 0 && (
            <svg
              ref={svgRef}
              role="img"
              aria-label={`${formatYear(year)}の前後${Math.round(halfSpan)}年の年表`}
              width={width}
              height={height}
              className="block select-none"
              style={{
                touchAction: "none",
                cursor: hover === null ? "grab" : "pointer",
              }}
              data-timeline
              data-half-span={halfSpan}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onPointerLeave={() => setHover(null)}
            >
              {/* レーンの区切り線と、時間軸 */}
              {lanes.map((domain, index) => (
                <line
                  key={domain}
                  x1={0}
                  x2={width}
                  y1={(index + 1) * TIMELINE.laneHeight}
                  y2={(index + 1) * TIMELINE.laneHeight}
                  stroke={TIMELINE.laneLine.color}
                  strokeWidth={TIMELINE.laneLine.width}
                />
              ))}
              {ticks.map((tick) => {
                const x = timelineX(tick.year, view, width);
                const labelFits =
                  x >= TIMELINE.axisLabelMinSpacing / 2 && x <= width - TIMELINE.axisLabelMinSpacing / 2;
                return (
                  <g key={tick.calendar} data-timeline-tick={tick.year}>
                    <line
                      x1={x}
                      x2={x}
                      y1={lanesHeight}
                      y2={lanesHeight + TIMELINE.axisTick.length}
                      stroke={TIMELINE.axisTick.color}
                      strokeWidth={TIMELINE.axisTick.width}
                    />
                    {labelFits && (
                      <text
                        x={x}
                        y={lanesHeight + TIMELINE.axisTick.length + SPACE[4]}
                        textAnchor="middle"
                        dominantBaseline="hanging"
                        fontSize={textStyle.caption.fontSize}
                        fill={textStyle.caption.color}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {timelineAxisLabel(tick)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* 項目。レーンごとにまとめ、凡例のホバーで他のレーンを弱める。レーンの枠の外（左右にはみ出したラベルなど）は切る */}
              <defs>
                <clipPath id={CLIP_ID}>
                  <rect x={0} y={0} width={width} height={lanesHeight} />
                </clipPath>
              </defs>
              <g clipPath={`url(#${CLIP_ID})`}>
                {lanes.map((domain, index) => {
                  const cy = laneCenterY(index);
                  const color = DOMAIN_COLORS[domain];
                  const lanePainted = painted.filter((item) => item.domain === domain);
                  const bins = histogramBins(histograms.get(domain) ?? { first: 0, counts: [], max: 0 }, view);
                  const hasHistogram = bins.some((bin) => bin.count > 0);
                  const laneLabels = labels.filter((label) => label.domain === domain);
                  return (
                    <g
                      key={domain}
                      data-timeline-lane={domain}
                      data-timeline-lane-mode={
                        hasHistogram ? (lanePainted.length > 0 ? "mixed" : "histogram") : "items"
                      }
                      opacity={laneOpacity(domain)}
                    >
                      <title>{DOMAIN_LABELS[domain]}</title>
                      {hasHistogram && (
                        <LaneHistogram
                          bins={bins}
                          max={histograms.get(domain)?.max ?? 0}
                          view={view}
                          width={width}
                          bottom={(index + 1) * TIMELINE.laneHeight}
                          color={color}
                        />
                      )}
                      {/* ヒストグラムの項目には点が無いので、ラベルの付いた項目の開始年に縦線を引いて、どの年かを示す */}
                      {laneLabels
                        .filter((label) => label.histogram && !label.pinned)
                        .map((label) => (
                          <line
                            key={label.id}
                            x1={label.anchor}
                            x2={label.anchor}
                            y1={index * TIMELINE.laneHeight}
                            y2={(index + 1) * TIMELINE.laneHeight}
                            stroke={color}
                            strokeWidth={TIMELINE.histogramLabelTick.width}
                          />
                        ))}
                      {/* 帯の塗り。不透明度はグループに掛ける（重なっても濃くならない）。地図に出ない項目の帯は塗らない */}
                      <g opacity={TIMELINE.bandFillOpacity}>
                        {lanePainted
                          .filter((item) => item.kind === "period" && !item.offMap)
                          .map((item) => {
                            const [x0, x1] = itemExtent(item, view, geometry);
                            return (
                              <rect
                                key={item.id}
                                x={x0}
                                y={cy - TIMELINE.bandHeight / 2}
                                width={x1 - x0}
                                height={TIMELINE.bandHeight}
                                fill={color}
                              />
                            );
                          })}
                      </g>
                      {lanePainted.map((item) => {
                        const selected = selectedIds.includes(item.id);
                        const [x0, x1] = itemExtent(item, view, geometry);
                        const common = {
                          "data-timeline-item": item.id,
                          "data-kind": item.kind,
                          "data-importance": item.importance,
                          ...(item.offMap ? { "data-off-map": true } : {}),
                          ...(selected ? { "data-selected": true } : {}),
                          ...(existsInYear(item, year) ? { "data-current": true } : {}),
                        };
                        return item.kind === "instant" ? (
                          item.offMap ? (
                            // 地図に出ない項目: 塗りつぶさず、分類色の輪郭と、中心の白い穴だけを描く。レーンの最後に描くので（byTimelinePaintOrder）、
                            // 同じ年に塗りつぶしの点があれば、その上に白い穴として見える。単独なら、輪郭だけの点に見える
                            <g key={item.id}>
                              <circle cx={(x0 + x1) / 2} cy={cy} r={POINT_RADIUS * TIMELINE.offMapHoleRatio} fill={GRAY.surface} />
                              <circle
                                {...common}
                                cx={(x0 + x1) / 2}
                                cy={cy}
                                r={POINT_RADIUS}
                                fill="none"
                                stroke={selected ? SELECTION_RING.color : color}
                                strokeWidth={selected ? SELECTION_RING.width : TIMELINE.bandStrokeWidth}
                              />
                            </g>
                          ) : (
                            <circle
                              key={item.id}
                              {...common}
                              cx={(x0 + x1) / 2}
                              cy={cy}
                              r={POINT_RADIUS}
                              fill={color}
                              stroke={selected ? SELECTION_RING.color : GRAY.surface}
                              strokeWidth={selected ? SELECTION_RING.width : TIMELINE.bandStrokeWidth}
                            />
                          )
                        ) : (
                          <rect
                            key={item.id}
                            {...common}
                            x={x0}
                            y={cy - TIMELINE.bandHeight / 2}
                            width={x1 - x0}
                            height={TIMELINE.bandHeight}
                            fill="none"
                            stroke={selected ? SELECTION_RING.color : color}
                            strokeWidth={
                              selected
                                ? SELECTION_RING.width
                                : existsInYear(item, year)
                                  ? TIMELINE.current.bandStrokeWidth
                                  : TIMELINE.bandStrokeWidth
                            }
                            {...(item.offMap ? { strokeDasharray: TIMELINE.offMapDash } : {})}
                          />
                        );
                      })}
                      {/* 現在年を含む項目のラベルは強調する。左外から続く帯のラベルは、左端に貼り付けてある（labelsInWindow） */}
                      {laneLabels.map((label) => (
                        <text
                          key={label.id}
                          data-timeline-label={label.id}
                          {...(label.pinned ? { "data-pinned": true } : {})}
                          {...(label.current ? { "data-current": true } : {})}
                          x={label.x}
                          y={cy}
                          dominantBaseline="central"
                          fontSize={textStyle.caption.fontSize}
                          fontWeight={label.current ? TIMELINE.current.labelWeight : textStyle.caption.fontWeight}
                          fill={label.current ? TIMELINE.current.labelColor : textStyle.caption.color}
                          pointerEvents="none"
                        >
                          {label.text}
                        </text>
                      ))}
                    </g>
                  );
                })}
              </g>

              {/* 現在年の縦線（窓の中央） */}
              <line
                data-timeline-cursor
                x1={width / 2}
                x2={width / 2}
                y1={0}
                y2={lanesHeight + TIMELINE.axisTick.length}
                stroke={TIMELINE.cursorLine.color}
                strokeWidth={TIMELINE.cursorLine.width}
                pointerEvents="none"
              />
            </svg>
          )}
          {hover !== null && (
            <div
              ref={tooltipRef}
              role="tooltip"
              className="hv-popup-content pointer-events-none absolute z-10 w-max -translate-x-1/2"
              style={{
                left: hover.x,
                bottom: height - hover.y + SPACE[12],
                maxWidth: width,
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
