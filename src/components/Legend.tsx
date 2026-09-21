"use client";

import { useState } from "react";
import { GRAY, SPACE, kindSwatchDotStyle, kindSwatchStyle, surfaceStyle, swatchStyle, textStyle } from "@/lib/design";
import { DOMAINS, DOMAIN_LABELS } from "@/lib/domain";
import type { Domain } from "@/types/event";

interface LegendProps {
  /** 非表示にしている分類 */
  readonly hiddenDomains: readonly Domain[];
  /** 現在強調中の分類（ホバー・フォーカス中） */
  readonly highlighted: Domain | null;
  readonly onHover: (domain: Domain | null) => void;
  readonly onToggle: (domain: Domain) => void;
  readonly onShowAll: () => void;
}

/** 時間種別の見本と名前（形で区別する） */
const KIND_SWATCHES = [
  { kind: "instant", label: "一時点の出来事" },
  { kind: "period", label: "期間中の出来事" },
  { kind: "diffusion", label: "広がる出来事" },
] as const;

/** 色見本。非表示の分類は GRAY.line で塗る。 */
const legendSwatch = (domain: Domain, visible: boolean) => ({
  ...swatchStyle(domain),
  ...(visible ? {} : { backgroundColor: GRAY.line }),
});

/**
 * 分類の凡例兼フィルタ。
 * - クリック（タップ、Enter / Space）で、その分類の表示／非表示を切り替える
 * - ホバー・フォーカスで、その分類のマーカーを強調する（表示中の分類のみ）
 * 狭い画面では折りたたみ、色見本の列だけを表示する。
 */
export function Legend({ hiddenDomains, highlighted, onHover, onToggle, onShowAll }: LegendProps) {
  const [expanded, setExpanded] = useState(false);
  const isVisible = (domain: Domain) => !hiddenDomains.includes(domain);
  const allHidden = DOMAINS.every((domain) => !isVisible(domain));

  /** 非表示の分類があるときだけ出す（押しても何も起きない状態では置かない）。描画するのは常に1箇所だけ。 */
  const showAllButton = (
    <button
      type="button"
      className="text-left"
      style={{
        ...textStyle.caption,
        marginTop: SPACE[8],
        textDecoration: "underline",
        color: GRAY.weak,
      }}
      onClick={onShowAll}
    >
      すべて表示
    </button>
  );

  return (
    <nav aria-label="分類の凡例とフィルタ" style={surfaceStyle}>
      <button
        type="button"
        className="flex items-center roomy:hidden"
        style={{ gap: SPACE[8], ...textStyle.caption }}
        aria-expanded={expanded}
        aria-controls="legend-items"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>凡例</span>
        <span className="flex" style={{ gap: SPACE[4] }} aria-hidden>
          {DOMAINS.map((domain) => (
            <span key={domain} style={legendSwatch(domain, isVisible(domain))} />
          ))}
        </span>
      </button>
      {/*
        地図に何も出ない理由を示す。折りたたみ中の狭い画面でも見えるよう、折りたたむ部分の外に置く。
        全分類が非表示のときは、その場で戻せるよう「すべて表示」もここに置く（折りたたみの中には置かない）。
      */}
      <p role="status" style={{ ...textStyle.caption, color: GRAY.weak }}>
        {allHidden ? "すべての分類が非表示です" : ""}
      </p>
      {allHidden && showAllButton}
      <div
        id="legend-items"
        className={expanded ? "block" : "hidden roomy:block"}
        style={{ marginTop: expanded ? SPACE[8] : 0 }}
      >
        <p className="hidden roomy:block" style={{ ...textStyle.caption, marginBottom: SPACE[4] }}>
          分類（クリックで表示／非表示）
        </p>
        <ul className="flex flex-col">
          {DOMAINS.map((domain) => {
            const visible = isVisible(domain);
            const dimmed = highlighted !== null && highlighted !== domain;
            return (
              <li key={domain}>
                <button
                  type="button"
                  className="flex w-full items-center text-left"
                  style={{
                    gap: SPACE[8],
                    paddingBlock: SPACE[4],
                    ...textStyle.body,
                    color: !visible || dimmed ? GRAY.weak : GRAY.text,
                    textDecoration: visible ? "none" : "line-through",
                  }}
                  aria-pressed={visible}
                  onPointerEnter={() => onHover(visible ? domain : null)}
                  onPointerLeave={() => onHover(null)}
                  onFocus={() => onHover(visible ? domain : null)}
                  onBlur={() => onHover(null)}
                  onClick={() => {
                    // 非表示にした分類は強調しない。表示に戻した分類はそのまま強調する。
                    onHover(visible ? null : domain);
                    onToggle(domain);
                  }}
                >
                  <span style={legendSwatch(domain, visible)} aria-hidden />
                  <span>{DOMAIN_LABELS[domain]}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {/* 一部だけ非表示のときはここに置く（全分類が非表示のときは折りたたみの外に出す） */}
        {hiddenDomains.length > 0 && !allHidden && showAllButton}
        {/* 時間種別の見分け方（形で区別する。色は分類にだけ使う）。広がる出来事（diffusion）は、起点の二重輪 */}
        <p
          className="flex flex-wrap items-center"
          style={{ columnGap: SPACE[12], rowGap: SPACE[4], marginTop: SPACE[8], ...textStyle.caption }}
        >
          {KIND_SWATCHES.map(({ kind, label }) => (
            <span key={kind} className="flex items-center whitespace-nowrap" style={{ gap: SPACE[4] }}>
              <span style={kindSwatchStyle(kind)} aria-hidden>
                {kind === "diffusion" && <span style={kindSwatchDotStyle} />}
              </span>
              <span>{label}</span>
            </span>
          ))}
        </p>
      </div>
    </nav>
  );
}
