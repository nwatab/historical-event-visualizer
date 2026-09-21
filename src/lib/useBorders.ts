"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BORDER_MANIFEST_PATH,
  EMPTY_BORDERS,
  borderFileForYear,
  borderFilePath,
  borderFilesAhead,
  bordersAvailable,
  type BorderCollection,
  type BorderManifest,
} from "./borderData";
import { publicPath } from "./config";
import type { Year } from "@/types/event";

const fetchJson = async <T,>(path: `/${string}`): Promise<T> => {
  const res = await fetch(publicPath(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
};

/**
 * 現在年の世紀の国境のファイルを読む（useEvents と同じ方式。読んだものはページを開いている間だけメモリに持つ）。
 * - 1500 年より前と、国境を非表示にしているとき（enabled が false）は、一覧も含めて何も読まない
 * - 読み込み中は直前の世紀のものを返し続ける（地図の filter が年で絞るので、古い世紀の線が残って見えることは無い。線が一瞬消えるだけ）
 * - prefetchAhead（年）が正なら、その年数ぶん先の世紀のファイルも先に取りに行く（再生中）
 * 返す FeatureCollection は世紀ごとに同じ参照なので、地図の setData は世紀が替わるときだけ走る。年ごとの切り替えは filter だけ。
 */
export const useBorders = (year: Year, enabled: boolean, prefetchAhead: number = 0): BorderCollection => {
  const [manifest, setManifest] = useState<BorderManifest | null>(null);
  const [cache, setCache] = useState<ReadonlyMap<string, BorderCollection>>(new Map());
  const requested = useRef(new Set<string>());
  const manifestRequested = useRef(false);

  const wanted = enabled && bordersAvailable(year + Math.max(0, prefetchAhead));

  useEffect(() => {
    if (!wanted || manifestRequested.current) return;
    manifestRequested.current = true;
    fetchJson<BorderManifest>(BORDER_MANIFEST_PATH)
      .then(setManifest)
      .catch((e: unknown) => {
        manifestRequested.current = false;
        console.error("国境の一覧を読めませんでした", e);
      });
  }, [wanted]);

  const current = useMemo(
    () => (manifest === null || !enabled ? null : borderFileForYear(manifest.files, year)),
    [manifest, enabled, year],
  );
  const ahead = useMemo(
    () => (manifest === null || !enabled || prefetchAhead <= 0 ? [] : borderFilesAhead(manifest.files, year, prefetchAhead)),
    [manifest, enabled, year, prefetchAhead],
  );

  useEffect(() => {
    [...(current === null ? [] : [current]), ...ahead]
      .filter((f) => !requested.current.has(f.file))
      .forEach((f) => {
        requested.current.add(f.file);
        fetchJson<BorderCollection>(borderFilePath(f.file))
          .then((borders) => setCache((prev) => new Map([...prev, [f.file, borders]])))
          .catch((e: unknown) => {
            requested.current.delete(f.file); // 次に必要になったときに取り直す
            console.error(`${f.file} を読めませんでした`, e);
          });
      });
  }, [current, ahead]);

  const [shown, setShown] = useState<BorderCollection>(EMPTY_BORDERS);
  const loaded = current === null ? (enabled && bordersAvailable(year) ? undefined : EMPTY_BORDERS) : cache.get(current.file);
  // 読めたときだけ差し替える（レンダー中の状態の調整。useEvents と同じ）。1500 年より前と非表示のときは空にする
  if (loaded !== undefined && loaded !== shown) setShown(loaded);
  return shown;
};
