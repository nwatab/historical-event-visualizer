import type { Domain, Year } from "@/types/event";
import { clampYear } from "./year";

/**
 * 画面の状態。R7 で URL クエリに載せる予定のため、共有したい状態はすべてここに集める。
 * ホバー中の分類のような一時的な状態は含めない。
 */
export interface AppState {
  readonly year: Year;
  /** 非表示にしている分類 */
  readonly hiddenDomains: readonly Domain[];
  /** 詳細パネルの状態。null なら閉じている。 */
  readonly selection: Selection | null;
}

/**
 * クリックした地点のイベント（重なっていれば複数）と、詳細を表示中のイベント。
 * activeId が null なら一覧を表示する。
 */
export interface Selection {
  readonly eventIds: readonly string[];
  readonly activeId: string | null;
}

export type AppAction =
  | { readonly type: "setYear"; readonly year: Year }
  | { readonly type: "stepYear"; readonly delta: number }
  | { readonly type: "toggleDomain"; readonly domain: Domain }
  | { readonly type: "showAllDomains" }
  | { readonly type: "selectEvents"; readonly eventIds: readonly string[] }
  | { readonly type: "openEvent"; readonly eventId: string }
  | { readonly type: "backToList" }
  | { readonly type: "closeSelection" };

export interface YearBounds {
  readonly min: Year;
  readonly max: Year;
}

export const initialAppState = (year: Year): AppState => ({
  year,
  hiddenDomains: [],
  selection: null,
});

/** 1件だけなら詳細を、複数なら一覧を開く。0件なら閉じる。 */
const selectionFor = (eventIds: readonly string[]): Selection | null => {
  const unique = [...new Set(eventIds)];
  if (unique.length === 0) return null;
  return { eventIds: unique, activeId: unique.length === 1 ? unique[0] : null };
};

export const appReducer =
  (bounds: YearBounds) =>
  (state: AppState, action: AppAction): AppState => {
    switch (action.type) {
      case "setYear":
        return { ...state, year: clampYear(action.year, bounds.min, bounds.max) };
      case "stepYear":
        return { ...state, year: clampYear(state.year + action.delta, bounds.min, bounds.max) };
      case "toggleDomain":
        return {
          ...state,
          hiddenDomains: state.hiddenDomains.includes(action.domain)
            ? state.hiddenDomains.filter((d) => d !== action.domain)
            : [...state.hiddenDomains, action.domain],
        };
      case "showAllDomains":
        return { ...state, hiddenDomains: [] };
      case "selectEvents":
        return { ...state, selection: selectionFor(action.eventIds) };
      case "openEvent":
        return state.selection === null
          ? state
          : { ...state, selection: { ...state.selection, activeId: action.eventId } };
      case "backToList":
        return state.selection === null
          ? state
          : { ...state, selection: { ...state.selection, activeId: null } };
      case "closeSelection":
        return { ...state, selection: null };
    }
  };
