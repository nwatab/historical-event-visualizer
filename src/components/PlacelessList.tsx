"use client";

import { SPACE, surfaceStyle, swatchStyle, textStyle } from "@/lib/design";
import type { HistEvent } from "@/types/event";

interface PlacelessListProps {
  /** 現在年の窓に入る、地図に出さないイベント（絞り込み済み） */
  readonly events: readonly HistEvent[];
  /** 絞り込む前の件数。events より多ければ、その旨を添える */
  readonly totalCount: number;
  readonly onOpen: (eventId: string) => void;
}

/**
 * 場所を特定できない出来事（placeKind が "none"）の一覧。凡例の下に置く。
 * R5 で年表に移す予定なので、見た目は最小限にしている。
 */
export function PlacelessList({ events, totalCount, onOpen }: PlacelessListProps) {
  if (events.length === 0) return null;
  return (
    <section
      aria-label="場所を特定できない出来事"
      className="hidden min-h-0 flex-col overflow-y-auto sm:flex"
      style={{ ...surfaceStyle, gap: SPACE[4], maxWidth: "var(--hv-panel-width)" }}
    >
      <p style={textStyle.caption}>
        場所を特定できない出来事（{events.length}件{totalCount > events.length ? ` / ${totalCount}件中、重要なもの` : ""}）
      </p>
      <ul className="flex flex-col" style={{ gap: SPACE[4] }}>
        {events.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              className="flex w-full items-center text-left"
              style={{ gap: SPACE[4], ...textStyle.caption }}
              onClick={() => onOpen(event.id)}
            >
              <span style={swatchStyle(event.domain)} aria-hidden />
              <span style={{ color: textStyle.body.color }}>{event.title.ja}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
