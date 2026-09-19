"use client";

import { useEffect, useMemo, useState } from "react";
import { sampleEvents } from "@/data/events.sample";
import { INITIAL_YEAR, YEAR_MAX, YEAR_MIN, instantEventMarkers } from "@/lib/timeline";
import { clampYear } from "@/lib/year";
import { WorldMapClient } from "./WorldMapClient";
import { YearSlider } from "./YearSlider";

/** 左右キーで年を動かす（Shift 併用で 10 年単位）。入力要素にフォーカスがあるときはそちらに任せる。 */
const yearStepFromKey = (event: KeyboardEvent): number => {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  ) {
    return 0;
  }
  const unit = event.shiftKey ? 10 : 1;
  if (event.key === "ArrowLeft") return -unit;
  if (event.key === "ArrowRight") return unit;
  return 0;
};

export function EventMapApp() {
  const [year, setYear] = useState(INITIAL_YEAR);
  const markers = useMemo(() => instantEventMarkers(sampleEvents, year), [year]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = yearStepFromKey(event);
      if (step === 0) return;
      event.preventDefault();
      setYear((current) => clampYear(current + step, YEAR_MIN, YEAR_MAX));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative h-full w-full">
      <WorldMapClient markers={markers} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
        <div className="pointer-events-auto mx-auto max-w-4xl">
          <YearSlider
            year={year}
            min={YEAR_MIN}
            max={YEAR_MAX}
            onChange={(next) => setYear(clampYear(next, YEAR_MIN, YEAR_MAX))}
          />
        </div>
      </div>
    </div>
  );
}
