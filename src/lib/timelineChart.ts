import type { Domain, HistEvent, Year } from "@/types/event";
import { DOMAINS } from "./domain";
import { neverOnMap } from "./mapFilters";
import { MIN_ZOOM_BY_IMPORTANCE, TIMELINE_IMPORTANCE_BY_WINDOW } from "./timeline";
import { axisLabelText, type AxisTick } from "./yearAxis";

/*
 * 年表（画面下段。横軸が年、縦軸が分類のレーン）の位置計算。Timeline コンポーネントの描画から切り離した純粋関数。
 * 横軸は、現在年を中心とした窓 [center − halfSpan, center + halfSpan]。現在年は常に中央に来る。
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
 * 窓に入るイベントを、年表の項目にする。
 * - instant は start が窓の中、period / diffusion は [start, end] が窓と重なるもの
 * - 地図と違い、placeKind が "none" の項目（places が空）も出す。年表に場所は要らないため。地図に出ない項目には offMap を付ける
 *   （mapThresholds は、地図のマーカーの importance ごとの閾値。密度による繰り上げ後のものを渡す）
 * - diffusion は period と同じ帯にする。地図のように end の後まで残すことはしない
 */
export const timelineItems = (
  events: readonly HistEvent[],
  window: TimelineWindow,
  hiddenDomains: readonly Domain[],
  mapThresholds: Readonly<Record<HistEvent["importance"], number>> = MIN_ZOOM_BY_IMPORTANCE,
): readonly TimelineItem[] => {
  const from = window.center - window.halfSpan;
  const to = window.center + window.halfSpan;
  const minImportance = timelineMinImportance(windowYears(window));
  return events.flatMap((event): TimelineItem[] => {
    if (event.importance < minImportance) return [];
    if (hiddenDomains.includes(event.domain)) return [];
    const kind = event.kind === "instant" ? "instant" : "period";
    const end = kind === "period" ? (event.end ?? event.start) : event.start;
    if (event.start > to || end < from) return [];
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

/** 現在年からの距離。period は、現在年を含んでいれば 0。 */
const distanceFrom = (item: TimelineItem, year: Year): number =>
  year < item.start ? item.start - year : year > item.end ? year - item.end : 0;

/** importance の高いもの、同じなら現在年に近いものが先。ラベルを置く順と、重なった項目を一覧に出す順に使う。 */
export const byTimelinePriority =
  (center: Year) =>
  (a: TimelineItem, b: TimelineItem): number =>
    b.importance - a.importance ||
    distanceFrom(a, center) - distanceFrom(b, center) ||
    a.start - b.start ||
    a.id.localeCompare(b.id);

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

/** 項目が占める x の範囲 [x0, x1]（窓の外にはみ出した帯は、年表の幅で切る）。 */
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

/** x の位置（± tolerance）にある、そのレーンの項目。優先順（importance、現在年への近さ）で返す。 */
export const itemsAtX = (
  items: readonly TimelineItem[],
  domain: Domain,
  x: number,
  tolerance: number,
  window: TimelineWindow,
  geometry: TimelineGeometry,
): readonly TimelineItem[] =>
  items
    .filter((item) => {
      if (item.domain !== domain) return false;
      const [x0, x1] = itemExtent(item, window, geometry);
      return x >= x0 - tolerance && x <= x1 + tolerance;
    })
    .sort(byTimelinePriority(window.center));

// ── レーンの描き方（点と帯 / ヒストグラム） ──────────────────

/**
 * レーンの描き方。項目が多すぎて点が並びきらないレーンは、点と帯の代わりに 1 年刻みのヒストグラムにする。
 * - items:     点（instant）と帯（period）
 * - histogram: その年に存在する項目の数の棒
 */
export type LaneMode = "items" | "histogram";

/** レーンに点を重ねずに並べられる数（レーンの幅 ÷ 点の直径）。窓内の項目数がこれを超えたらヒストグラムにする。 */
export const laneCapacity = (geometry: TimelineGeometry): number =>
  Math.floor(geometry.width / (2 * geometry.pointRadius));

export const laneModes = (
  items: readonly TimelineItem[],
  geometry: TimelineGeometry,
): Readonly<Record<Domain, LaneMode>> => {
  const capacity = laneCapacity(geometry);
  const count = (domain: Domain): number => items.filter((item) => item.domain === domain).length;
  return Object.fromEntries(
    DOMAINS.map((domain) => [domain, count(domain) > capacity ? "histogram" : "items"]),
  ) as Record<Domain, LaneMode>;
};

/** その年に存在する項目か。instant は start の年、period は start〜end の各年。 */
export const existsInYear = (item: TimelineItem, year: Year): boolean => item.start <= year && year <= item.end;

/** その年に存在する、そのレーンの項目。優先順（importance、現在年への近さ）で返す。 */
export const itemsInYear = (
  items: readonly TimelineItem[],
  domain: Domain,
  year: Year,
  center: Year,
): readonly TimelineItem[] =>
  items.filter((item) => item.domain === domain && existsInYear(item, year)).sort(byTimelinePriority(center));

export interface HistogramBin {
  readonly year: Year;
  readonly count: number;
}

/**
 * 窓の中の整数年ごとの件数。instant は start の年に、period は start〜end の各年に 1 を加える。
 * 差分配列で数える: 項目ごとに「start の年で +1、end の翌年で −1」を置き、先頭から累積する。O(項目数 ＋ 年数)。
 * 年ごとに全項目を調べる方法（O(項目数 × 年数)）だと、±500 年・数百件のレーンで、再生中の毎フレームの計算が重い。
 * 差分の配列は、この関数の中だけで書き換える（引数や外の状態は書き換えない）。
 */
export const laneHistogram = (
  items: readonly TimelineItem[],
  domain: Domain,
  window: TimelineWindow,
): readonly HistogramBin[] => {
  const first = Math.ceil(window.center - window.halfSpan);
  const last = Math.floor(window.center + window.halfSpan);
  const length = Math.max(0, last - first + 1);
  // 末尾の 1 要素は、窓の最後の年まで続く項目の −1 の置き場（累積には使わない）
  const deltas = new Int32Array(length + 1);
  items.forEach((item) => {
    if (item.domain !== domain || item.end < first || item.start > last) return;
    deltas[Math.max(item.start, first) - first] += 1;
    deltas[Math.min(item.end, last) - first + 1] -= 1;
  });
  // 累積和。配列を写しながら畳むと O(年数²) になるので、この関数の中だけの変数に足していく
  let running = 0;
  return Array.from(deltas.subarray(0, length), (delta, i) => {
    running += delta;
    return { year: first + i, count: running };
  });
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

export interface TimelineLabel {
  readonly id: string;
  readonly domain: Domain;
  readonly text: string;
  /** ラベルの左端 */
  readonly x: number;
  readonly width: number;
  /** ラベルが指している位置（項目の右端、帯の左端、ヒストグラムのレーンでは開始年）。 */
  readonly anchor: number;
}

/**
 * ラベルを置く。レーンごとに、優先順（importance の高いもの、同じなら現在年に近いもの）で見ていき、
 * 既に置いたラベルと重なるもの、年表の右端からはみ出すものは出さない。
 * - 点と帯のレーン: 他の項目の点（instant）や短い帯に重なるものも出さない。白いハローを付けない（背景が白の前提）ので、
 *   点の上に乗った文字が読めなくなるため。長い period の帯は薄い塗りなので、その上には置いてよい。
 *   ラベルは項目の右隣に置く（period は帯の左端から）。
 * - ヒストグラムのレーン: importance 3 の項目だけにラベルを出す。ラベルどうしだけを避け、ヒストグラムは避けない
 *   （薄い塗りなので、その上でも読める）。点が無いので、ラベルは開始年の位置から置く。
 */
export const timelineLabels = (
  items: readonly TimelineItem[],
  window: TimelineWindow,
  geometry: TimelineGeometry,
  label: { readonly fontSize: number; readonly gap: number },
  modes: Readonly<Record<Domain, LaneMode>> = laneModes(items, geometry),
): readonly TimelineLabel[] =>
  timelineLanes([]).flatMap((domain) => {
    const histogram = modes[domain] === "histogram";
    const lane = items.filter((item) => item.domain === domain);
    // 避ける対象: 点と、点と同じくらい短い帯（輪郭の縦線が文字を横切る）。ヒストグラムのレーンには点が無い
    const points = histogram
      ? []
      : lane
          .map((item) => ({ id: item.id, kind: item.kind, extent: itemExtent(item, window, geometry) }))
          .filter((p) => p.kind === "instant" || p.extent[1] - p.extent[0] <= 4 * geometry.pointRadius);
    return lane
      .filter((item) => !histogram || item.importance === 3)
      .sort(byTimelinePriority(window.center))
      .reduce<readonly TimelineLabel[]>((placed, item) => {
        const [x0, x1] = itemExtent(item, window, geometry);
        const anchor = histogram
          ? Math.max(0, timelineX(item.start, window, geometry.width))
          : item.kind === "instant"
            ? x1
            : x0;
        const x = anchor + label.gap;
        const width = estimateTextWidth(item.title, label.fontSize);
        const fits = x >= 0 && x + width <= geometry.width;
        const hitsLabel = placed.some((p) => x < p.x + p.width + label.gap && p.x < x + width + label.gap);
        const hitsPoint = points.some((p) => p.id !== item.id && x < p.extent[1] && p.extent[0] < x + width);
        return fits && !hitsLabel && !hitsPoint
          ? [...placed, { id: item.id, domain, text: item.title, x, width, anchor }]
          : placed;
      }, []);
  });

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
