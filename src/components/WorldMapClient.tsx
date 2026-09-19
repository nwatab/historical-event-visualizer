"use client";

import dynamic from "next/dynamic";

// MapLibre は window に依存するため、SSG 時に評価されないようクライアント専用で読み込む。
// ssr: false は Server Component では使えないので、この Client Component 内で dynamic() する。
export const WorldMapClient = dynamic(
  () => import("./WorldMap").then((m) => m.WorldMap),
  { ssr: false },
);
