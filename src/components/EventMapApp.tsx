"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { appReducer, initialAppState, type AppAction, type AppState } from "@/lib/appState";
import { SCREEN_INSET, SLIDER_PANEL_MAX_WIDTH, SPACE } from "@/lib/design";
import {
  EVENT_WINDOW_YEARS,
  INITIAL_YEAR,
  TIMELINE_HALF_SPAN,
  YEAR_MAX,
  YEAR_MIN,
  eventMarkers,
} from "@/lib/timeline";
import { useEvents } from "@/lib/useEvents";
import type { Domain } from "@/types/event";
import { DetailPanel } from "./DetailPanel";
import { Legend } from "./Legend";
import { Timeline } from "./Timeline";
import { WorldMapClient } from "./WorldMapClient";
import { YearSlider } from "./YearSlider";

const reducer = appReducer({ min: YEAR_MIN, max: YEAR_MAX, halfSpan: TIMELINE_HALF_SPAN });

const isTextInput = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * キー入力を状態遷移に変換する。
 * - Esc: 詳細パネルが開いていれば閉じる（年は動かさない）
 * - ← / →: 年を1年（Shift 併用で10年）動かす。入力要素にフォーカスがあるときはそちらに任せる
 */
const actionFromKey = (event: KeyboardEvent, state: AppState): AppAction | null => {
  if (event.key === "Escape") return state.selection === null ? null : { type: "closeSelection" };
  if (isTextInput(event.target)) return null;
  const unit = event.shiftKey ? 10 : 1;
  if (event.key === "ArrowLeft") return { type: "stepYear", delta: -unit };
  if (event.key === "ArrowRight") return { type: "stepYear", delta: unit };
  return null;
};

export function EventMapApp() {
  const [state, dispatch] = useReducer(
    reducer,
    { year: INITIAL_YEAR, timelineHalfSpan: TIMELINE_HALF_SPAN.initial },
    initialAppState,
  );
  const [hoveredDomain, setHoveredDomain] = useState<Domain | null>(null);
  // イベントは public/data/events/ から、現在年の前後（地図の窓と年表の窓の広いほう）の区間だけを読む。読み込み中は直前のものが返る
  const { events, eventsById } = useEvents(state.year, Math.max(EVENT_WINDOW_YEARS, state.timelineHalfSpan));
  const markers = useMemo(() => eventMarkers(events, state.year), [events, state.year]);

  // キーハンドラは一度だけ登録し、最新の状態は ref から読む
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionFromKey(event, stateRef.current);
      if (action === null) return;
      event.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onSelectEvents = useCallback(
    (eventIds: readonly string[]) => dispatch({ type: "selectEvents", eventIds }),
    [],
  );
  // 地図の何もない所をクリックしたら詳細パネルを閉じる。凡例やスライダーは地図の上に重なった別の要素なので、
  // そこでのクリックは地図に届かず、パネルは閉じない
  const onClickEmpty = useCallback(() => dispatch({ type: "closeSelection" }), []);
  const onSetYear = useCallback((year: number) => dispatch({ type: "setYear", year }), []);
  const onSetHalfSpan = useCallback((halfSpan: number) => dispatch({ type: "setTimelineHalfSpan", halfSpan }), []);

  const selectedIds = useMemo(
    () =>
      state.selection === null
        ? []
        : state.selection.activeId === null
          ? state.selection.eventIds
          : [state.selection.activeId],
    [state.selection],
  );

  return (
    <div className="relative h-full w-full">
      <WorldMapClient
        markers={markers}
        highlightedDomain={hoveredDomain}
        hiddenDomains={state.hiddenDomains}
        selectedIds={selectedIds}
        onSelectEvents={onSelectEvents}
        onClickEmpty={onClickEmpty}
      />
      {/*
        地図の上に重ねる UI。上段（凡例・詳細パネル）と下段（年表・年スライダー）に分け、
        上段は残りの高さに収めるので、詳細パネルが下段と重なることはない。
        UI の無い部分は pointer-events: none にして、地図の操作を通す。
      */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col"
        style={{ padding: SCREEN_INSET, gap: SCREEN_INSET }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col items-start sm:flex-row sm:justify-between"
          style={{ gap: SCREEN_INSET }}
        >
          <div className="pointer-events-auto shrink-0">
            <Legend
              hiddenDomains={state.hiddenDomains}
              highlighted={hoveredDomain}
              onHover={setHoveredDomain}
              onToggle={(domain) => dispatch({ type: "toggleDomain", domain })}
              onShowAll={() => dispatch({ type: "showAllDomains" })}
            />
          </div>
          {state.selection !== null && (
            <div className="pointer-events-auto flex min-h-0 w-full max-h-[var(--hv-sheet-max-height)] sm:max-h-full sm:w-[var(--hv-panel-width)]">
              <DetailPanel
                selection={state.selection}
                eventsById={eventsById}
                onOpen={(eventId) => dispatch({ type: "openEvent", eventId })}
                onBack={() => dispatch({ type: "backToList" })}
                onClose={() => dispatch({ type: "closeSelection" })}
              />
            </div>
          )}
        </div>
        <div
          className="pointer-events-auto mx-auto flex w-full flex-col"
          style={{ maxWidth: SLIDER_PANEL_MAX_WIDTH, gap: SPACE[8] }}
        >
          <Timeline
            year={state.year}
            min={YEAR_MIN}
            max={YEAR_MAX}
            halfSpan={state.timelineHalfSpan}
            events={events}
            hiddenDomains={state.hiddenDomains}
            highlightedDomain={hoveredDomain}
            selectedIds={selectedIds}
            onSetYear={onSetYear}
            onSetHalfSpan={onSetHalfSpan}
            onSelectEvents={onSelectEvents}
            onClickEmpty={onClickEmpty}
          />
          <YearSlider
            year={state.year}
            min={YEAR_MIN}
            max={YEAR_MAX}
            onChange={onSetYear}
          />
        </div>
      </div>
    </div>
  );
}
