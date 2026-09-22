import type { DensityRuns } from "@/lib/timeline";
import type { HistEvent, Year } from "@/types/event";

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

export interface EventManifest {
  readonly generatedAt: string;
  readonly total: number;
  readonly files: readonly EventFile[];
  /**
   * 密度による繰り上げの段階の表（timeline.ts の densityRuns）。生成時に全データから計算してある。
   * windowYears と floor は、計算に使った値（DENSITY_WINDOW_YEARS と DENSITY_FLOOR。確認用）。
   */
  readonly density: { readonly windowYears: number; readonly floor: number; readonly runs: DensityRuns };
}

export const MANIFEST_PATH = "/data/events/manifest.json" as const;
export const eventFilePath = (file: string): `/${string}` => `/data/events/${file}`;

/**
 * 現在年の表示に要るファイル。窓 [year − margin, year + margin] と重なる区間すべて
 * （margin は、地図の窓と年表の窓の広いほう）。
 * period は重なる区間すべてのファイルに入っているので、進行中の period を出すために過去の区間を読む必要は無い。
 */
export const filesForYear = (
  files: readonly EventFile[],
  year: Year,
  margin: number,
): readonly EventFile[] => files.filter((f) => f.from <= year + margin && f.to > year - margin);

/**
 * 再生中に先読みするファイル。窓の先 [year, year + margin + ahead] と重なる区間（表示に要るファイルと重なってよい）。
 */
export const filesAhead = (
  files: readonly EventFile[],
  year: Year,
  margin: number,
  ahead: number,
): readonly EventFile[] => files.filter((f) => f.from <= year + margin + ahead && f.to > year);

/**
 * 複数のファイルのイベントを1つにまとめ、id の重複を除く。
 * period は重なる区間すべてのファイルに同じ内容で入っているので、どれを残しても同じ。
 */
export const mergeEventFiles = (chunks: readonly (readonly HistEvent[])[]): readonly HistEvent[] => [
  ...new Map(chunks.flatMap((events) => events.map((event) => [event.id, event] as const))).values(),
];
