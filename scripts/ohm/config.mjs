// 時代別の国境（OpenHistoricalMap）の取得と生成の共通設定。アプリ（src/）からは参照しない。
import { join } from "node:path";

export const OVERPASS_ENDPOINT = "https://overpass-api.openhistoricalmap.org/api/interpreter";

// 連絡先としてリポジトリの URL を入れる（scripts/wikidata/config.mjs と同じ考え方）。
export const USER_AGENT =
  "historical-event-visualizer-ohm/0.1 (https://github.com/nwatab/historical-event-visualizer; historical borders)";

/** 問い合わせと問い合わせの間に必ず空ける時間。並列には投げない。 */
export const PAUSE_BETWEEN_QUERIES_MS = 5_000;
/** 429 / 5xx のときの再試行待ち。Retry-After があればそちらを優先する。 */
export const RETRY_DELAYS_MS = [30_000, 90_000, 240_000];
/** Overpass の [timeout:…]（秒）と、クライアント側で打ち切る時間。 */
export const OVERPASS_TIMEOUT_S = 240;
export const CLIENT_TIMEOUT_MS = 300_000;

/**
 * 国境を出す期間（天文年）。1500 年より前は OHM の穴が大きすぎるので扱わない（scripts/research/borders.md）。
 * BORDER_YEAR_MAX は src/lib/timeline.ts の YEAR_MAX と同じ値（2026-09-21 に目視で転記）。BORDER_YEAR_MIN も src/lib/timeline.ts に同じ値がある（初期表示の年に使う）。
 */
export const BORDER_YEAR_MIN = 1500;
export const BORDER_YEAR_MAX = 2025;

/** 1 回の問い合わせに入れる relation の数。応答が大きい（近現代は 1 relation で数 MB）ので分割する。 */
export const RELATIONS_PER_CHUNK = 25;

const ROOT_DIR = join(import.meta.dirname, "..", "..");
/** 作業用ディレクトリ。.gitignore 済み（/data/raw/）で、コミットしない。 */
export const RAW_DIR = join(ROOT_DIR, "data", "raw", "ohm");
export const TAGS_PATH = join(RAW_DIR, "relations-tags.json");
export const CHUNK_DIR = join(RAW_DIR, "chunks");
export const FETCH_LOG_PATH = join(RAW_DIR, "fetch-log.json");
/** 生成した国境の出力先。こちらはコミットする。 */
export const BORDERS_DIR = join(ROOT_DIR, "public", "data", "borders");

/** 簡略化の許容（度）。合計が SIZE_BUDGET_BYTES を超えたら FALLBACK に切り替える。 */
export const SIMPLIFY_TOLERANCE_DEG = 0.05;
export const SIMPLIFY_TOLERANCE_FALLBACK_DEG = 0.1;
export const SIZE_BUDGET_BYTES = 8 * 1024 * 1024;
