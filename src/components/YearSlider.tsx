"use client";

import { SPACE, YEAR_LABEL_MIN_WIDTH, surfaceStyle, textStyle } from "@/lib/design";
import { formatYear } from "@/lib/year";
import type { Year } from "@/types/event";

interface YearSliderProps {
  readonly year: Year;
  readonly min: Year;
  readonly max: Year;
  readonly onChange: (year: Year) => void;
}

export function YearSlider({ year, min, max, onChange }: YearSliderProps) {
  const label = formatYear(year);
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
      <span className="hidden shrink-0 sm:inline" style={textStyle.caption}>
        {formatYear(min)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={year}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        aria-label="年"
        aria-valuetext={label}
        className="hv-range min-w-0 flex-1"
      />
      <span className="hidden shrink-0 sm:inline" style={textStyle.caption}>
        {formatYear(max)}
      </span>
    </div>
  );
}
