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
 * 分類の7色。Okabe-Ito（黒を除く7色）の色相と彩度を保ったまま OKLCH の明度だけを下げ、
 * 陸・海の両方に対して WCAG コントラスト比 3:1 以上にしたもの。
 * 明度は、通常視と色覚シミュレーション3種（Machado 2009）の全ペアで OKLab 距離の最小値が
 * 最大になるように選んだ（明度の下限は OKLCH L = 0.36）。
 * コントラスト比（陸 / 海）: conflict 8.52/6.42, polity 4.26/3.21, science 4.16/3.13,
 * technology 8.18/6.16, economy 4.11/3.10, culture 6.00/4.52, population 5.16/3.89
 */
export const DOMAIN_COLORS: Readonly<Record<Domain, string>> = {
  conflict: "#652900", // vermillion #D55E00 由来
  polity: "#9b4d7a", // reddish purple #CC79A7 由来
  science: "#036eac", // blue #0072B2 由来
  technology: "#004260", // sky blue #56B4E9 由来
  economy: "#736c01", // yellow #F0E442 由来
  culture: "#6f4a01", // orange #E69F00 由来
  population: "#02684b", // bluish green #009E73 由来
};

/** グレースケール5段階 */
export const GRAY = {
  /** 面の背景、マーカーの縁取り */
  surface: "#ffffff",
  /** 境界線・スライダーのトラック */
  line: "#d9d9d9",
  /** 弱いテキスト・スライダーのつまみ */
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
  /** importance 1 / 2 / 3 の半径 (px) */
  radius: { 1: 4, 2: 6, 3: 8 },
  strokeColor: GRAY.surface,
  strokeWidth: 1,
  /** 凡例で別の分類を強調しているときに、それ以外のマーカーに掛ける不透明度の係数 */
  dimFactor: 0.15,
  /**
   * 強調中の分類のマーカーの不透明度の下限。年の差でフェードしたマーカー（窓の端では 0.15）も
   * 強調中は見つけられるようにする。
   */
  highlightMinOpacity: 0.8,
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
