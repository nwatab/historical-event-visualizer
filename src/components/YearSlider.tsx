"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { LINE_HEIGHT, SLIDER, SPACE, YEAR_LABEL_MIN_WIDTH, surfaceStyle, textStyle } from "@/lib/design";
import { formatYear } from "@/lib/year";
import {
  axisLabels,
  axisTicks,
  yearToX,
  type EventTicks,
  type SliderScale,
} from "@/lib/yearAxis";
import type { Year } from "@/types/event";

interface YearSliderProps {
  readonly year: Year;
  readonly min: Year;
  readonly max: Year;
  /** B（イベントの目盛り）。非表示の分類は親が除いて渡す。 */
  readonly eventTicks: EventTicks;
  readonly onChange: (year: Year) => void;
}

const AXIS_TICKS = axisTicks();

/** トラックの上端・下端（input の高さの中で、トラックは中央に描かれる） */
const TRACK_TOP = (SLIDER.height - SLIDER.trackHeight) / 2;
const TRACK_BOTTOM = TRACK_TOP + SLIDER.trackHeight;

/** x を中心とする縦線 */
const vLine = (x: number, top: number, width: number, length: number, color: string): CSSProperties => ({
  position: "absolute",
  left: x - width / 2,
  top,
  width,
  height: length,
  backgroundColor: color,
});

/**
 * 目盛りの層。input の背後に置く（input が後に描かれ、つまみが目盛りを覆う）。
 * - A はトラックの下側、B はトラックの上側に描くので、両者は重ならない。
 */
function YearTicks({ scale, eventTicks }: { readonly scale: SliderScale; readonly eventTicks: EventTicks }) {
  const { axisTick, epochTick, eventTick, periodBandThickness } = SLIDER;
  const eventTop = TRACK_TOP - eventTick.length;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {AXIS_TICKS.map((tick) => {
        const style = tick.epoch ? epochTick : axisTick;
        return (
          <span
            key={`axis-${tick.year}`}
            data-tick="axis"
            data-year={tick.year}
            style={vLine(yearToX(tick.year, scale), TRACK_BOTTOM, style.width, style.length, style.color)}
          />
        );
      })}
      {eventTicks.periods.map(({ start, end }) => {
        const left = yearToX(start, scale);
        return (
          <span
            key={`period-${start}-${end}`}
            data-tick="period"
            data-year={start}
            data-end={end}
            style={{
              position: "absolute",
              left,
              top: eventTop,
              width: Math.max(eventTick.width, yearToX(end, scale) - left),
              height: periodBandThickness,
              backgroundColor: eventTick.color,
            }}
          />
        );
      })}
      {eventTicks.instants.map((year) => (
        <span
          key={`event-${year}`}
          data-tick="event"
          data-year={year}
          style={vLine(yearToX(year, scale), eventTop, eventTick.width, eventTick.length, eventTick.color)}
        />
      ))}
    </div>
  );
}

/** 時間軸のラベル。トラックの幅に応じて間引く（詰まるなら出さない）。 */
function AxisLabels({ scale }: { readonly scale: SliderScale }) {
  const labels = axisLabels(AXIS_TICKS, scale, SLIDER.axisLabelMinSpacing);
  if (labels.length === 0) return null;
  return (
    <div className="relative" style={{ height: textStyle.caption.fontSize * LINE_HEIGHT }} aria-hidden>
      {labels.map(({ year, text }) => (
        <span
          key={year}
          data-axis-label={year}
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
          style={{ left: yearToX(year, scale), ...textStyle.caption, fontVariantNumeric: "tabular-nums" }}
        >
          {text}
        </span>
      ))}
    </div>
  );
}

/** 要素の幅 (px) を追跡する。目盛りの位置は input の実際の幅から計算する。 */
const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};

export function YearSlider({ year, min, max, eventTicks, onChange }: YearSliderProps) {
  const label = formatYear(year);
  const [trackRef, width] = useWidth();
  const scale = useMemo<SliderScale>(
    () => ({ min, max, width, thumbDiameter: SLIDER.thumbDiameter }),
    [min, max, width],
  );
  return (
    <div
      className="flex flex-wrap items-center"
      style={{ ...surfaceStyle, columnGap: SPACE[16], rowGap: SPACE[4] }}
    >
      <output
        className="order-first w-full text-center sm:order-last sm:w-auto sm:text-right"
        style={{ ...textStyle.year, minWidth: YEAR_LABEL_MIN_WIDTH }}
      >
        {label}
      </output>
      <span className="hidden shrink-0 self-start sm:inline" style={textStyle.caption}>
        {formatYear(min)}
      </span>
      <div className="min-w-0 flex-1">
        <div ref={trackRef} className="relative" style={{ height: SLIDER.height }}>
          {width > 0 && <YearTicks scale={scale} eventTicks={eventTicks} />}
          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={year}
            onChange={(e) => onChange(Number(e.currentTarget.value))}
            aria-label="年"
            aria-valuetext={label}
            className="hv-range relative block w-full"
          />
        </div>
        {width > 0 && <AxisLabels scale={scale} />}
      </div>
      <span className="hidden shrink-0 self-start sm:inline" style={textStyle.caption}>
        {formatYear(max)}
      </span>
    </div>
  );
}
