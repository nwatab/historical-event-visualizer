"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { publicPath } from "./config";
import {
  MANIFEST_PATH,
  eventFilePath,
  filesForYear,
  mergeEventFiles,
  type EventManifest,
} from "./eventData";
import { EVENT_WINDOW_YEARS } from "./timeline";
import type { HistEvent, Year } from "@/types/event";

interface LoadedEvents {
  /** 現在年の表示に使うイベント。必要なファイルが読めるまでは、直前の年のものを返し続ける。 */
  readonly events: readonly HistEvent[];
  /** これまでに読んだすべてのイベント（詳細パネルが、窓の外に出た選択中のイベントを引けるように）。 */
  readonly eventsById: ReadonlyMap<string, HistEvent>;
  readonly manifest: EventManifest | null;
  readonly loading: boolean;
}

const fetchJson = async <T,>(path: `/${string}`): Promise<T> => {
  const res = await fetch(publicPath(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
};

/**
 * 現在年の前後の区間のファイルだけを読み、読んだものはキャッシュする（ページを開いている間だけ。localStorage は使わない）。
 * 読み込み中は既存のイベントをそのまま返し、必要なファイルが揃ってから差し替える（マーカーが一瞬消えるのを避ける）。
 */
export const useEvents = (year: Year): LoadedEvents => {
  const [manifest, setManifest] = useState<EventManifest | null>(null);
  // file 名 → イベント。読み込みの開始は requested で管理し、同じファイルを二度取りに行かない
  const [cache, setCache] = useState<ReadonlyMap<string, readonly HistEvent[]>>(new Map());
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    fetchJson<EventManifest>(MANIFEST_PATH)
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch((e: unknown) => console.error("イベントの一覧を読めませんでした", e));
    return () => {
      cancelled = true;
    };
  }, []);

  const [shown, setShown] = useState<readonly HistEvent[]>([]);

  const needed = useMemo(
    () => (manifest === null ? [] : filesForYear(manifest.files, year, EVENT_WINDOW_YEARS)),
    [manifest, year],
  );

  useEffect(() => {
    needed
      .filter((f) => !requested.current.has(f.file))
      .forEach((f) => {
        requested.current.add(f.file);
        fetchJson<readonly HistEvent[]>(eventFilePath(f.file))
          .then((events) => setCache((prev) => new Map([...prev, [f.file, events]])))
          .catch((e: unknown) => {
            requested.current.delete(f.file); // 次に必要になったときに取り直す
            console.error(`${f.file} を読めませんでした`, e);
          });
      });
  }, [needed]);

  // 年を動かしても、必要なファイルの組が変わらなければ作り直さない
  const neededKey = needed.map((f) => f.file).join("|");
  const current = useMemo(() => {
    const files = neededKey === "" ? [] : neededKey.split("|");
    const chunks = files.map((file) => cache.get(file));
    return manifest !== null && chunks.every((c) => c !== undefined)
      ? mergeEventFiles(chunks.filter((c) => c !== undefined))
      : null;
  }, [manifest, neededKey, cache]);

  // 必要なファイルが揃ったときだけ差し替える。揃うまでは直前のものを出し続ける（レンダー中の状態の調整）
  if (current !== null && current !== shown) setShown(current);

  const eventsById = useMemo(
    () => new Map(mergeEventFiles([...cache.values()]).map((event) => [event.id, event] as const)),
    [cache],
  );

  return { events: shown, eventsById, manifest, loading: current === null };
};
