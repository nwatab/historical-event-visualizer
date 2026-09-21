import type { FeatureCollection, Point } from "geojson";
import type { Domain, HistEvent, PlaceGranularity, PlaceKind, TemporalKind, Year } from "@/types/event";

/** 年スライダーの範囲（天文年）。 */
export const YEAR_MIN: Year = -3000;
export const YEAR_MAX: Year = 2025;
export const INITIAL_YEAR: Year = 1687;

/** instant イベントを表示する窓幅。|start - 現在年| がこの値以下なら表示する。 */
export const EVENT_WINDOW_YEARS = 20;

/**
 * 窓の端（差 = EVENT_WINDOW_YEARS）でのマーカーの大きさの倍率。差 0 で 1。
 * 年の差は不透明度ではなく大きさで表す（不透明度を下げると色の識別性とコントラストが失われるため）。
 */
export const EVENT_EDGE_SCALE = 0.5;

/** 地図に描く時間種別。diffusion は R6 で実装する（それまでは地図に出さない）。 */
export type MarkerKind = Extract<TemporalKind, "instant" | "period">;

export interface EventMarkerProperties {
  readonly id: string;
  readonly title: string;
  readonly domain: Domain;
  readonly importance: HistEvent["importance"];
  readonly kind: MarkerKind;
  /** "none" は地図に出さない（mapFilters.ts の filter 式で除く。生成データの none は places が空なので、そもそもマーカーにならない） */
  readonly placeKind: PlaceKind;
  /** その点の粒度。"country" は国の代表点で、COUNTRY_MAX_ZOOM 以上では出さない（mapFilters.ts） */
  readonly granularity: PlaceGranularity;
  /**
   * そのイベントの places のうち最初の1点か。イベント名のラベルはこの点にだけ出す
   * （複数の国にまたがる戦争で、同じ名前が地図じゅうに並ばないように）。
   */
  readonly primary: boolean;
  /** 年の差に応じた大きさの倍率（EVENT_EDGE_SCALE〜1）。period は常に 1。 */
  readonly fade: number;
}

export type EventMarkerCollection = FeatureCollection<Point, EventMarkerProperties>;

/** 現在年との差から大きさの倍率を求める。窓の外なら null。 */
export const eventFade = (
  start: Year,
  year: Year,
  windowYears: number = EVENT_WINDOW_YEARS,
): number | null => {
  const distance = Math.abs(start - year);
  if (distance > windowYears) return null;
  if (windowYears === 0) return 1;
  return 1 - (1 - EVENT_EDGE_SCALE) * (distance / windowYears);
};

/**
 * period は start 以上 end 以下の年に表示する（両端を含む）。窓による前後の延長はしない。
 * 大きさは常に 1 倍。期間中はその出来事が「進行中」で、現在年との差が 0 にあたるため。
 * 開始・終了からの距離で縮めると、期間の端で「起きていない」ように見えてしまう。
 */
export const periodFade = (start: Year, end: Year, year: Year): number | null =>
  start <= year && year <= end ? 1 : null;

/** 現在年での大きさの倍率。表示しないなら null。 */
const markerFade = (event: HistEvent, year: Year): number | null => {
  switch (event.kind) {
    case "instant":
      return eventFade(event.start, year);
    case "period":
      return event.end === undefined ? null : periodFade(event.start, event.end, year);
    case "diffusion":
      return null;
  }
};

/** 現在年に表示すべき instant / period イベントを、places の全点ぶんのマーカーに展開する。 */
export const eventMarkers = (
  events: readonly HistEvent[],
  year: Year,
): EventMarkerCollection => ({
  type: "FeatureCollection",
  features: events.flatMap((event) => {
    const fade = markerFade(event, year);
    if (fade === null || event.kind === "diffusion") return [];
    const kind: MarkerKind = event.kind;
    return event.places.map((place, index) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
      properties: {
        id: event.id,
        title: event.title.ja,
        domain: event.domain,
        importance: event.importance,
        kind,
        placeKind: event.placeKind ?? "point",
        granularity: place.granularity ?? "fine",
        primary: index === 0,
        fade,
      },
    }));
  }),
});

/**
 * importance ごとの表示を始めるズームレベル。ズームがこの値以上のときに表示する。
 * 値を変えれば調整できる（-Infinity は常に表示）。世界全体の初期表示は、幅の広い画面で zoom ≈ 1.3、
 * 縦長の画面で ≈ -0.6 なので、どちらでも importance 3 だけが出る。
 *
 * 世界全体の表示（zoom 1.3 でも -0.6 でも同じ）でのマーカー数は、1500年 13、1800年 38、1950年 110
 * （2026-09-21 に生成したデータを scripts/wikidata/count-markers.mjs で数えた実測値。地図に出ない項目は除く）。
 * 上限の目安にしている 500 を下回るので、閾値は 3 → 常時、2 → zoom 2 以上、1 → zoom 4 以上とした。
 * zoom 2 では全世界で 120 / 408 / 908、zoom 4 では 239 / 1546 / 2382（画面に入るのはその一部。
 * zoom 4 以上では、国の代表点のマーカーは除かれる。COUNTRY_MAX_ZOOM）。
 * データを作り直したら数え直すこと（CLAUDE.md「データパイプライン」）。
 */
export const MIN_ZOOM_BY_IMPORTANCE: Readonly<Record<HistEvent["importance"], number>> = {
  3: -Infinity,
  2: 2,
  1: 4,
};

/**
 * 粒度が country の場所（国の代表点）は、ズームがこの値以上になったら出さない。マーカーもラベルも同じ。
 * 世界全体の表示では「フランス革命はフランスで起きた」は正しいが、拡大すると、国の重心は場所として嘘になるため。
 * importance 1 のマーカーが出始めるズーム（MIN_ZOOM_BY_IMPORTANCE）と同じ値なので、
 * 場所が国しか無い importance 1 の項目は、どのズームでも地図に出ない（R5 の年表には出す）。
 */
export const COUNTRY_MAX_ZOOM = 4;

/**
 * イベント名のラベルを出し始めるズームレベル。マーカー（MIN_ZOOM_BY_IMPORTANCE）より 1 段遅らせ、
 * マーカーが先に出て、拡大するとラベルが付くようにする。重なるラベルは MapLibre が間引く（importance の高いものを優先）。
 */
export const LABEL_MIN_ZOOM_BY_IMPORTANCE: Readonly<Record<HistEvent["importance"], number>> = {
  3: -Infinity,
  2: 3,
  1: 5,
};

// ── 年表（画面下段） ──────────────────────────────────────

/** 年表の窓の片側の幅（年）。初期値と、ホイールで変えられる範囲。窓の幅はこの 2 倍。 */
export const TIMELINE_HALF_SPAN = { initial: 50, min: 10, max: 500 } as const;

/**
 * 年表に出す importance の下限。窓の幅（＝ 2 × halfSpan。年）が広いほど絞る。上から順に見て、最初に当たったものを使う。
 * 窓 200 年以上 → 3 のみ、60 年以上 200 年未満 → 2 以上、60 年未満 → 全部。
 * 地図の MIN_ZOOM_BY_IMPORTANCE と同じ考え方（広く見ているときは最重要のものだけ）。
 * 近現代は件数が多く、±100 年（窓 200 年）で importance 3 だけでも 1950 年に 470 件ある（2026-09-21 に生成データで数えた）。
 */
export const TIMELINE_IMPORTANCE_BY_WINDOW: readonly {
  readonly minWindowYears: number;
  readonly minImportance: HistEvent["importance"];
}[] = [
  { minWindowYears: 200, minImportance: 3 },
  { minWindowYears: 60, minImportance: 2 },
  { minWindowYears: 0, minImportance: 1 },
];

/** ホイールの回転量 (deltaY) あたりの、窓の幅の変化率（指数）。100 で約 1.22 倍。 */
export const TIMELINE_WHEEL_SENSITIVITY = 0.002;

// ── 再生 ──────────────────────────────────────────────────

/** 再生の速度（年/秒）。ボタンで順に切り替える。 */
export const PLAYBACK_SPEEDS = [5, 20, 100] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const PLAYBACK_INITIAL_SPEED: PlaybackSpeed = 20;

/** 次の速度（最後の次は最初に戻る）。 */
export const nextPlaybackSpeed = (speed: PlaybackSpeed): PlaybackSpeed =>
  PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(speed) + 1) % PLAYBACK_SPEEDS.length];

/**
 * 再生を始めた時点の年と経過時間から、現在年を求める。フレームごとに 1 年ずつ足すのではなく、経過時間から決める
 * （描画が重くてフレームが落ちても、速度が変わらないように）。
 */
export const playbackYear = (startYear: Year, elapsedMs: number, speed: number): Year =>
  // requestAnimationFrame の時刻はフレームの開始時刻で、再生を始めた時刻より前のことがある。負の経過時間をそのまま使うと、
  // 再生の最初のフレームで 1 年戻る（R5b で、1950 → 1949 → … と動いていた。R5c の計測で見つけた）
  startYear + Math.floor((Math.max(0, elapsedMs) / 1000) * speed);

/**
 * 再生中に先読みする範囲（秒）。窓の先、この秒数で進むぶんの年までと重なる区間のファイルを、先に取りに行く。
 * 100 年/秒なら 300 年先まで（近現代の 1 ファイルは 1〜2MB で、読み込みと解析に 1 秒前後かかるため）。
 */
export const PLAYBACK_PREFETCH_SECONDS = 3;
