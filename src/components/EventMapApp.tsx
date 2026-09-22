"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { bordersAvailable } from "@/lib/borderData";
import { appReducer, initialAppState, type AppAction, type AppState } from "@/lib/appState";
import { SCREEN_INSET, SLIDER_PANEL_MAX_WIDTH, SPACE } from "@/lib/design";
import { diffusionLines } from "@/lib/diffusion";
import {
  EVENT_WINDOW_YEARS,
  INITIAL_YEAR,
  PLAYBACK_PREFETCH_SECONDS,
  MIN_ZOOM_BY_IMPORTANCE,
  TIMELINE_HALF_SPAN_INITIAL,
  TIMELINE_HALF_SPAN_LEVELS,
  YEAR_MAX,
  YEAR_MIN,
  densityLevelAt,
  eventMarkers,
  promotedThresholds,
  timelineLoadMargin,
} from "@/lib/timeline";
import { useBorders } from "@/lib/useBorders";
import { useEvents } from "@/lib/useEvents";
import { usePlayback } from "@/lib/usePlayback";
import type { Domain } from "@/types/event";
import { DetailPanel } from "./DetailPanel";
import { Legend } from "./Legend";
import { Timeline } from "./Timeline";
import { WorldMapClient } from "./WorldMapClient";
import { YearSlider } from "./YearSlider";

const reducer = appReducer({
  min: YEAR_MIN,
  max: YEAR_MAX,
  halfSpanLevels: TIMELINE_HALF_SPAN_LEVELS,
});

const isTextInput = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * スペースキーを、フォーカス中の要素に任せるべきか。ボタンは Space で押されるので任せる（凡例の切り替えなど）。
 * 年スライダー（input[type=range]）は Space を使わないので、フォーカスがあっても再生／停止に使う。
 */
const ownsSpaceKey = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "BUTTON" ||
    target.tagName === "A" ||
    (isTextInput(target) && !(target instanceof HTMLInputElement && target.type === "range")));

/** キー入力の意味。年の移動と詳細パネルは状態遷移（AppAction）、再生／停止は再生のフックに渡す。 */
type KeyCommand = { readonly action: AppAction } | { readonly togglePlayback: true };

/**
 * キー入力を状態遷移に変換する。
 * - Esc: 詳細パネルが開いていれば閉じる（年は動かさない）
 * - ← / →: 年を1年（Shift 併用で10年）動かす。入力要素にフォーカスがあるときはそちらに任せる
 * - Space: 再生／停止
 */
const commandFromKey = (event: KeyboardEvent, state: AppState): KeyCommand | null => {
  if (event.key === "Escape") return state.selection === null ? null : { action: { type: "closeSelection" } };
  if (event.key === " ") return ownsSpaceKey(event.target) ? null : { togglePlayback: true };
  if (isTextInput(event.target)) return null;
  const unit = event.shiftKey ? 10 : 1;
  if (event.key === "ArrowLeft") return { action: { type: "stepYear", delta: -unit } };
  if (event.key === "ArrowRight") return { action: { type: "stepYear", delta: unit } };
  return null;
};

export function EventMapApp() {
  const [state, dispatch] = useReducer(
    reducer,
    { year: INITIAL_YEAR, timelineHalfSpan: TIMELINE_HALF_SPAN_INITIAL },
    initialAppState,
  );
  const [hoveredDomain, setHoveredDomain] = useState<Domain | null>(null);
  // 再生。年を進めるのは年スライダーと同じ setYear
  const onPlaybackYear = useCallback((year: number) => dispatch({ type: "setYear", year }), []);
  const playback = usePlayback(state.year, YEAR_MAX, onPlaybackYear);
  // イベントは public/data/events/ から、現在年の前後（地図の窓と、年表の窓＋その端に掛かる区画の広いほう）の区間だけを読む。読み込み中は直前のものが返る。
  // 再生中は、窓の先の区間も先読みする
  const { events, eventsById, manifest } = useEvents(
    state.year,
    Math.max(EVENT_WINDOW_YEARS, timelineLoadMargin(state.timelineHalfSpan)),
    playback.playing ? playback.speed * PLAYBACK_PREFETCH_SECONDS : 0,
  );
  // 国境（1500 年以降）。現在年の世紀のファイルだけを読み、再生中は先の世紀も先読みする。非表示のときは読まない
  const borders = useBorders(state.year, state.bordersVisible, playback.playing ? playback.speed * PLAYBACK_PREFETCH_SECONDS : 0);
  const markers = useMemo(() => eventMarkers(events, state.year), [events, state.year]);
  const lines = useMemo(() => diffusionLines(events, state.year), [events, state.year]);
  // 密度による調整: 前後 ±10 年に地図に出るイベントが少ない年は、importance 2（さらに 1）を 3 と同じ扱いにする。GeoJSON は作り直さず、filter 式の閾値だけを変える。
  // 段階は、生成時に全データから計算した表（manifest の density）を引くだけなので、年と表だけで決まる（timeline.ts の densityRuns）
  const density = useMemo(() => densityLevelAt(manifest?.density.runs ?? [], state.year), [manifest, state.year]);
  // 年表と詳細パネルが「どのズームでも地図に出ない項目」を判定するのにも、同じ閾値を使う
  const mapThresholds = useMemo(() => promotedThresholds(MIN_ZOOM_BY_IMPORTANCE, density), [density]);

  // キーハンドラは一度だけ登録し、最新の状態は ref から読む
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { toggle: togglePlayback, stop: stopPlayback } = playback;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = commandFromKey(event, stateRef.current);
      if (command === null) return;
      event.preventDefault();
      if ("togglePlayback" in command) {
        togglePlayback();
        return;
      }
      // 人が年を動かしたら、再生を止める
      if (command.action.type === "stepYear") stopPlayback();
      dispatch(command.action);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlayback, stopPlayback]);

  const onSelectEvents = useCallback((eventIds: readonly string[]) => dispatch({ type: "selectEvents", eventIds }), []);
  // 地図の何もない所をクリックしたら詳細パネルを閉じる。凡例やスライダーは地図の上に重なった別の要素なので、
  // そこでのクリックは地図に届かず、パネルは閉じない
  const onClickEmpty = useCallback(() => dispatch({ type: "closeSelection" }), []);
  // 年スライダーの操作と年表のドラッグ。人が年を動かしたら、再生を止める
  const onSetYear = useCallback(
    (year: number) => {
      stopPlayback();
      dispatch({ type: "setYear", year });
    },
    [stopPlayback],
  );
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
        lines={lines}
        borders={borders}
        year={state.year}
        highlightedDomain={hoveredDomain}
        hiddenDomains={state.hiddenDomains}
        densityLevel={density}
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
          className="flex min-h-0 flex-1 flex-col items-start wide:flex-row wide:justify-between"
          style={{ gap: SCREEN_INSET }}
        >
          <div className="pointer-events-auto shrink-0">
            <Legend
              hiddenDomains={state.hiddenDomains}
              highlighted={hoveredDomain}
              onHover={setHoveredDomain}
              onToggle={(domain) => dispatch({ type: "toggleDomain", domain })}
              onShowAll={() => dispatch({ type: "showAllDomains" })}
              bordersVisible={state.bordersVisible}
              bordersAvailable={bordersAvailable(state.year)}
              onToggleBorders={() => dispatch({ type: "toggleBorders" })}
            />
          </div>
          {state.selection !== null && (
            <div className="pointer-events-auto flex min-h-0 w-full max-h-[var(--hv-sheet-max-height)] wide:max-h-full wide:w-[var(--hv-panel-width)]">
              <DetailPanel
                selection={state.selection}
                eventsById={eventsById}
                mapThresholds={mapThresholds}
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
            mapThresholds={mapThresholds}
            highlightedDomain={hoveredDomain}
            selectedIds={selectedIds}
            playing={playback.playing}
            speed={playback.speed}
            onTogglePlayback={playback.toggle}
            onCycleSpeed={playback.cycleSpeed}
            onSetYear={onSetYear}
            onSetHalfSpan={onSetHalfSpan}
            onSelectEvents={onSelectEvents}
            onClickEmpty={onClickEmpty}
          />
          <YearSlider year={state.year} min={YEAR_MIN} max={YEAR_MAX} onChange={onSetYear} />
        </div>
      </div>
    </div>
  );
}
