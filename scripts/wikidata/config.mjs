// R4a: Wikidata 取得・分布レポート用スクリプトの共通設定。
// アプリ（src/）からは参照しない。src/ の値と揃える必要があるものは、その旨を書く。
import { join } from "node:path";

export const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

// Wikimedia の User-Agent ポリシー（https://meta.wikimedia.org/wiki/User-Agent_policy）に従い、
// 連絡先としてリポジトリの URL を入れる。
export const USER_AGENT =
  "historical-event-visualizer-r4a/0.1 (https://github.com/nwatab/historical-event-visualizer; distribution survey script)";

/** クエリとクエリの間に必ず空ける時間。並列には投げない。 */
export const PAUSE_BETWEEN_QUERIES_MS = 2_000;
/** 429 / 5xx（タイムアウト以外）のときの再試行待ち。Retry-After があればそちらを優先する。 */
export const RETRY_DELAYS_MS = [15_000, 45_000, 120_000];
/** サーバー側のタイムアウトは 60 秒。それを少し超えても応答が無ければクライアント側で打ち切る。 */
export const CLIENT_TIMEOUT_MS = 75_000;

/** タイムアウトしたとき最初に二分割する年の範囲（天文年）と、最初の分割点。 */
export const SLICE_RANGE = Object.freeze({ from: -10_000, to: 2_100 });
export const FIRST_SPLIT_YEAR = 1800;

// アプリが表示できる年の範囲。src/lib/timeline.ts の YEAR_MIN / YEAR_MAX と同じ値（2026-09-20 に目視で転記）。
export const APP_YEAR_MIN = -3000;
export const APP_YEAR_MAX = 2025;

const ROOT_DIR = join(import.meta.dirname, "..", "..");
/** 作業用ディレクトリ。.gitignore 済みで、コミットしない。 */
export const RAW_DIR = join(ROOT_DIR, "data", "raw", "wikidata");
export const CHUNK_DIR = join(RAW_DIR, "chunks");
export const EVENTS_PATH = join(RAW_DIR, "events.json");
export const CLASS_LABELS_PATH = join(RAW_DIR, "class-labels.json");
export const COORD_LOSS_PATH = join(RAW_DIR, "coord-loss.json");
export const PARENTS_PATH = join(RAW_DIR, "parents.json");
export const MANUAL_ITEMS_PATH = join(RAW_DIR, "manual-items.json");
export const FETCH_LOG_PATH = join(RAW_DIR, "fetch-log.json");
// Wikipedia の選抜リスト（R4b-1）。これも作業用で、コミットしない。
export const LISTS_DIR = join(ROOT_DIR, "data", "raw", "lists");
export const LIST_PAGES_DIR = join(LISTS_DIR, "pages");
export const LIST_TITLES_PATH = join(LISTS_DIR, "titles.json");
export const LIST_ATTRS_PATH = join(LISTS_DIR, "attrs.json");
/** 年表の主題の候補のうち、人口（P1082）を持つ項目（＝地名）。QID → true/false。 */
export const LIST_POPULATED_PATH = join(LISTS_DIR, "populated.json");
/** 年か場所が取れなかった項目を、理由付きで書き出す先（手入力の候補）。report.mjs が作る。 */
export const LIST_MISSING_PATH = join(LISTS_DIR, "missing.json");

export const REPORT_PATH = join(import.meta.dirname, "REPORT.md");

// 地域判定に使う国ポリゴン。public/geo/ の陸地データと同じ Natural Earth（パブリックドメイン）。
// タグで固定して再現できるようにする。作業用ディレクトリに保存し、コミットしない。
export const COUNTRIES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson";
export const COUNTRIES_PATH = join(ROOT_DIR, "data", "raw", "ne_50m_admin_0_countries.geojson");

// R3a で手動追加した4件（src/data/events.sample.ts の id を 2026-09-20 に転記）。
export const MANUAL_ITEMS = Object.freeze([
  { qid: "Q28573", name: "インカ帝国" },
  { qid: "Q9141", name: "タージ・マハル" },
  { qid: "Q1545405", name: "ニュージーランド戦争" },
  { qid: "Q705553", name: "マジ・マジ反乱" },
]);
