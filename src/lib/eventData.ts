import type { Domain, HistEvent, TemporalKind, Year } from "@/types/event";

/**
 * public/data/events/ のデータの読み方（純粋関数）。
 * データは scripts/wikidata/build-app-data.mjs が生成する。区間ごとのファイルと、その一覧（manifest.json）から成る。
 */

/** 1ファイルぶんの区間。天文年の半開区間 [from, to)。 */
export interface EventFile {
  readonly file: string;
  readonly from: Year;
  readonly to: Year;
  readonly count: number;
  readonly bytes: number;
}

/** 年スライダーの目盛り用の、イベントの要約（importance 3 のみ）。 */
export interface EventTickSource {
  readonly kind: TemporalKind;
  readonly start: Year;
  readonly end?: Year;
  readonly domain: Domain;
}

export interface EventManifest {
  readonly generatedAt: string;
  readonly total: number;
  readonly files: readonly EventFile[];
  readonly ticks: readonly EventTickSource[];
}

export const MANIFEST_PATH = "/data/events/manifest.json" as const;
export const eventFilePath = (file: string): `/${string}` => `/data/events/${file}`;

/**
 * 現在年の表示に要るファイル。窓 [year − margin, year + margin] と重なる区間すべて。
 * period は重なる区間すべてのファイルに入っているので、進行中の period を出すために過去の区間を読む必要は無い。
 */
export const filesForYear = (
  files: readonly EventFile[],
  year: Year,
  margin: number,
): readonly EventFile[] => files.filter((f) => f.from <= year + margin && f.to > year - margin);

/**
 * 複数のファイルのイベントを1つにまとめ、id の重複を除く。
 * period は重なる区間すべてのファイルに同じ内容で入っているので、どれを残しても同じ。
 */
export const mergeEventFiles = (chunks: readonly (readonly HistEvent[])[]): readonly HistEvent[] => [
  ...new Map(chunks.flatMap((events) => events.map((event) => [event.id, event] as const))).values(),
];

/** 地図に出さない項目（場所の概念が無い、または地点をまだ決められていない）。 */
export const isPlaceless = (event: HistEvent): boolean => event.placeKind === "none";
