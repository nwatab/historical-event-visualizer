"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PLAYBACK_INITIAL_SPEED,
  nextPlaybackSpeed,
  playbackYear,
  type PlaybackSpeed,
} from "./timeline";
import type { Year } from "@/types/event";

interface Playback {
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  readonly toggle: () => void;
  readonly stop: () => void;
  readonly cycleSpeed: () => void;
}

/**
 * 再生。現在年を speed（年/秒）で進め、max に達したら止まる。
 * 年は、再生を始めた（または速度を変えた）時点からの経過時間で決める（timeline.ts の playbackYear）。
 * 再生中かどうかと速度は、共有する画面の状態（AppState）には入れない。一時的な状態で、URL に載せても意味が無いため。
 */
export const usePlayback = (year: Year, max: Year, onSetYear: (year: Year) => void): Playback => {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(PLAYBACK_INITIAL_SPEED);

  // アニメーションのループからは、最新の年を ref 経由で読む（年が変わるたびにループを張り直さない）
  const yearRef = useRef(year);
  useEffect(() => {
    yearRef.current = year;
  }, [year]);

  useEffect(() => {
    if (!playing) return;
    const startYear = yearRef.current;
    const startTime = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.min(max, playbackYear(startYear, now - startTime, speed));
      if (next !== yearRef.current) onSetYear(next);
      if (next >= max) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, max, onSetYear]);

  const toggle = useCallback(() => setPlaying((v) => !v && yearRef.current < max), [max]);
  const stop = useCallback(() => setPlaying(false), []);
  const cycleSpeed = useCallback(() => setSpeed(nextPlaybackSpeed), []);
  return { playing, speed, toggle, stop, cycleSpeed };
};
