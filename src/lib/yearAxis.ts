import type { Year } from "@/types/event";
import { bce, formatYear } from "./year";

/*
 * 年スライダーの時間軸の目盛り（axisTicks）の位置計算。YearSlider の描画から切り離した純粋関数。
 * 年の絶対位置で、データやフィルタで変わらない。yearToX で x 座標に変換する。
 * イベントのある年を示す目盛り（R2〜R4 の「目盛り B」）は、R5a で年表（timelineChart.ts）に役割を移して廃止した。
 */

export interface SliderScale {
  readonly min: Year;
  readonly max: Year;
  /** input（＝トラック）の幅 (px) */
  readonly width: number;
  /** つまみの直径 (px) */
  readonly thumbDiameter: number;
}

/**
 * 年を、トラックの左端からの x 座標 (px) に変換する。つまみの中心と一致する位置を返す。
 * つまみの中心が動けるのは [半径, 幅 − 半径] の範囲なので、トラックの全幅ではなく
 * 「幅 − 直径」を等分する（全幅で等分すると両端で半径ぶんずれる）。
 */
export const yearToX = (year: Year, scale: SliderScale): number => {
  const span = scale.max - scale.min;
  const fraction = span === 0 ? 0 : (year - scale.min) / span;
  const radius = scale.thumbDiameter / 2;
  return radius + fraction * Math.max(0, scale.width - scale.thumbDiameter);
};

export interface AxisTick {
  /** 天文年 */
  readonly year: Year;
  /**
   * 暦の上での通し番号（紀元前 N 年 → −N、紀元元年 → 0、N 年 → N）。ラベルを何年ごとに付けるかの判定用。
   * 紀元前1年の次が紀元1年で 0 年が無いため、天文年ではなくこの値で「1000年ごと」を数える。
   */
  readonly calendar: number;
  /** 紀元元年（天文年 1）。天文年 0 は紀元前1年なので、0 ではない。 */
  readonly epoch: boolean;
}

export const AXIS_TICK_STEP = 100;

/**
 * 紀元前3000年から2000年まで100年ごと、計51本。
 * 紀元前は「紀元前 N 年」（天文年 1−N）、紀元後は「N 年」に打ち、その間に紀元元年（天文年 1）を置く。
 * 暦に 0 年が無いため、紀元元年から100年までの間隔だけ 99 年になる（1年の差は 1px 未満）。
 */
export const axisTicks = (
  firstBce: number = 3000,
  lastCe: number = 2000,
  step: number = AXIS_TICK_STEP,
): readonly AxisTick[] => {
  const bceTicks = Array.from({ length: Math.floor(firstBce / step) }, (_, i) => firstBce - i * step).map(
    (n): AxisTick => ({ year: bce(n), calendar: -n, epoch: false }),
  );
  const epochTick: AxisTick = { year: 1, calendar: 0, epoch: true };
  const ceTicks = Array.from({ length: Math.floor(lastCe / step) }, (_, i) => (i + 1) * step).map(
    (n): AxisTick => ({ year: n, calendar: n, epoch: false }),
  );
  return [...bceTicks, epochTick, ...ceTicks];
};

export interface AxisLabel {
  readonly year: Year;
  readonly text: string;
}

/** ラベルを付ける間隔の候補（年）。狭い画面では、詰まらない最小の間隔を選ぶ。 */
export const AXIS_LABEL_STEPS: readonly number[] = [1000, 2000];

export const axisLabelText = (tick: AxisTick): string => (tick.epoch ? "紀元元年" : formatYear(tick.year));

/**
 * 時間軸のラベル。
 * - 間隔は AXIS_LABEL_STEPS のうち、隣り合うラベルの中心間隔が minSpacing 以上になる最小のもの。どれも詰まるなら出さない。
 * - トラックの端から minSpacing / 2 以内のラベルは出さない。端の「紀元前3001年」「2025年」表示と重なり、
 *   はみ出しもするため（紀元前3000年と2000年がこれにあたる）。
 */
export const axisLabels = (
  ticks: readonly AxisTick[],
  scale: SliderScale,
  minSpacing: number,
  steps: readonly number[] = AXIS_LABEL_STEPS,
): readonly AxisLabel[] => {
  const pxPerYear = Math.max(0, scale.width - scale.thumbDiameter) / Math.max(1, scale.max - scale.min);
  const step = steps.find((s) => s * pxPerYear >= minSpacing);
  if (step === undefined) return [];
  return ticks
    .filter((tick) => tick.calendar % step === 0)
    .filter((tick) => {
      const x = yearToX(tick.year, scale);
      return x >= minSpacing / 2 && x <= scale.width - minSpacing / 2;
    })
    .map((tick) => ({ year: tick.year, text: axisLabelText(tick) }));
};
