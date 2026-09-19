"use client";

import { useState } from "react";
import { FONT_WEIGHT, GRAY, SPACE, surfaceStyle, swatchStyle, textStyle } from "@/lib/design";
import { DOMAINS, DOMAIN_LABELS } from "@/lib/domain";
import type { Domain } from "@/types/event";

interface LegendProps {
  /** 現在強調中の分類（ホバー中または固定中） */
  readonly highlighted: Domain | null;
  /** 固定中の分類（クリック・タップで切り替え） */
  readonly pinned: Domain | null;
  readonly onHover: (domain: Domain | null) => void;
  readonly onTogglePin: (domain: Domain) => void;
}

/**
 * 分類の凡例。項目にホバー（またはフォーカス）するとその分類のマーカーだけを強調する。
 * タッチ端末ではホバーできないため、クリック・タップで強調を固定／解除できる。
 * 狭い画面では折りたたみ、色見本の列だけを表示する。
 */
export function Legend({ highlighted, pinned, onHover, onTogglePin }: LegendProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <nav aria-label="分類の凡例" style={surfaceStyle}>
      <button
        type="button"
        className="flex items-center sm:hidden"
        style={{ gap: SPACE[8], ...textStyle.caption }}
        aria-expanded={expanded}
        aria-controls="legend-items"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>凡例</span>
        <span className="flex" style={{ gap: SPACE[4] }} aria-hidden>
          {DOMAINS.map((domain) => (
            <span key={domain} style={swatchStyle(domain)} />
          ))}
        </span>
      </button>
      <p className="hidden sm:block" style={{ ...textStyle.caption, marginBottom: SPACE[4] }}>
        分類
      </p>
      <ul
        id="legend-items"
        className={expanded ? "flex flex-col" : "hidden sm:flex sm:flex-col"}
        style={{ marginTop: expanded ? SPACE[8] : 0 }}
      >
        {DOMAINS.map((domain) => {
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
                  color: dimmed ? GRAY.weak : GRAY.text,
                  fontWeight: pinned === domain ? FONT_WEIGHT.bold : FONT_WEIGHT.regular,
                }}
                aria-pressed={pinned === domain}
                onPointerEnter={() => onHover(domain)}
                onPointerLeave={() => onHover(null)}
                onFocus={() => onHover(domain)}
                onBlur={() => onHover(null)}
                onClick={() => onTogglePin(domain)}
              >
                <span style={swatchStyle(domain)} aria-hidden />
                <span>{DOMAIN_LABELS[domain]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
