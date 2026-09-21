"use client";

import { useEffect, useRef, useState } from "react";

/** 要素の幅 (px) を追跡する。年スライダーの目盛りや年表の位置は、要素の実際の幅から計算する。 */
export const useWidth = <T extends HTMLElement = HTMLDivElement>() => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
};
