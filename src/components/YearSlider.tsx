"use client";

import { useMemo, type CSSProperties } from "react";
import { LINE_HEIGHT, SLIDER, SPACE, YEAR_LABEL_MIN_WIDTH, surfaceStyle, textStyle } from "@/lib/design";
import { useWidth } from "@/lib/useWidth";
import { formatYear } from "@/lib/year";
import { axisLabels, axisTicks, yearToX, type SliderScale } from "@/lib/yearAxis";
import type { Year } from "@/types/event";

interface YearSliderProps {
  readonly year: Year;
  readonly min: Year;
  readonly max: Year;
  readonly onChange: (year: Year) => void;
}

const AXIS_TICKS = axisTicks();

/** トラックの下端（input の高さの中で、トラックは中央に描かれる） */
const TRACK_BOTTOM = (SLIDER.height + SLIDER.trackHeight) / 2;

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
 * 時間軸の目盛りの層。input の背後に置く（input が後に描かれ、つまみが目盛りを覆う）。トラックの下側に描く。
 * イベントのある年を示す目盛り（トラックの上側）は、R5a で年表に役割を移して廃止した。
 */
function YearTicks({ scale }: { readonly scale: SliderScale }) {
  const { axisTick, epochTick } = SLIDER;
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

export function YearSlider({ year, min, max, onChange }: YearSliderProps) {
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
        className="order-first w-full text-center wide:order-last wide:w-auto wide:text-right"
        style={{ ...textStyle.year, minWidth: YEAR_LABEL_MIN_WIDTH }}
      >
        {label}
      </output>
      <span className="hidden shrink-0 self-start wide:inline" style={textStyle.caption}>
        {formatYear(min)}
      </span>
      <div className="min-w-0 flex-1">
        <div ref={trackRef} className="relative" style={{ height: SLIDER.height }}>
          {width > 0 && <YearTicks scale={scale} />}
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
      <span className="hidden shrink-0 self-start wide:inline" style={textStyle.caption}>
        {formatYear(max)}
      </span>
    </div>
  );
}
