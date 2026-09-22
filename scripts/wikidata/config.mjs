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
/** 年か場所が取れなかった項目を、理由付きで書き出す先（手入力の候補）。report.mjs が作る。 */
export const LIST_MISSING_PATH = join(LISTS_DIR, "missing.json");

// アプリ用データの生成（R4b-2）に追加で要る取得結果。作業用で、コミットしない。
export const APP_RAW_DIR = join(ROOT_DIR, "data", "raw", "app");
/** QID → { ja?: 記事名, en?: 記事名 } */
export const ARTICLES_PATH = join(APP_RAW_DIR, "articles.json");
/** 日本語・英語のラベルが無い項目の、多言語共通ラベル（mul）。QID → ラベル（無ければ null） */
export const MUL_LABELS_PATH = join(APP_RAW_DIR, "mul-labels.json");
/** 場所（P276 などの先）の QID → { ja?, en? } */
export const PLACE_LABELS_PATH = join(APP_RAW_DIR, "place-labels.json");
/** 場所の項目（P276 / P189 などの先）の P31 とラベル。QID → { p31: string[], ja?, en? }。場所の粒度の判定に使う */
export const PLACE_CLASSES_PATH = join(APP_RAW_DIR, "place-classes.json");
/** 場所の項目の P31 に現れたクラスのラベル。QID → 英語ラベル（place-granularity.mjs の表を作るときに見る） */
export const PLACE_CLASS_LABELS_PATH = join(APP_RAW_DIR, "place-class-labels.json");
export const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
/** 人が承認した地点・起点の表（コミットする）。座標は書かれておらず、下の OVERRIDE_PLACES_PATH に取得結果を保存する */
export const PLACE_OVERRIDES_PATH = join(import.meta.dirname, "place-overrides.json");
/** place-overrides.json の places[].from から引いた座標。キーは `${from}|${path}` */
export const OVERRIDE_PLACES_PATH = join(APP_RAW_DIR, "override-places.json");
/** 国の代表点しか無い項目（sitelinks 上位）の、地点の候補。QID → 候補の配列 */
export const PLACE_CANDIDATES_PATH = join(APP_RAW_DIR, "place-candidates.json");
export const PLACE_CANDIDATE_LABELS_PATH = join(APP_RAW_DIR, "place-candidate-labels.json");
/** 人が確認するための下書き（コミットする）。承認後の表は place-overrides.json */
/** 場所が大陸・海洋（coarse）だけで、地図に出ない項目の一覧（build-app-data.mjs が作り直す。place-overrides の候補） */
export const COARSE_ONLY_PATH = join(import.meta.dirname, "coarse-only.md");
export const PLACE_OVERRIDES_DRAFT_PATH = join(import.meta.dirname, "place-overrides.draft.md");
/** place-overrides.json の下書き（status: "draft"）を、人が確認するための表（build-place-overrides-review.mjs が作る） */
export const PLACE_OVERRIDES_REVIEW_PATH = join(import.meta.dirname, "place-overrides.review.md");
/** 人が書いた、広がる出来事（diffusion）の起点と到達点の表。1 イベント 1 ファイル（コミットする）。座標は書かず、QID から引く */
export const DIFFUSION_DIR = join(ROOT_DIR, "data", "diffusion");
/** 人が確認するための、diffusion の下書きの表（build-diffusion-draft.mjs が作る） */
export const DIFFUSION_DRAFT_PATH = join(import.meta.dirname, "diffusion.draft.md");
/** 生成したアプリ用データの出力先。こちらはコミットする。 */
export const APP_DATA_DIR = join(ROOT_DIR, "public", "data", "events");

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
