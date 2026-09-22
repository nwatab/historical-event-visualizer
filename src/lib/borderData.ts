import type { FeatureCollection, MultiLineString } from "geojson";
import type { Year } from "@/types/event";
import { BORDER_YEAR_MIN } from "./timeline";

/**
 * public/data/borders/ のデータの読み方（純粋関数）。
 * データは scripts/ohm/build-borders.mjs が OpenHistoricalMap から生成する（CLAUDE.md「国境」）。世紀ごとのファイルと、その一覧（manifest.json）から成る。
 */

export interface BorderProperties {
  /** その線を国境に持つ国の名前（英語）。隣り合う 2 国の国境なら " / " でつないである */
  readonly name: string;
  /** 日本語名（name:ja のある国が 1 つでもあるとき。無い国は英語名のまま入っている） */
  readonly nameJa?: string;
  /** 表示の条件は start ≤ 現在年 < end。end が無ければ、いまも続いている */
  readonly start: Year;
  readonly end?: Year;
}

export type BorderCollection = FeatureCollection<MultiLineString, BorderProperties>;

export const EMPTY_BORDERS: BorderCollection = { type: "FeatureCollection", features: [] };

/** 1 ファイルぶんの区間。天文年の半開区間 [from, to)。 */
export interface BorderFile {
  readonly file: string;
  readonly from: Year;
  readonly to: Year;
  readonly count: number;
  readonly bytes: number;
}

export interface BorderManifest {
  readonly generatedAt: string;
  readonly yearMin: Year;
  readonly yearMax: Year;
  readonly files: readonly BorderFile[];
}

export const BORDER_MANIFEST_PATH = "/data/borders/manifest.json" as const;
export const borderFilePath = (file: string): `/${string}` => `/data/borders/${file}`;

/** 国境のデータがある年か。 */
export const bordersAvailable = (year: Year): boolean => year >= BORDER_YEAR_MIN;

/** 現在年の世紀のファイル。国境は前後の窓を持たない（その年に存在する線だけを描く）ので、1 つだけ。無ければ null（1500 年より前）。 */
export const borderFileForYear = (files: readonly BorderFile[], year: Year): BorderFile | null =>
  files.find((f) => f.from <= year && year < f.to) ?? null;

/** 再生中に先読みするファイル。[year, year + ahead] と重なる区間。 */
export const borderFilesAhead = (files: readonly BorderFile[], year: Year, ahead: number): readonly BorderFile[] =>
  files.filter((f) => f.from <= year + ahead && f.to > year);

/** 国境の上にカーソルを置いたときに出す国名。日本語名があればそれを使い、" / " で分けて、重複を除く。 */
export const borderNames = (properties: readonly Pick<BorderProperties, "name" | "nameJa">[]): readonly string[] => [
  ...new Set(properties.flatMap((p) => (p.nameJa ?? p.name).split(" / "))),
];
