import type { FeatureCollection, Point } from "geojson";
import type { DiffusionStage, Domain, HistEvent, Place, PlaceGranularity, PlaceKind, TemporalKind, Year } from "@/types/event";

/** 年スライダーの範囲（天文年）。 */
export const YEAR_MIN: Year = -3000;
export const YEAR_MAX: Year = 2025;
export const INITIAL_YEAR: Year = 1687;

/** instant イベントを表示する窓幅。|start - 現在年| がこの値以下なら表示する。diffusion を end の後に残す年数にも使う。 */
export const EVENT_WINDOW_YEARS = 20;

/**
 * 窓の端（差 = EVENT_WINDOW_YEARS）でのマーカーの大きさの倍率。差 0 で 1。
 * 年の差は不透明度ではなく大きさで表す（不透明度を下げると色の識別性とコントラストが失われるため）。
 */
export const EVENT_EDGE_SCALE = 0.5;

/** 地図に描く時間種別（R6 から diffusion も描く）。 */
export type MarkerKind = TemporalKind;

/**
 * マーカーの役割。
 * - event:  instant / period のマーカー（places の各点）
 * - origin: diffusion の起点。二重輪で描く
 * - stage:  diffusion の到達点。大きさは MARKER.minRadius で固定
 * - front:  現在年に到達した到達点（stage.year が現在年）。その年だけ instant と同じ大きさで描く（進行中の先端）
 */
export type MarkerRole = "event" | "origin" | "stage" | "front";

export interface EventMarkerProperties {
  readonly id: string;
  readonly title: string;
  readonly domain: Domain;
  readonly importance: HistEvent["importance"];
  readonly kind: MarkerKind;
  readonly role: MarkerRole;
  /** "none" は地図に出さない（mapFilters.ts の filter 式で除く。生成データの none は places が空なので、そもそもマーカーにならない） */
  readonly placeKind: PlaceKind;
  /** その点の粒度。"country" は国の代表点で、COUNTRY_MAX_ZOOM 以上では出さない（mapFilters.ts） */
  readonly granularity: PlaceGranularity;
  /**
   * そのイベントの places のうち最初の1点か。イベント名のラベルはこの点にだけ出す
   * （複数の国にまたがる戦争で、同じ名前が地図じゅうに並ばないように）。diffusion では起点。
   */
  readonly primary: boolean;
  /** 年の差に応じた大きさの倍率（EVENT_EDGE_SCALE〜1）。period は常に 1。diffusion は期間中 1、end の後は instant と同じ規則。 */
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

/**
 * diffusion は start 以上 end 以下の年に 1 倍で表示し、end の後も EVENT_WINDOW_YEARS だけ経路全体を残して、
 * instant と同じ規則（end との差）で縮める。start の前には出さない。
 * period と同じ規則にしないのは、黒死病のように数年で終わる伝播が、スライダーで通り過ぎやすいため。
 */
export const diffusionFade = (
  start: Year,
  end: Year,
  year: Year,
  windowYears: number = EVENT_WINDOW_YEARS,
): number | null => (year < start ? null : year <= end ? 1 : eventFade(end, year, windowYears));

/** 現在年での大きさの倍率。表示しないなら null。 */
export const markerFade = (event: HistEvent, year: Year): number | null => {
  switch (event.kind) {
    case "instant":
      return eventFade(event.start, year);
    case "period":
      return event.end === undefined ? null : periodFade(event.start, event.end, year);
    case "diffusion":
      return event.end === undefined ? null : diffusionFade(event.start, event.end, year);
  }
};

// ── diffusion の到達点 ──────────────────────────────────────

export interface ReachedStage {
  /** stages の中の位置 */
  readonly index: number;
  readonly stage: DiffusionStage;
  /** どこから来たか。起点なら -1、それ以外は stages の中の位置 */
  readonly from: number;
}

/** stage の from を解決する。省略時は 1 つ前の stage（最初の stage なら起点 = -1）。 */
export const stageFrom = (stage: DiffusionStage, index: number): number => stage.from ?? index - 1;

/** 現在年までに到達した stage（stage.year ≤ 現在年）。stages の順のまま返す。 */
export const reachedStages = (event: HistEvent, year: Year): readonly ReachedStage[] =>
  (event.stages ?? []).flatMap((stage, index) =>
    stage.year <= year ? [{ index, stage, from: stageFrom(stage, index) }] : [],
  );

/**
 * 現在年に表示すべきイベントを、マーカーに展開する。
 * - instant / period: places の全点
 * - diffusion: 起点（places の最初の 1 点）と、現在年までに到達した stage
 */
export const eventMarkers = (
  events: readonly HistEvent[],
  year: Year,
): EventMarkerCollection => ({
  type: "FeatureCollection",
  features: events.flatMap((event) => {
    const fade = markerFade(event, year);
    if (fade === null) return [];
    const base = {
      id: event.id,
      title: event.title.ja,
      domain: event.domain,
      importance: event.importance,
      kind: event.kind,
      placeKind: event.placeKind ?? "point",
      fade,
    };
    const feature = (place: Place, role: MarkerRole, primary: boolean) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
      properties: { ...base, role, granularity: place.granularity ?? "fine", primary },
    });
    if (event.kind !== "diffusion") return event.places.map((place, index) => feature(place, "event", index === 0));
    return [
      ...event.places.slice(0, 1).map((place) => feature(place, "origin", true)),
      ...reachedStages(event, year).map(({ stage }) => feature(stage.place, stage.year === year ? "front" : "stage", false)),
    ];
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
 * マーカーの少ない年は、この閾値を密度で下げる（下の DENSITY_FLOOR）。
 */
export const MIN_ZOOM_BY_IMPORTANCE: Readonly<Record<HistEvent["importance"], number>> = {
  3: -Infinity,
  2: 2,
  1: 4,
};

/**
 * 密度による調整の下限。現在年に地図に出る importance 3 のマーカーがこの数に満たない年は、importance 2 も 3 と同じ扱い（常時表示）にする。
 * 3 と 2 を合わせても満たなければ、importance 1 も同じ扱いにする。
 * 理由: 古代は importance 3 の項目が無い年が多く（importance は年代の区分ごとの sitelinks の上位 5% で、区分「〜499 年」は 3500 年ぶんある）、
 * 固定の閾値だと、世界全体の表示で地図が空になる。
 */
export const DENSITY_FLOOR = 15;

/** 密度による繰り上げの段階。0: しない、1: importance 2 を 3 と同じ扱いに、2: importance 1 も。 */
export type DensityLevel = 0 | 1 | 2;

/**
 * 現在年のマーカー（eventMarkers の結果。instant は ±EVENT_WINDOW_YEARS の窓、period は期間中、diffusion は起点と到達点）から、繰り上げの段階を決める。
 * 数えるのはマーカー（places の各点）で、イベントの数ではない。地図に出ない項目（placeKind が "none"）は数えない。
 */
export const densityLevel = (markers: EventMarkerCollection, floor: number = DENSITY_FLOOR): DensityLevel => {
  const onMap = markers.features.filter((f) => f.properties.placeKind !== "none");
  const count = (importance: HistEvent["importance"]): number =>
    onMap.filter((f) => f.properties.importance === importance).length;
  if (count(3) >= floor) return 0;
  return count(3) + count(2) >= floor ? 1 : 2;
};

/**
 * 繰り上げた後の閾値。繰り上げた importance には、importance 3 の閾値をそのまま使う（マーカーの MIN_ZOOM_BY_IMPORTANCE にも、
 * ラベルの LABEL_MIN_ZOOM_BY_IMPORTANCE にも同じ関数を使うので、ラベルも同じだけ下がる）。
 * 変わるのは filter 式に渡す閾値だけで、マーカーの GeoJSON と大きさ（importance ごとの半径）は変わらない。
 */
export const promotedThresholds = (
  base: Readonly<Record<HistEvent["importance"], number>>,
  level: DensityLevel,
): Readonly<Record<HistEvent["importance"], number>> => ({
  3: base[3],
  2: level >= 1 ? base[3] : base[2],
  1: level >= 2 ? base[3] : base[1],
});

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

/**
 * 年表の窓の片側の幅（年）の段階。窓の幅はこの 2 倍。ホイールとピンチはこの段階の間を移り、途中の値は取らない（R5d）。
 * 年表のラベルの配置と、点／ヒストグラムの判定は、段階ごとに 1 回だけ計算する（timelineChart.ts の timelineLayout）。
 * 段階の中で窓を動かしても（パン）、ラベルは平行移動するだけで入れ替わらない。
 *
 * 1-2-5 の系列（公比 2〜2.5、平均 10^(1/3) ≈ 2.15）にした理由:
 * - R5a の範囲（±10〜±500 年）と初期値（±50 年）を、そのまま段階として含む。
 * - 出す importance の境目（TIMELINE_IMPORTANCE_BY_WINDOW。窓 60 年・200 年＝片側 30・100 年）が段階の間か上に来るので、
 *   1 つの段階の中で出す項目が変わらない（段階の中でラベルの集合を固定する前提）。
 * - 時間軸の目盛り（TIMELINE_AXIS_STEPS の 10 / 50 / 100 / 500 年）と桁がそろい、aria-label の「前後 N 年」も丸い数になる。
 * - 1 段で px/年 が半分前後になるので、段階を変えたときにラベルが入れ替わるのが「ズームした」結果として分かる。
 *   公比 √2（12 段階）も考えたが、段階を変えるたびにラベルが少しずつ入れ替わり、どの段階も丸い数にならない。
 */
export const TIMELINE_HALF_SPAN_LEVELS: readonly number[] = [10, 20, 50, 100, 200, 500];
export const TIMELINE_HALF_SPAN_INITIAL = 50;

/** 片側の幅を、いちばん近い段階に丸める（対数の上での距離。倍率で動かすので）。 */
export const quantizeHalfSpan = (halfSpan: number, levels: readonly number[] = TIMELINE_HALF_SPAN_LEVELS): number =>
  levels.reduce((best, level) =>
    Math.abs(Math.log(level / halfSpan)) < Math.abs(Math.log(best / halfSpan)) ? level : best,
  );

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

/**
 * 点／ヒストグラムを判定する区画の幅（年）。窓の幅の 1/4（＝片側の幅の半分）で、年の絶対座標にそろえる
 * （区画 k は [k × 幅, (k + 1) × 幅)）。窓の位置ではなく区画で決めるので、パンしても判定が変わらない。
 * 窓の 1/4 にしたのは、窓全体で 1 つに決めていた R5a-2 より局所的にしつつ、区画の容量（幅 870px で 19 点）が
 * 小さすぎて点とヒストグラムが細かく入れ替わらないようにするため。
 */
export const timelineBlockYears = (halfSpan: number): number => halfSpan / 2;

/**
 * 年表のために読むイベントの範囲（現在年の前後、年）。窓の端にかかる区画は、窓の外へ最大で区画 1 つぶんはみ出すので、
 * その区画の項目も読んでおく（読めていないと、区画の件数が少なく数えられ、パンの途中で判定が変わる）。
 */
export const timelineLoadMargin = (halfSpan: number): number => halfSpan + timelineBlockYears(halfSpan);

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
