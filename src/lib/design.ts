import type { CSSProperties } from "react";
import type { Domain } from "@/types/event";

/*
 * デザインの基準値。色・余白・文字・面のスタイルはすべてここから読む。
 * 方針（CLAUDE.md「デザイン」節）: 主役は地図。UI は地図より前に出ない。
 */

// ── 色 ────────────────────────────────────────────────────
// 使ってよい色は「地図の2色 + 分類の7色 + グレースケール5段階」だけ。

/** 地図の2色 */
export const MAP_COLORS = {
  land: "#e8e0c8",
  ocean: "#a8c8e0",
} as const;

/**
 * 分類の7色。マーカーは白い縁取り（MARKER.strokeWidth）で囲むため、分類色が接する背景は白だけになる。
 * 要件は「白 #ffffff に対して WCAG コントラスト比 3:1 以上」。
 * Okabe-Ito（黒を除く7色）をそのまま使い、白に対して 3:1 に届かない3色（空色・黄・橙）だけ、
 * 色相を保ったまま OKLCH の明度を 3:1 に届くところまで下げた（彩度は色域に収まる範囲で維持）。
 * 白に対するコントラスト比: conflict 3.87, polity 3.06, science 5.19, technology 3.03,
 * economy 3.02, culture 3.01, population 3.42
 * マーカーは不透明度 1.0 で描く（不透明度を下げると実効コントラストが 3:1 を割る）。
 */
export const DOMAIN_COLORS: Readonly<Record<Domain, string>> = {
  conflict: "#D55E00", // vermillion（無調整）
  polity: "#CC79A7", // reddish purple（無調整）
  science: "#0072B2", // blue（無調整）
  technology: "#3d9dd1", // sky blue #56B4E9 の明度を下げたもの
  economy: "#a19705", // yellow #F0E442 の明度を下げたもの
  culture: "#c68908", // orange #E69F00 の明度を下げたもの
  population: "#009E73", // bluish green（無調整）
};

/** グレースケール5段階 */
export const GRAY = {
  /** 面の背景、マーカーの縁取り */
  surface: "#ffffff",
  /** 境界線・スライダーのトラック */
  line: "#d9d9d9",
  /** 弱いテキスト・スライダーのつまみ・海岸線 */
  weak: "#6b6b6b",
  /** 通常テキスト */
  text: "#333333",
  /** 強調テキスト */
  strong: "#111111",
} as const;

// ── 余白・角丸・影 ─────────────────────────────────────────

/** 余白はこの段階からのみ選ぶ */
export const SPACE = { 4: 4, 8: 8, 12: 12, 16: 16, 24: 24, 32: 32 } as const;

/** 角丸は 0 / 4 / 8 のみ */
export const RADIUS = { none: 0, small: 4, medium: 8 } as const;

/** キーボードフォーカスの輪郭線の太さ */
export const FOCUS_RING_WIDTH = 2;

/** 影は1種類のみ（地図の上に浮いている面を1段区別する用途） */
export const SHADOW = "0 1px 4px rgba(0, 0, 0, 0.2)";

// ── 文字 ──────────────────────────────────────────────────

/** フォントファミリは1つ（端末内蔵のフォントのみ。外部フォントは読み込まない） */
export const FONT_FAMILY =
  'system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", sans-serif';

/** 文字サイズは4段階 */
export const FONT_SIZE = { caption: 11, body: 13, emphasis: 15, year: 20 } as const;

/** 太さは2段階 */
export const FONT_WEIGHT = { regular: 400, bold: 600 } as const;

export const LINE_HEIGHT = 1.5;

// ── マーカー ───────────────────────────────────────────────

export const MARKER = {
  /** importance 1 / 2 / 3 の半径 (px)。年の差に応じてこれに fade（0.5〜1）を掛ける。 */
  radius: { 1: 4, 2: 6, 3: 8 },
  /** 白い縁取り（ハロー）。分類色が接する背景を白に統一するため 2px。 */
  strokeColor: GRAY.surface,
  strokeWidth: 2,
  /** 凡例で別の分類を強調しているときに、それ以外のマーカーに掛ける不透明度 */
  dimOpacity: 0.15,
} as const;

/** 地図の線 */
export const MAP_LINE = {
  coastlineColor: GRAY.weak,
  coastlineWidth: 0.5,
} as const;

// ── 共有スタイル ───────────────────────────────────────────

/** パネル・凡例・ポップアップが共有する「面」 */
export const surfaceStyle: CSSProperties = {
  backgroundColor: GRAY.surface,
  borderRadius: RADIUS.medium,
  boxShadow: SHADOW,
  padding: SPACE[12],
};

export const textStyle = {
  caption: { fontSize: FONT_SIZE.caption, fontWeight: FONT_WEIGHT.regular, color: GRAY.weak },
  body: { fontSize: FONT_SIZE.body, fontWeight: FONT_WEIGHT.regular, color: GRAY.text },
  emphasis: { fontSize: FONT_SIZE.emphasis, fontWeight: FONT_WEIGHT.bold, color: GRAY.strong },
  year: {
    fontSize: FONT_SIZE.year,
    fontWeight: FONT_WEIGHT.bold,
    color: GRAY.strong,
    fontVariantNumeric: "tabular-nums",
  },
} as const satisfies Record<string, CSSProperties>;

/** 分類の色見本（マーカーと同じ円）。直径 8px・角丸 4px。 */
export const swatchStyle = (domain: Domain): CSSProperties => ({
  width: SPACE[8],
  height: SPACE[8],
  borderRadius: RADIUS.small,
  backgroundColor: DOMAIN_COLORS[domain],
  flexShrink: 0,
});

/** 画面端からパネルまでの距離 */
export const SCREEN_INSET = SPACE[16];

/** 年スライダーのパネルの最大幅 */
export const SLIDER_PANEL_MAX_WIDTH = 896;

/** 年表示の最小幅（「紀元前3001年」が収まり、桁数の変化で揺れない幅） */
export const YEAR_LABEL_MIN_WIDTH = 144;

/**
 * CSS からも同じ値を使うためのカスタムプロパティ。
 * MapLibre のポップアップと input[type=range] の擬似要素は style 属性で指定できないため、
 * globals.css からこれらを参照する。
 */
export const cssVariables: Readonly<Record<`--${string}`, string>> = {
  "--hv-font-family": FONT_FAMILY,
  "--hv-line-height": String(LINE_HEIGHT),
  "--hv-font-caption": `${FONT_SIZE.caption}px`,
  "--hv-font-body": `${FONT_SIZE.body}px`,
  "--hv-font-emphasis": `${FONT_SIZE.emphasis}px`,
  "--hv-gray-surface": GRAY.surface,
  "--hv-gray-line": GRAY.line,
  "--hv-gray-weak": GRAY.weak,
  "--hv-gray-text": GRAY.text,
  "--hv-space-4": `${SPACE[4]}px`,
  "--hv-space-8": `${SPACE[8]}px`,
  "--hv-space-12": `${SPACE[12]}px`,
  "--hv-space-16": `${SPACE[16]}px`,
  "--hv-space-24": `${SPACE[24]}px`,
  "--hv-radius-small": `${RADIUS.small}px`,
  "--hv-radius-medium": `${RADIUS.medium}px`,
  "--hv-shadow": SHADOW,
  "--hv-focus-ring-width": `${FOCUS_RING_WIDTH}px`,
};
