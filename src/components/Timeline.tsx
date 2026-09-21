"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DOMAIN_COLORS,
  GRAY,
  MARKER,
  SELECTION_RING,
  SPACE,
  TIMELINE,
  surfaceStyle,
  textStyle,
} from "@/lib/design";
import { DOMAIN_LABELS } from "@/lib/domain";
import { popupContent } from "@/lib/popupContent";
import { TIMELINE_WHEEL_SENSITIVITY } from "@/lib/timeline";
import {
  byTimelinePaintOrder,
  itemExtent,
  itemsAtX,
  itemsInYear,
  laneHistogram,
  laneModes,
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
  /** 凡例でホバー中の分類。そのレーンだけを強調する */
  readonly highlightedDomain: Domain | null;
  readonly selectedIds: readonly string[];
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

/**
 * ヒストグラムのレーン。1 年刻みの棒を、1つの path にまとめて描く（±500 年で 1,000 本になるため）。
 * 棒は、その年を中心に 1 年ぶんの幅。高さは、窓の中でいちばん件数の多い年をレーンの高さに合わせて正規化する。
 */
function LaneHistogram({
  bins,
  view,
  width,
  bottom,
  color,
}: {
  readonly bins: readonly HistogramBin[];
  readonly view: TimelineWindow;
  readonly width: number;
  readonly bottom: number;
  readonly color: string;
}) {
  const max = Math.max(1, ...bins.map((bin) => bin.count));
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
  highlightedDomain,
  selectedIds,
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
    () => ({ width, pointRadius: POINT_RADIUS, minBandWidth: TIMELINE.minBandWidth }),
    [width],
  );
  const lanes = useMemo(() => timelineLanes(hiddenDomains), [hiddenDomains]);
  const items = useMemo(() => timelineItems(events, view, hiddenDomains), [events, view, hiddenDomains]);
  const painted = useMemo(() => [...items].sort(byTimelinePaintOrder), [items]);
  // 項目が多すぎて点が並びきらないレーンは、ヒストグラムにする
  const modes = useMemo(() => laneModes(items, geometry), [items, geometry]);
  const labels = useMemo(
    () =>
      width === 0
        ? []
        : timelineLabels(
            items,
            view,
            geometry,
            { fontSize: textStyle.caption.fontSize, gap: TIMELINE.labelGap },
            modes,
          ),
    [items, view, geometry, width, modes],
  );
  const axisStep = timelineAxisStep(view, width, TIMELINE.axisLabelMinSpacing);
  const ticks = useMemo(
    () => timelineAxisTicks(view, axisStep).filter((tick) => tick.year >= min && tick.year <= max),
    [view, axisStep, min, max],
  );

  const lanesHeight = lanes.length * TIMELINE.laneHeight;
  const height = lanesHeight + TIMELINE.axisHeight;

  /** ポインタの位置にある項目（レーンの外なら空）。ヒストグラムのレーンでは、その年に存在する項目 */
  const hitAt = (x: number, y: number): Pick<Hover, "items" | "heading"> => {
    const lane = lanes[Math.floor(y / TIMELINE.laneHeight)];
    if (lane === undefined || y < 0) return { items: [], heading: null };
    if (modes[lane] === "items") {
      return { items: itemsAtX(items, lane, x, TIMELINE.hitTolerance, view, geometry), heading: null };
    }
    const hitYear = yearAtX(x, view, width);
    const found = itemsInYear(items, lane, hitYear, view.center);
    return { items: found, heading: `${formatYear(hitYear)}: ${found.length}件` };
  };

  // ── ドラッグ（現在年を動かす）とクリック ──
  // ドラッグ中は、押した時点の年と窓を基準に年を決める（窓は現在年と一緒に動くので、直前の位置との差分では決められない）
  const drag = useRef<{ readonly x: number; readonly year: Year; readonly moved: boolean } | null>(null);
  const localPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, year, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const started = drag.current;
    if (started === null) {
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
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const started = drag.current;
    drag.current = null;
    if (started === null || started.moved) return;
    const { x, y } = localPoint(event);
    const hit = hitAt(x, y).items;
    if (hit.length === 0) onClickEmpty();
    else onSelectEvents(hit.map((item) => item.id));
  };

  // ── ホイール（窓の幅を変える） ──
  // React の onWheel は passive で preventDefault できないので、自前で登録する。最新の値は ref から読む
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef({ halfSpan, onSetHalfSpan });
  useEffect(() => {
    zoomRef.current = { halfSpan, onSetHalfSpan };
  }, [halfSpan, onSetHalfSpan]);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { halfSpan: current, onSetHalfSpan: set } = zoomRef.current;
      set(zoomedHalfSpan(current, event.deltaY, TIMELINE_WHEEL_SENSITIVITY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [width]);

  // ── ホバーの吹き出し（地図と同じ中身） ──
  const tooltipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hover === null || tooltipRef.current === null) return;
    const shown = hover.items.slice(0, TIMELINE.tooltipMaxItems);
    tooltipRef.current.replaceChildren(popupContent(shown, hover.items.length - shown.length, hover.heading));
  }, [hover]);

  const laneOpacity = (domain: Domain): number =>
    highlightedDomain === null || highlightedDomain === domain ? 1 : MARKER.dimOpacity;

  return (
    <section aria-label="年表" style={surfaceStyle}>
      <button
        type="button"
        className="flex w-full items-center justify-between sm:hidden"
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
        className={`relative ${expanded ? "block" : "hidden sm:block"}`}
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
            style={{ touchAction: "none", cursor: hover === null ? "grab" : "pointer" }}
            data-timeline
            data-half-span={halfSpan}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => (drag.current = null)}
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
              const labelFits = x >= TIMELINE.axisLabelMinSpacing / 2 && x <= width - TIMELINE.axisLabelMinSpacing / 2;
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

            {/* 項目。レーンごとにまとめ、凡例のホバーで他のレーンを弱める */}
            {lanes.map((domain, index) => {
              const cy = laneCenterY(index);
              const color = DOMAIN_COLORS[domain];
              const histogram = modes[domain] === "histogram";
              const lanePainted = histogram ? [] : painted.filter((item) => item.domain === domain);
              const laneLabels = labels.filter((label) => label.domain === domain);
              return (
                <g
                  key={domain}
                  data-timeline-lane={domain}
                  data-timeline-lane-mode={modes[domain]}
                  opacity={laneOpacity(domain)}
                >
                  <title>{DOMAIN_LABELS[domain]}</title>
                  {histogram && (
                    <LaneHistogram
                      bins={laneHistogram(items, domain, view)}
                      view={view}
                      width={width}
                      bottom={(index + 1) * TIMELINE.laneHeight}
                      color={color}
                    />
                  )}
                  {/* ヒストグラムのレーンには点が無いので、ラベルの付いた項目の開始年に縦線を引いて、どの年かを示す */}
                  {histogram &&
                    laneLabels.map((label) => (
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
                  {/* 帯の塗り。不透明度はグループに掛ける（重なっても濃くならない） */}
                  <g opacity={TIMELINE.bandFillOpacity}>
                    {lanePainted
                      .filter((item) => item.kind === "period")
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
                      ...(selected ? { "data-selected": true } : {}),
                    };
                    return item.kind === "instant" ? (
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
                        strokeWidth={selected ? SELECTION_RING.width : TIMELINE.bandStrokeWidth}
                      />
                    );
                  })}
                  {laneLabels.map((label) => (
                      <text
                        key={label.id}
                        data-timeline-label={label.id}
                        x={label.x}
                        y={cy}
                        dominantBaseline="central"
                        fontSize={textStyle.caption.fontSize}
                        fontWeight={textStyle.caption.fontWeight}
                        fill={textStyle.caption.color}
                        pointerEvents="none"
                      >
                        {label.text}
                      </text>
                    ))}
                </g>
              );
            })}

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
            style={{ left: hover.x, bottom: height - hover.y + SPACE[12], maxWidth: width }}
          />
        )}
      </div>
    </section>
  );
}
