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
 * 要件は「白 #ffffff に対して WCAG コントラスト比 3:1 以上」。3:1 は下限であって目標値ではない。
 * Okabe-Ito（黒を除く7色）を基に、白に対して 3:1 に届かない空色・黄・橙の明度を下げた。
 * そのうえで黄・橙・朱の3色を互いに離すため、橙と朱をさらに下げている（色相は維持、
 * 彩度は色域に収まる範囲で維持）。評価基準は21ペアの OKLab 距離の最小値（CLAUDE.md 参照）。
 * 白に対するコントラスト比 / OKLCH L:
 *   conflict 5.27 / 0.544, polity 3.06 / 0.679, science 5.19 / 0.532, technology 3.03 / 0.662,
 *   economy 3.02 / 0.664, culture 4.03 / 0.600, population 3.42 / 0.620
 * マーカーは不透明度 1.0 で描く（不透明度を下げると実効コントラストが 3:1 を割る）。
 */
export const DOMAIN_COLORS: Readonly<Record<Domain, string>> = {
  conflict: "#b24e03", // vermillion #D55E00 の明度を下げたもの（L 0.621 → 0.544）
  polity: "#CC79A7", // reddish purple（無調整）
  science: "#0072B2", // blue（無調整）
  technology: "#3d9dd1", // sky blue #56B4E9 の明度を下げたもの（L 0.735 → 0.662）
  economy: "#a19705", // yellow #F0E442 の明度を下げたもの（L 0.902 → 0.664）
  culture: "#aa7400", // orange #E69F00 の明度を下げたもの（L 0.753 → 0.600）
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
  /**
   * 年の差で縮めたときの半径の下限 (px)。縁取りは円の外側に 2px 付くため、半径 2px まで縮むと
   * 色の面積より白の面積が大きくなり「白い輪」に見える（importance 1 を窓の端で実測、色の面積比 8%）。
   * 3px にすると 20〜26% になり、色の点として読める。
   */
  minRadius: 3,
  /** 白い縁取り（ハロー）。分類色が接する背景を白に統一するため 2px。 */
  strokeColor: GRAY.surface,
  strokeWidth: 2,
  /** 凡例で別の分類を強調しているときに、それ以外のマーカーに掛ける不透明度 */
  dimOpacity: 0.15,
  /**
   * period のマーカーは中抜きの輪にする（instant は塗りつぶしの円）。半径のうち内側のこの割合を白で抜く。
   * 輪の色は内側も外側（白い縁取り）も白に接するので、白に対する 3:1 の要件はそのまま満たす。
   * importance 1（半径 4px）でも輪の太さが 2px 残るよう 0.5 にしている。
   */
  periodHoleRatio: 0.5,
} as const;

/** 選択中のマーカーの輪（白い縁取りの外側に付ける）。既存の値を使う。 */
export const SELECTION_RING = {
  color: GRAY.strong,
  width: MARKER.strokeWidth,
} as const;

/** マーカーのクリック判定の余裕 (px)。タッチでも小さいマーカーを選べるように。 */
export const MARKER_HIT_TOLERANCE = SPACE[4];

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

/** 時間種別の見本（凡例用）。instant は塗りつぶしの円、period は中抜きの輪。分類色は使わずグレーで描く。 */
export const kindSwatchStyle = (kind: "instant" | "period"): CSSProperties => ({
  width: SPACE[8],
  height: SPACE[8],
  borderRadius: RADIUS.small,
  boxSizing: "border-box",
  flexShrink: 0,
  ...(kind === "instant"
    ? { backgroundColor: GRAY.weak }
    : {
        backgroundColor: GRAY.surface,
        border: `${SPACE[8] * 0.5 * (1 - MARKER.periodHoleRatio)}px solid ${GRAY.weak}`,
      }),
});

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

/** 詳細パネル */
export const DETAIL_PANEL = {
  /** 幅の広い画面で右側に置くときの幅 (px) */
  width: 320,
  /** 狭い画面で上部に出すシートの最大の高さ（地図を完全には塞がない） */
  sheetMaxHeight: "50%",
} as const;

/**
 * 年スライダーと目盛り。目盛りは input の背後に重ねた別の要素で描く（擬似要素には子要素を置けないため）。
 * - A 時間軸の目盛り（固定）: トラックの下側に、薄いグレー（GRAY.line）の短い線。紀元元年だけ太く長くする。
 * - B イベントの目盛り（可変）: トラックの上側に、濃いグレー（GRAY.weak）の細い線。period は開始〜終了の帯。
 * どちらもつまみ（直径 16px の GRAY.weak の円）より細く小さい。
 */
export const SLIDER = {
  /** input の高さ。トラックはこの中央に描かれる。 */
  height: SPACE[24],
  trackHeight: SPACE[4],
  /** つまみの直径。つまみの中心が動ける範囲は「トラックの幅 − この値」。 */
  thumbDiameter: SPACE[16],
  axisTick: { color: GRAY.line, width: 1, length: SPACE[4] },
  /** 紀元元年（天文年 1）の目盛り。色は変えず、太さと長さで区別する。 */
  epochTick: { color: GRAY.line, width: 2, length: SPACE[8] },
  eventTick: { color: GRAY.weak, width: 1, length: SPACE[8] },
  /** period の帯の太さ。B の領域の上端に、開始年から終了年まで横に引く。 */
  periodBandThickness: 2,
  /** 時間軸のラベルどうしの中心間隔の下限。「紀元前2000年」（約 70px）＋余白。これより詰まるなら間引く。 */
  axisLabelMinSpacing: 96,
} as const;

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
  "--hv-panel-width": `${DETAIL_PANEL.width}px`,
  "--hv-sheet-max-height": DETAIL_PANEL.sheetMaxHeight,
  "--hv-slider-height": `${SLIDER.height}px`,
  "--hv-slider-track-height": `${SLIDER.trackHeight}px`,
  "--hv-slider-thumb": `${SLIDER.thumbDiameter}px`,
};
