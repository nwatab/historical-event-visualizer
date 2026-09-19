"use client";

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-white/85 px-4 py-3 shadow-md backdrop-blur">
      <output className="order-first w-full text-center text-lg font-semibold tabular-nums text-neutral-900 sm:order-last sm:w-32 sm:text-right">
        {label}
      </output>
      <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">{formatYear(min)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={year}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        aria-label="年"
        aria-valuetext={label}
        className="h-2 min-w-0 flex-1 cursor-pointer accent-neutral-700"
      />
      <span className="hidden shrink-0 text-xs text-neutral-500 sm:inline">{formatYear(max)}</span>
    </div>
  );
}
