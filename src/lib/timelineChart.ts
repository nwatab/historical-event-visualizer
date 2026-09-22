import type { Domain, HistEvent, Year } from "@/types/event";
import { DOMAINS } from "./domain";
import { neverOnMap } from "./mapFilters";
import { MIN_ZOOM_BY_IMPORTANCE, TIMELINE_IMPORTANCE_BY_WINDOW, timelineBlockYears } from "./timeline";
import { axisLabelText, type AxisTick } from "./yearAxis";

/*
 * 年表（画面下段。横軸が年、縦軸が分類のレーン）の位置計算。Timeline コンポーネントの描画から切り離した純粋関数。
 * 横軸は、現在年を中心とした窓 [center − halfSpan, center + halfSpan]。現在年は常に中央に来る。
 * halfSpan は段階（timeline.ts の TIMELINE_HALF_SPAN_LEVELS）のどれか。
 *
 * R5d の原則: 表示するラベルの集合は、ズームの段階だけで決まる。パンでは平行移動しかしない。
 * そのため、ラベルの配置（timelineLabels）と点／ヒストグラムの判定（itemModes）は、窓の位置を使わず、
 * 年の絶対座標で段階ごとに 1 回だけ計算する。窓で絞るのは描画のとき（inWindow、histogramBins、labelsInWindow）だけ。
 */

export interface TimelineWindow {
  /** 現在年（窓の中心） */
  readonly center: Year;
  /** 窓の片側の幅（年）。窓の幅は 2 × halfSpan */
  readonly halfSpan: number;
}

export const windowYears = (window: TimelineWindow): number => 2 * window.halfSpan;

/** 年 → 年表の左端からの x 座標 (px)。窓の外の年は、範囲外の値になる。 */
export const timelineX = (year: number, window: TimelineWindow, width: number): number =>
  ((year - (window.center - window.halfSpan)) / windowYears(window)) * width;

/** 横方向の移動量 (px) → 年の差。年表を右に引くと過去に動くので、符号は呼び出し側で反転する。 */
export const pxToYears = (dx: number, window: TimelineWindow, width: number): number =>
  width === 0 ? 0 : (dx / width) * windowYears(window);

/**
 * ホイールの回転量から、次の halfSpan を求める。下（手前）に回すと広がり、上に回すと狭まる。
 * 倍率で変えるので、±10 年でも ±500 年でも同じ手応えになる。
 */
export const zoomedHalfSpan = (halfSpan: number, deltaY: number, sensitivity: number): number =>
  halfSpan * Math.exp(deltaY * sensitivity);

// ── 出す件数 ──────────────────────────────────────────────

/** 窓の幅（年）から、出す importance の下限を決める。閾値は timeline.ts の TIMELINE_IMPORTANCE_BY_WINDOW。 */
export const timelineMinImportance = (
  years: number,
  thresholds: typeof TIMELINE_IMPORTANCE_BY_WINDOW = TIMELINE_IMPORTANCE_BY_WINDOW,
): HistEvent["importance"] =>
  thresholds.find((t) => years >= t.minWindowYears)?.minImportance ?? 1;

/** 表示中の分類のレーン。凡例と同じ順。非表示の分類のレーンは消し、残りで高さを詰める。 */
export const timelineLanes = (hiddenDomains: readonly Domain[]): readonly Domain[] =>
  DOMAINS.filter((domain) => !hiddenDomains.includes(domain));

export interface TimelineItem {
  readonly id: string;
  readonly title: string;
  readonly domain: Domain;
  readonly importance: HistEvent["importance"];
  /** 年表では diffusion を period と区別しない（どちらも start〜end の帯） */
  readonly kind: "instant" | "period";
  readonly start: Year;
  /** period / diffusion の終了年。instant は start と同じ */
  readonly end: Year;
  /**
   * どのズームでも地図に出ない項目か（mapFilters.ts の neverOnMap。places が空、または場所が国の代表点だけで、拡大する前に消える）。
   * 年表では、点を輪郭だけ、帯を塗り無しの破線にして区別する。
   */
  readonly offMap: boolean;
}

/**
 * イベントを、年表の項目にする。窓では絞らない（R5d）。ラベルの配置と点／ヒストグラムの判定は、窓の位置に依らずに
 * 段階ごとに 1 回だけ計算し、窓で絞るのは描画のときだけにするため（inWindow）。
 * - 出す importance は、窓の幅の段階で決まる（timelineMinImportance）。段階の中では変わらない
 * - 地図と違い、placeKind が "none" の項目（places が空）も出す。年表に場所は要らないため。地図に出ない項目には offMap を付ける
 *   （mapThresholds は、地図のマーカーの importance ごとの閾値。密度による繰り上げ後のものを渡す）
 * - diffusion は period と同じ帯にする。地図のように end の後まで残すことはしない
 */
export const timelineItems = (
  events: readonly HistEvent[],
  halfSpan: number,
  hiddenDomains: readonly Domain[],
  mapThresholds: Readonly<Record<HistEvent["importance"], number>> = MIN_ZOOM_BY_IMPORTANCE,
): readonly TimelineItem[] => {
  const minImportance = timelineMinImportance(2 * halfSpan);
  return events.flatMap((event): TimelineItem[] => {
    if (event.importance < minImportance) return [];
    if (hiddenDomains.includes(event.domain)) return [];
    const kind = event.kind === "instant" ? "instant" : "period";
    const end = kind === "period" ? (event.end ?? event.start) : event.start;
    return [
      {
        id: event.id,
        title: event.title.ja,
        domain: event.domain,
        importance: event.importance,
        kind,
        start: event.start,
        end,
        offMap: neverOnMap(event, mapThresholds),
      },
    ];
  });
};

/** 窓と重なる項目か。instant は start が窓の中、period は [start, end] が窓と重なるもの。 */
export const inWindow = (item: Pick<TimelineItem, "start" | "end">, window: TimelineWindow): boolean =>
  item.start <= window.center + window.halfSpan && item.end >= window.center - window.halfSpan;

/** その年に存在する項目か。instant は start の年、period は start〜end の各年。 */
export const existsInYear = (item: Pick<TimelineItem, "start" | "end">, year: Year): boolean =>
  item.start <= year && year <= item.end;

// ── 優先順 ────────────────────────────────────────────────

/** importance が同じ項目の順。負なら a が先。 */
export type TimelineTieBreak = (a: TimelineItem, b: TimelineItem) => number;

/**
 * 既定の同順位の決め方: 期間の長いもの → start の早いもの → id。窓の位置（現在年）は使わない。
 * 現在年への近さで決めると、パンするたびに順位が変わり、ラベルが入れ替わるため（R5d）。
 * sitelinks の数などで決めるときは、この関数の代わりに byTimelinePriority に渡す。
 */
export const byDurationStartId: TimelineTieBreak = (a, b) =>
  b.end - b.start - (a.end - a.start) || a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** importance の高いもの、同じなら tieBreak の順。ラベルを置く順と、重なった項目を一覧に出す順に使う。 */
export const byTimelinePriority =
  (tieBreak: TimelineTieBreak = byDurationStartId) =>
  (a: TimelineItem, b: TimelineItem): number =>
    b.importance - a.importance || tieBreak(a, b);

/**
 * 描く順（後に描いたものが上）。period の帯が下、instant の点が上。どちらも importance の高いものを上にする。
 * 地図に出ない項目（offMap）は、レーンの最後に描く。中抜きの点は、同じ年の塗りつぶしの点の下になると見えないが、
 * 上に描けば、塗りつぶしの点の上に白い穴として見える（紀元前 3001 年のシュメール文学とストーンヘンジの完成）。
 */
export const byTimelinePaintOrder = (a: TimelineItem, b: TimelineItem): number =>
  Number(a.offMap) - Number(b.offMap) ||
  (a.kind === "period" ? 0 : 1) - (b.kind === "period" ? 0 : 1) ||
  a.importance - b.importance ||
  (b.end - b.start) - (a.end - a.start);

// ── 項目の位置 ────────────────────────────────────────────

export interface TimelineGeometry {
  readonly width: number;
  /** instant の点の半径 (px) */
  readonly pointRadius: number;
  /** period の帯を、窓の幅が狭くても見える最小の幅 (px) */
  readonly minBandWidth: number;
}

/** 段階の px/年。窓の片側の幅は段階の値そのもの（TIMELINE_HALF_SPAN_LEVELS）なので、段階の中でいちばん小さい px/年 でもある。 */
export const pxPerYear = (halfSpan: number, width: number): number => (width === 0 ? 0 : width / (2 * halfSpan));

/**
 * 項目が占める範囲 [x0, x1] を、年の絶対座標（年 × px/年。窓に依らない）で返す。ラベルの配置はこの座標で行う。
 * 帯は、窓の外にはみ出しても切らない。
 */
export const worldExtent = (item: TimelineItem, ppy: number, geometry: TimelineGeometry): readonly [number, number] => {
  if (item.kind === "instant") {
    const x = item.start * ppy;
    return [x - geometry.pointRadius, x + geometry.pointRadius];
  }
  const x0 = item.start * ppy;
  return [x0, Math.max(item.end * ppy, x0 + geometry.minBandWidth)];
};

/** 項目が占める x の範囲 [x0, x1]（年表の左端から。窓の外にはみ出した帯は、年表の幅で切る）。描画とクリックの判定に使う。 */
export const itemExtent = (
  item: TimelineItem,
  window: TimelineWindow,
  geometry: TimelineGeometry,
): readonly [number, number] => {
  if (item.kind === "instant") {
    const x = timelineX(item.start, window, geometry.width);
    return [x - geometry.pointRadius, x + geometry.pointRadius];
  }
  const x0 = Math.max(0, timelineX(item.start, window, geometry.width));
  const x1 = Math.min(geometry.width, timelineX(item.end, window, geometry.width));
  return [x0, Math.max(x1, x0 + geometry.minBandWidth)];
};

/** x の位置（± tolerance）にある、そのレーンの項目。優先順で返す。 */
export const itemsAtX = (
  items: readonly TimelineItem[],
  domain: Domain,
  x: number,
  tolerance: number,
  window: TimelineWindow,
  geometry: TimelineGeometry,
  priority: (a: TimelineItem, b: TimelineItem) => number = byTimelinePriority(),
): readonly TimelineItem[] =>
  items
    .filter((item) => {
      if (item.domain !== domain) return false;
      const [x0, x1] = itemExtent(item, window, geometry);
      return x >= x0 - tolerance && x <= x1 + tolerance;
    })
    .sort(priority);

// ── 項目の描き方（点と帯 / ヒストグラム） ──────────────────

/**
 * 項目の描き方。項目が多すぎて点が並びきらない区画の項目は、点と帯の代わりに 1 年刻みのヒストグラムに入れる。
 * - items:     点（instant）と帯（period）
 * - histogram: その年に存在する項目の数の棒
 */
export type LaneMode = "items" | "histogram";

/** 区画の番号。区画は年の絶対座標にそろえる（timeline.ts の timelineBlockYears）。 */
export const blockOf = (year: Year, halfSpan: number): number => Math.floor(year / timelineBlockYears(halfSpan));

/** 1 つの区画に点を重ねずに並べられる数（区画の幅 (px) ÷ 点の直径）。区画の項目数がこれを超えたらヒストグラムにする。 */
export const blockCapacity = (halfSpan: number, geometry: TimelineGeometry): number =>
  Math.floor((timelineBlockYears(halfSpan) * pxPerYear(halfSpan, geometry.width)) / (2 * geometry.pointRadius));

/**
 * 項目ごとの描き方を、段階ごとに決める（R5d）。レーンごと・区画ごとに、start がその区画に入る項目の数を数え、
 * 容量を超えた区画の項目をヒストグラムにする。1 つのレーンの中で、点の区画とヒストグラムの区画が混ざってよい。
 * 窓の位置は使わないので、パンしても変わらない（R5a-2 は窓の中の件数で決めていて、パンで入れ替わった）。
 * 項目は start の区画にだけ属する（帯が区画をまたいでも、描き方は 1 つ）。
 */
export const itemModes = (
  items: readonly TimelineItem[],
  halfSpan: number,
  geometry: TimelineGeometry,
): ReadonlyMap<string, LaneMode> => {
  const capacity = blockCapacity(halfSpan, geometry);
  const key = (item: TimelineItem): string => `${item.domain}:${blockOf(item.start, halfSpan)}`;
  const counts = items.reduce(
    (acc, item) => acc.set(key(item), (acc.get(key(item)) ?? 0) + 1),
    // この関数の中だけで書き換える集計用の Map（項目ごとに写すと O(項目数²) になる）
    new Map<string, number>(),
  );
  return new Map(items.map((item) => [item.id, (counts.get(key(item)) ?? 0) > capacity ? "histogram" : "items"]));
};

/** 項目の描き方。modes に無い項目は点と帯。 */
export const modeOf = (modes: ReadonlyMap<string, LaneMode>, item: TimelineItem): LaneMode =>
  modes.get(item.id) ?? "items";

/** その年に存在する、そのレーンの項目。優先順で返す。 */
export const itemsInYear = (
  items: readonly TimelineItem[],
  domain: Domain,
  year: Year,
  priority: (a: TimelineItem, b: TimelineItem) => number = byTimelinePriority(),
): readonly TimelineItem[] =>
  items.filter((item) => item.domain === domain && existsInYear(item, year)).sort(priority);

export interface HistogramBin {
  readonly year: Year;
  readonly count: number;
}

/** レーンのヒストグラム。first の年から 1 年刻みの件数と、その最大値（棒の高さの正規化に使う）。 */
export interface LaneHistogramData {
  readonly first: Year;
  readonly counts: readonly number[];
  readonly max: number;
}

/**
 * そのレーンのヒストグラムの項目（描き方が histogram のもの）の、整数年ごとの件数。instant は start の年に、period は start〜end の各年に 1 を加える。
 * 窓では切らず、項目の全期間について数える。棒の高さは、レーンの全期間でいちばん多い年で正規化する
 * （窓の中の最大で正規化すると、パンするたびに棒の高さが変わるため）。
 * 差分配列で数える: 項目ごとに「start の年で +1、end の翌年で −1」を置き、先頭から累積する。O(項目数 ＋ 年数)。
 * 差分の配列は、この関数の中だけで書き換える（引数や外の状態は書き換えない）。
 */
export const laneHistogram = (
  items: readonly TimelineItem[],
  domain: Domain,
  modes: ReadonlyMap<string, LaneMode>,
): LaneHistogramData => {
  const lane = items.filter((item) => item.domain === domain && modeOf(modes, item) === "histogram");
  if (lane.length === 0) return { first: 0, counts: [], max: 0 };
  const first = Math.min(...lane.map((item) => item.start));
  const last = Math.max(...lane.map((item) => item.end));
  const length = last - first + 1;
  // 末尾の 1 要素は、最後の年まで続く項目の −1 の置き場（累積には使わない）
  const deltas = new Int32Array(length + 1);
  lane.forEach((item) => {
    deltas[item.start - first] += 1;
    deltas[item.end - first + 1] -= 1;
  });
  // 累積和。配列を写しながら畳むと O(年数²) になるので、この関数の中だけの変数に足していく
  let running = 0;
  const counts = Array.from(deltas.subarray(0, length), (delta) => (running += delta));
  return { first, counts, max: Math.max(0, ...counts) };
};

/** 窓の中の整数年の棒（描画用）。 */
export const histogramBins = (histogram: LaneHistogramData, window: TimelineWindow): readonly HistogramBin[] => {
  const from = Math.max(histogram.first, Math.ceil(window.center - window.halfSpan));
  const to = Math.min(histogram.first + histogram.counts.length - 1, Math.floor(window.center + window.halfSpan));
  return from > to
    ? []
    : histogram.counts.slice(from - histogram.first, to - histogram.first + 1).map((count, i) => ({ year: from + i, count }));
};

/** x 座標 → いちばん近い整数年（ヒストグラムの棒は、その年を中心に 1 年ぶんの幅を持つ）。 */
export const yearAtX = (x: number, window: TimelineWindow, width: number): Year =>
  Math.round(window.center - window.halfSpan + (width === 0 ? 0 : (x / width) * windowYears(window)));

// ── ラベル ────────────────────────────────────────────────

/**
 * 文字列の幅の見積もり (px)。全角（CJK など）は 1em、それ以外は 0.6em とする。
 * DOM で測らないのは、位置計算を純粋関数に保つため。ラベルは重なりを避けるための見積もりなので、厳密でなくてよい。
 */
export const estimateTextWidth = (text: string, fontSize: number): number =>
  [...text].reduce((sum, ch) => sum + ((ch.codePointAt(0) ?? 0) > 0x2e7f ? 1 : 0.6) * fontSize, 0);

export interface LabelStyle {
  readonly fontSize: number;
  /** 項目とラベルの間、ラベルどうしの間 (px) */
  readonly gap: number;
}

/** 選ばれたラベル。位置は年の絶対座標 (px。worldExtent と同じ)。 */
export interface TimelineLabel {
  readonly id: string;
  readonly domain: Domain;
  readonly text: string;
  /** ラベルの左端 */
  readonly x: number;
  readonly width: number;
  /** ラベルが指している位置（項目の右端、帯の左端、ヒストグラムの項目では開始年）。 */
  readonly anchor: number;
  readonly kind: TimelineItem["kind"];
  readonly start: Year;
  readonly end: Year;
  /** ヒストグラムの項目のラベル（点が無いので、開始年に縦線を引いて示す） */
  readonly histogram: boolean;
}

/** 左端が x 以上の最初の位置（xs は昇順）。 */
const lowerBound = (xs: readonly number[], x: number): number => {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * どのラベルを出すかを、段階ごとに 1 回だけ決める（R5d）。位置は年の絶対座標で、窓は使わない。
 * パンではこの結果を平行移動して描くだけなので（labelsInWindow）、表示されるラベルの集合はズームの段階だけで決まる。
 *
 * レーンごとに、優先順（priority）で見ていき、既に置いたラベルと重なるものは出さない。年表の端からはみ出すかは見ない（描画で切る）。
 * - 点と帯の項目: ラベルは項目の右隣に置く（period は帯の左端から）。
 * - ヒストグラムの項目: importance 3 だけにラベルを出す。点が無いので、ラベルは開始年の位置から置く。
 * - どちらのラベルも、点と帯の項目の点（instant）と短い帯に重なる位置には置かない。白いハローを付けない（背景が白の前提）ので、
 *   点の上に乗った文字が読めなくなるため。長い period の帯とヒストグラムは薄い塗りなので、その上には置いてよい。
 *
 * 重なりの判定は、置いたラベルを左端の順に並べた配列で二分探索する（置いたラベルどうしは重ならないので、前後の 1 つずつを見ればよい）。
 * この配列は、この関数の中だけで書き換える。
 */
export const timelineLabels = (
  items: readonly TimelineItem[],
  halfSpan: number,
  geometry: TimelineGeometry,
  label: LabelStyle,
  modes: ReadonlyMap<string, LaneMode> = itemModes(items, halfSpan, geometry),
  priority: (a: TimelineItem, b: TimelineItem) => number = byTimelinePriority(),
): readonly TimelineLabel[] => {
  const ppy = pxPerYear(halfSpan, geometry.width);
  // 避ける点の幅の上限。これより長い帯は避けない
  const maxPointWidth = 4 * geometry.pointRadius;
  return timelineLanes([]).flatMap((domain) => {
    const lane = items.filter((item) => item.domain === domain);
    // 避ける対象: 点と帯の項目の、点と、点と同じくらい短い帯（輪郭の縦線が文字を横切る）。左端の順
    const points = lane
      .filter((item) => modeOf(modes, item) === "items")
      .map((item) => ({ id: item.id, extent: worldExtent(item, ppy, geometry) }))
      .filter((p) => p.extent[1] - p.extent[0] <= maxPointWidth)
      .sort((a, b) => a.extent[0] - b.extent[0]);
    const pointStarts = points.map((p) => p.extent[0]);
    const hitsPoint = (id: string, x: number, width: number): boolean =>
      points
        .slice(lowerBound(pointStarts, x - maxPointWidth), lowerBound(pointStarts, x + width))
        .some((p) => p.id !== id && x < p.extent[1]);
    // placed は左端の順（重なりの判定用）、accepted は置いた順＝優先順
    const placed: TimelineLabel[] = [];
    const placedStarts: number[] = [];
    const accepted: TimelineLabel[] = [];
    lane
      .filter((item) => modeOf(modes, item) === "items" || item.importance === 3)
      .sort(priority)
      .forEach((item) => {
        const histogram = modeOf(modes, item) === "histogram";
        const [x0, x1] = worldExtent(item, ppy, geometry);
        const anchor = histogram ? item.start * ppy : item.kind === "instant" ? x1 : x0;
        const x = anchor + label.gap;
        const width = estimateTextWidth(item.title, label.fontSize);
        const i = lowerBound(placedStarts, x);
        const before = placed[i - 1];
        const after = placed[i];
        const hitsLabel =
          (before !== undefined && before.x + before.width + label.gap > x) ||
          (after !== undefined && after.x < x + width + label.gap);
        if (hitsLabel || hitsPoint(item.id, x, width)) return;
        const placedLabel: TimelineLabel = {
          id: item.id,
          domain,
          text: item.title,
          x,
          width,
          anchor,
          kind: item.kind,
          start: item.start,
          end: item.end,
          histogram,
        };
        placed.splice(i, 0, placedLabel);
        placedStarts.splice(i, 0, x);
        accepted.push(placedLabel);
      });
    // 返す順は優先順。左外から続く帯のラベルを貼り付けるとき（labelsInWindow）に、優先順で選ぶため
    return accepted;
  });
};

/** 幅 maxWidth (px) に収まるように、末尾を省略記号にする。1 文字も収まらなければ空文字列。 */
export const truncateText = (text: string, maxWidth: number, fontSize: number): string => {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const chars = [...text];
  const fitting = chars
    .map((_, i) => chars.slice(0, chars.length - 1 - i).join(""))
    .find((prefix) => prefix.length > 0 && estimateTextWidth(`${prefix}…`, fontSize) <= maxWidth);
  return fitting === undefined ? "" : `${fitting}…`;
};

/** 窓に描くラベル。位置は年表の左端から (px)。 */
export interface WindowLabel extends Omit<TimelineLabel, "x" | "anchor"> {
  readonly x: number;
  readonly anchor: number;
  /** 左外から続く帯のラベルを、年表の左端に貼り付けたもの（text は省略記号で切ってあることがある） */
  readonly pinned: boolean;
  /** 現在年を含む項目（強調して描く）。どのラベルを出すかには関わらない */
  readonly current: boolean;
}

/**
 * 段階ごとに決めたラベル（timelineLabels）を、窓に描く位置に移す。どのラベルを出すかは変えない（描画のみ）。
 * - 平行移動するだけ。窓の外に一部がはみ出すラベルは、描画側で年表の枠で切る（clipPath）。
 *   返すのは、項目が窓と重なるラベルと、文字が窓に掛かるラベル
 * - 左外から続く帯（start が窓の左端より前で、窓の中まで続く period）は、ラベルが窓の外にあって読めないので、
 *   レーンごとに優先順で最初の 1 つを、年表の左端に貼り付ける。左端に掛かっている他のラベルの後ろから置き、
 *   次のラベルの手前で省略記号にする。貼り付けたラベルは、点を避けない（描画だけの調整）
 */
export const labelsInWindow = (
  labels: readonly TimelineLabel[],
  window: TimelineWindow,
  width: number,
  label: LabelStyle,
): readonly WindowLabel[] => {
  const ppy = pxPerYear(window.halfSpan, width);
  const offset = (window.center - window.halfSpan) * ppy;
  const from = window.center - window.halfSpan;
  const current = (l: TimelineLabel): boolean => existsInYear(l, window.center);
  return timelineLanes([]).flatMap((domain) => {
    const lane = labels.filter((l) => l.domain === domain);
    const pinCandidate = lane.find((l) => l.kind === "period" && l.start < from && l.end >= from);
    const shifted = lane
      .filter((l) => l !== pinCandidate)
      .map((l): WindowLabel => ({ ...l, x: l.x - offset, anchor: l.anchor - offset, pinned: false, current: current(l) }))
      // 項目が窓と重なるラベルは、文字が枠の外にあっても残す（描画で切る）。文字の位置で捨てると、窓の端の項目のラベルが、
      // パンの位置によって出たり消えたりする（ラベルの集合が窓に依らない、という原則が崩れる）
      .filter((l) => inWindow(l, window) || (l.x + l.width > 0 && l.x < width))
      .sort((a, b) => a.x - b.x);
    if (pinCandidate === undefined) return shifted;
    // 左端に掛かっているラベル（左端より前から始まるもの）の後ろから置く
    const left = shifted
      .filter((l) => l.x < label.gap)
      .reduce((x, l) => Math.max(x, l.x + l.width + label.gap), label.gap);
    const next = shifted.find((l) => l.x >= left);
    const text = truncateText(pinCandidate.text, (next?.x ?? Infinity) - label.gap - left, label.fontSize);
    if (text === "") return shifted;
    const pinned: WindowLabel = {
      ...pinCandidate,
      text,
      x: left,
      width: estimateTextWidth(text, label.fontSize),
      anchor: 0,
      pinned: true,
      current: current(pinCandidate),
    };
    return [...shifted, pinned];
  });
};

// ── 時間軸 ────────────────────────────────────────────────

/** 目盛りの間隔の候補（年）。 */
export const TIMELINE_AXIS_STEPS: readonly number[] = [10, 50, 100, 500];

/**
 * 隣り合うラベルの間隔が minSpacing (px) 以上になる、最小の間隔。どれも詰まるなら最大のもの。
 * ただし、その間隔だと窓の中に目盛りが1本も入らないとき（狭い画面で窓が 500 年に満たないとき）は、
 * 目盛りが入るところまで間隔を細かくする（ラベルが多少詰まっても、年が1つも読めないよりよい）。
 */
export const timelineAxisStep = (
  window: TimelineWindow,
  width: number,
  minSpacing: number,
  steps: readonly number[] = TIMELINE_AXIS_STEPS,
): number => {
  const pxPerYear = width / windowYears(window);
  const preferred = steps.find((step) => step * pxPerYear >= minSpacing) ?? steps[steps.length - 1];
  const usable = [...steps]
    .filter((step) => step <= preferred)
    .sort((a, b) => b - a)
    .find((step) => timelineAxisTicks(window, step).length > 0);
  return usable ?? preferred;
};

/**
 * 窓の中の目盛り。年スライダーの時間軸（yearAxis.ts）と同じ規約で、暦の上での通し番号
 * （紀元前 N 年 → −N、紀元元年 → 0、N 年 → N）が step の倍数になる年に打つ。紀元元年は天文年 1（0 は紀元前1年）。
 */
export const timelineAxisTicks = (window: TimelineWindow, step: number): readonly AxisTick[] => {
  const calendarOf = (year: number): number => (year >= 1 ? year : year - 1);
  const first = Math.ceil(calendarOf(Math.ceil(window.center - window.halfSpan)) / step) * step;
  const last = calendarOf(Math.floor(window.center + window.halfSpan));
  const count = Math.max(0, Math.floor((last - first) / step) + 1);
  return Array.from({ length: count }, (_, i) => first + i * step).map((calendar) => ({
    // 通し番号 0 は紀元元年（天文年 1）、−N は紀元前 N 年（天文年 1 − N）
    year: calendar > 0 ? calendar : calendar === 0 ? 1 : 1 + calendar,
    calendar,
    epoch: calendar === 0,
  }));
};

export const timelineAxisLabel = axisLabelText;
