/**
 * 歴史イベントのスキーマ。分類・時間種別の定義と判断基準は CLAUDE.md を参照。
 */

/** 分類（7種）。主分類 `domain` と副分類 `tags` の両方で使う。 */
export type Domain =
  | "conflict" // 紛争：戦争、内乱、反乱
  | "polity" // 政体変動：革命、建国・滅亡、条約、制度改革
  | "science" // 科学：理論、発見、観測
  | "technology" // 技術：発明、実用化、インフラ
  | "economy" // 経済・交易
  | "culture" // 思想・宗教・文化
  | "population"; // 人口・環境：疫病、飢饉、移住、気候

/**
 * 時間的な広がりの種別。
 * - instant:   一時点の出来事（start のみ）
 * - period:    期間を持つ出来事（start〜end）
 * - diffusion: 時間とともに地理的に広がる出来事（start〜end と path）
 */
export type TemporalKind = "instant" | "period" | "diffusion";

/**
 * 天文年方式の整数年。紀元前1年 = 0、紀元前2年 = -1。
 * JavaScript の Date は使わない（src/lib/year.ts 参照）。
 */
export type Year = number;

export interface LocalizedText {
  readonly ja: string;
  readonly en?: string;
}

export interface Place {
  readonly lon: number;
  readonly lat: number;
  readonly label?: string;
}

export interface PathPoint {
  readonly lon: number;
  readonly lat: number;
  readonly year: Year;
}

/**
 * 場所の性質。省略時は "point"。
 * - point:  特定の地点で起きた。通常のマーカー
 * - origin: 広がりを持つ概念の起点。通常のマーカーだが、R6 で diffusion に変換する対象
 * - none:   場所の概念が無い（または、まだ地点を決められていない）。地図には出さず、一覧に出す
 */
export type PlaceKind = "point" | "origin" | "none";

export interface HistEvent {
  /** Wikidata QID があればそれを使う（例: 'Q6534'）。無ければ kebab-case の slug。 */
  readonly id: string;
  readonly title: LocalizedText;
  readonly description?: LocalizedText;
  /** 主分類 */
  readonly domain: Domain;
  /** 副分類（主分類と重複可） */
  readonly tags: readonly Domain[];
  readonly kind: TemporalKind;
  readonly start: Year;
  /** period / diffusion 用 */
  readonly end?: Year;
  /** 同時発見等で複数可。placeKind が "none" で、地点の候補も無い項目では空 */
  readonly places: readonly Place[];
  /** 省略時は "point" */
  readonly placeKind?: PlaceKind;
  /**
   * "country" は、places が国の代表点でしかないことを表す（Wikidata の P495 原産国 / P17 国 から取った座標）。
   * 国の代表点に数百件が重なるので、地図には出さない。地点を人が決めたら、この印を外して placeKind を付け直す。
   */
  readonly placeQuality?: "country";
  /** diffusion 用 */
  readonly path?: readonly PathPoint[];
  /** 3 が最重要 */
  readonly importance: 1 | 2 | 3;
  /** 出典 URL */
  readonly source?: string;
}
