"use client";

import { FONT_WEIGHT, GRAY, SPACE, surfaceStyle, swatchStyle, textStyle } from "@/lib/design";
import { DOMAIN_LABELS } from "@/lib/domain";
import { neverOnMap } from "@/lib/mapFilters";
import type { Selection } from "@/lib/appState";
import { formatYear, formatYearRange } from "@/lib/year";
import type { HistEvent } from "@/types/event";

interface DetailPanelProps {
  readonly selection: Selection;
  readonly eventsById: ReadonlyMap<string, HistEvent>;
  readonly onOpen: (eventId: string) => void;
  readonly onBack: () => void;
  readonly onClose: () => void;
}

interface SourceInfo {
  readonly label: string;
  /** 記事本文のライセンス（Wikipedia のみ。2026-09-19 時点のフッター表記で確認） */
  readonly license: { readonly name: string; readonly url: string } | null;
}

const WIKIPEDIA_LANG_LABELS: Readonly<Record<string, string>> = { ja: "日本語版", en: "英語版" };

/**
 * 出典 URL から表示名とライセンス表記を作る。
 * 表示名は「Wikipedia（日本語版）」「Wikipedia（英語版）」「Wikidata」。CC BY-SA の表記は Wikipedia の場合だけ
 * （Wikidata のデータは CC0 で、表記の義務が無い）。
 */
const sourceInfo = (url: string): SourceInfo => {
  const parsed = new URL(url);
  const wikipedia = parsed.hostname.match(/^([a-z-]+)\.wikipedia\.org$/);
  if (wikipedia) {
    const lang = wikipedia[1];
    return {
      label: `Wikipedia（${WIKIPEDIA_LANG_LABELS[lang] ?? lang}）`,
      license: {
        name: "CC BY-SA 4.0",
        url: `https://creativecommons.org/licenses/by-sa/4.0/deed.${lang === "ja" ? "ja" : "en"}`,
      },
    };
  }
  if (parsed.hostname === "www.wikidata.org") return { label: "Wikidata", license: null };
  return { label: parsed.hostname, license: null };
};

/** instant は年、period / diffusion は期間を表示する。 */
const eventYears = (event: HistEvent): string =>
  event.kind !== "instant" && event.end !== undefined
    ? formatYearRange(event.start, event.end)
    : formatYear(event.start);

const linkStyle = { color: GRAY.text, textDecoration: "underline" } as const;

const DomainLabel = ({ event }: { readonly event: HistEvent }) => (
  <p className="flex items-center" style={{ gap: SPACE[4], ...textStyle.caption }}>
    <span style={swatchStyle(event.domain)} aria-hidden />
    <span>{DOMAIN_LABELS[event.domain]}</span>
  </p>
);

const EventDetail = ({ event }: { readonly event: HistEvent }) => {
  const source = event.source ? sourceInfo(event.source) : null;
  return (
    <article className="flex flex-col" style={{ gap: SPACE[8] }}>
      <DomainLabel event={event} />
      <h2 style={textStyle.emphasis}>{event.title.ja}</h2>
      <p style={{ ...textStyle.body, fontVariantNumeric: "tabular-nums" }}>{eventYears(event)}</p>
      {/* 年表から選べるが、地図には出ない項目（場所が無い、または国の代表点だけで拡大前に消える） */}
      {neverOnMap(event) && <p style={textStyle.caption}>地図上の位置は不明</p>}
      {event.description && <p style={textStyle.body}>{event.description.ja}</p>}
      {source && event.source && (
        <p style={textStyle.caption}>
          出典:{" "}
          <a href={event.source} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            {source.label}
          </a>
          {source.license && (
            <>
              {"（"}
              <a href={source.license.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                {source.license.name}
              </a>
              {"）"}
            </>
          )}
        </p>
      )}
    </article>
  );
};

const EventList = ({
  events,
  onOpen,
}: {
  readonly events: readonly HistEvent[];
  readonly onOpen: (eventId: string) => void;
}) => (
  <div className="flex flex-col" style={{ gap: SPACE[8] }}>
    {/* 地図の重なったマーカーからも、年表の重なった項目（ヒストグラムならその年の項目）からも開く */}
    <p style={textStyle.caption}>該当するイベント（{events.length}件）</p>
    <ul className="flex flex-col" style={{ gap: SPACE[4] }}>
      {events.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            className="flex w-full flex-col text-left"
            style={{ gap: SPACE[4], paddingBlock: SPACE[4] }}
            onClick={() => onOpen(event.id)}
          >
            <DomainLabel event={event} />
            <span style={{ ...textStyle.body, fontWeight: FONT_WEIGHT.bold }}>{event.title.ja}</span>
            <span style={{ ...textStyle.caption, fontVariantNumeric: "tabular-nums" }}>
              {eventYears(event)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  </div>
);

/**
 * マーカーをクリックしたときの詳細パネル。重なったマーカーなら一覧から選ぶ。
 * 配置（右側の固定幅パネル／上部のシート）は親が決める。
 */
export function DetailPanel({ selection, eventsById, onOpen, onBack, onClose }: DetailPanelProps) {
  const events = selection.eventIds.flatMap((id) => {
    const event = eventsById.get(id);
    return event ? [event] : [];
  });
  const active = selection.activeId === null ? null : (eventsById.get(selection.activeId) ?? null);
  const canGoBack = active !== null && events.length > 1;

  return (
    <aside
      aria-label="イベントの詳細"
      className="flex max-h-full w-full flex-col overflow-y-auto"
      style={surfaceStyle}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: SPACE[8] }}>
        {canGoBack ? (
          <button type="button" style={{ ...textStyle.caption, ...linkStyle }} onClick={onBack}>
            一覧に戻る
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          style={{ ...textStyle.caption, ...linkStyle }}
          aria-label="詳細を閉じる（Esc）"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
      {active ? <EventDetail event={active} /> : <EventList events={events} onOpen={onOpen} />}
    </aside>
  );
}
