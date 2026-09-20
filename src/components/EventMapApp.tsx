"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { appReducer, initialAppState, type AppAction, type AppState } from "@/lib/appState";
import { SCREEN_INSET, SLIDER_PANEL_MAX_WIDTH } from "@/lib/design";
import { INITIAL_YEAR, YEAR_MAX, YEAR_MIN, eventMarkers, placelessEvents } from "@/lib/timeline";
import { useEvents } from "@/lib/useEvents";
import { eventTicks } from "@/lib/yearAxis";
import type { Domain } from "@/types/event";
import { DetailPanel } from "./DetailPanel";
import { Legend } from "./Legend";
import { PlacelessList } from "./PlacelessList";
import { WorldMapClient } from "./WorldMapClient";
import { YearSlider } from "./YearSlider";

const reducer = appReducer({ min: YEAR_MIN, max: YEAR_MAX });

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
  const [state, dispatch] = useReducer(reducer, INITIAL_YEAR, initialAppState);
  const [hoveredDomain, setHoveredDomain] = useState<Domain | null>(null);
  // イベントは public/data/events/ から、現在年の前後の区間だけを読む。読み込み中は直前のものが返る
  const { events, eventsById, manifest } = useEvents(state.year);
  const markers = useMemo(() => eventMarkers(events, state.year), [events, state.year]);
  // 年スライダーの目盛りは、全区間を読まなくても出せるように manifest に入っている要約（importance 3）から作る
  const ticks = useMemo(() => eventTicks(manifest?.ticks ?? [], state.hiddenDomains), [manifest, state.hiddenDomains]);
  const placeless = useMemo(
    () => placelessEvents(events, state.year, state.hiddenDomains),
    [events, state.year, state.hiddenDomains],
  );

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
      />
      {/*
        地図の上に重ねる UI。上段（凡例・詳細パネル）と下段（年スライダー、R5 で年表も入る）に分け、
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
          <div className="pointer-events-auto flex max-h-full min-h-0 shrink-0 flex-col items-start" style={{ gap: SCREEN_INSET }}>
            <Legend
              hiddenDomains={state.hiddenDomains}
              highlighted={hoveredDomain}
              onHover={setHoveredDomain}
              onToggle={(domain) => dispatch({ type: "toggleDomain", domain })}
              onShowAll={() => dispatch({ type: "showAllDomains" })}
            />
            <PlacelessList
              events={placeless.shown}
              totalCount={placeless.total}
              onOpen={(eventId) => dispatch({ type: "selectEvents", eventIds: [eventId] })}
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
        <div className="pointer-events-auto mx-auto w-full" style={{ maxWidth: SLIDER_PANEL_MAX_WIDTH }}>
          <YearSlider
            year={state.year}
            min={YEAR_MIN}
            max={YEAR_MAX}
            eventTicks={ticks}
            onChange={(year) => dispatch({ type: "setYear", year })}
          />
        </div>
      </div>
    </div>
  );
}
