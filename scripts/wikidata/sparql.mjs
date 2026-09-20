// SPARQL のクエリ組み立て（純粋関数）と、エンドポイントへの問い合わせ（副作用はここだけ）。
import {
  CLIENT_TIMEOUT_MS,
  PAUSE_BETWEEN_QUERIES_MS,
  RETRY_DELAYS_MS,
  SPARQL_ENDPOINT,
  USER_AGENT,
} from "./config.mjs";

/** @typedef {{ from: number, to: number }} Slice 天文年の半開区間 [from, to) */

// ── クエリ組み立て ─────────────────────────────────────────

/**
 * 天文年を xsd:dateTime リテラルにする。
 * WDQS の RDF は XSD 1.1 で、年 0 が存在する天文年方式（カデシュの戦い＝紀元前1274年が
 * `-1273-05-01T00:00:00Z` で返ることを 2026-09-20 に確認）。wbgetentities の JSON（同じ値が
 * `-1274-05-00`）とは 1 ずれるので、SPARQL 経由の年には bce() を通さない。
 * @param {number} year
 */
export const yearLiteral = (year) => {
  const abs = String(Math.abs(year)).padStart(4, "0");
  return `"${year < 0 ? "-" : ""}${abs}-01-01T00:00:00Z"^^xsd:dateTime`;
};

/** @param {{ qid: string, subclasses: boolean }} root */
const rootPattern = (root) =>
  root.subclasses ? `?item wdt:P31/wdt:P279* wd:${root.qid} .` : `?item wdt:P31 wd:${root.qid} .`;

// 非推奨ランクの値を拾わないよう BestRank に限る（wdt: と同じ範囲）。
// 精度（年・世紀など）が要るので、wdt: ではなく値ノード経由で取る。
const TIME_PATTERN = `
  VALUES (?p ?psv ?prop) { (p:P585 psv:P585 "P585") (p:P580 psv:P580 "P580") (p:P582 psv:P582 "P582") }
  ?item ?p ?st . ?st a wikibase:BestRank ; ?psv ?v .
  ?v wikibase:timeValue ?t ; wikibase:timePrecision ?prec .`;

/** @param {Slice | null} slice */
const sliceFilter = (slice) =>
  slice ? `FILTER(?t >= ${yearLiteral(slice.from)} && ?t < ${yearLiteral(slice.to)})` : "";

/**
 * 取得クエリの種類（R4b-1）。ルートの group で決まる。
 * - "items"      … 従来どおり。P625 必須。
 * - "engagement" … 会戦。P625 必須で、P361（〜の一部）を親として併せて取る。
 * - "war"        … 期間を持つ紛争。P625 は任意（無い項目も分母として残す）。P361 も取る。
 * - "warloc"     … war と同じ項目の P276（場所）と、その先の P625。座標を持たない場所も行として返す。
 * @typedef {"items" | "engagement" | "war" | "warloc"} QueryKind
 */

const LABELS_AND_P31 = `
  OPTIONAL { ?item wdt:P31 ?p31 }
  OPTIONAL { ?item rdfs:label ?ja FILTER(LANG(?ja) = "ja") }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }`;

/**
 * 1ルート（×1年代スライス）分の項目を取るクエリ。
 * 1項目が「座標の数 × 時点の数 × P31 の数（× 親の数）」行に展開されて返る。結合は merge.mjs で行う。
 * @param {{ qid: string, subclasses: boolean }} root
 * @param {Slice | null} slice
 * @param {QueryKind} [kind]
 */
export const buildItemsQuery = (root, slice, kind = "items") => {
  if (kind === "warloc") {
    // 年代で分割するときだけ時点を結合する（分割しないなら「年がある」ことだけ確かめれば足りる）
    return `
SELECT DISTINCT ?item ?loc ?locCoord WHERE {
  ${rootPattern(root)}
  ${slice ? `${TIME_PATTERN}\n  ${sliceFilter(slice)}` : "FILTER EXISTS { ?item wdt:P585|wdt:P580|wdt:P582 ?anyTime }"}
  ?item wdt:P276 ?loc .
  OPTIONAL { ?loc wdt:P625 ?locCoord }
}`;
  }
  const coord = kind === "war" ? "OPTIONAL { ?item wdt:P625 ?coord }" : "?item wdt:P625 ?coord .";
  const parent = kind === "items" ? "" : "OPTIONAL { ?item wdt:P361 ?parent }";
  return `
SELECT ?item ?links ?coord ?prop ?t ?prec ?p31 ?ja ?en ${kind === "items" ? "" : "?parent"} WHERE {
  ${rootPattern(root)}
  ?item wikibase:sitelinks ?links .
  ${coord}
  ${TIME_PATTERN}
  ${sliceFilter(slice)}
  ${parent}
  ${LABELS_AND_P31}
}`;
};

/**
 * 親（P361 の先）のうち、取得済みの項目に含まれないものを引く。親が戦争かどうかを、
 * P31 と、さらにその親（戦線 → 戦争 のような連鎖）から判断するため。
 * @param {readonly string[]} qids
 */
export const buildParentsQuery = (qids) => `
SELECT ?item ?links ?p31 ?parent ?ja ?en WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
  ?item wikibase:sitelinks ?links .
  OPTIONAL { ?item wdt:P361 ?parent }
  ${LABELS_AND_P31}
}`;

/**
 * 「年はあるが座標が無い」ために落ちる件数を測るクエリ。
 * viaLocation は、P625 は無いが P276（場所）の先に P625 がある件数。
 * @param {{ qid: string, subclasses: boolean }} root
 */
export const buildCoordLossQuery = (root) => `
SELECT (COUNT(DISTINCT ?item) AS ?withTime)
       (COUNT(DISTINCT ?hasCoord) AS ?withCoord)
       (COUNT(DISTINCT ?viaLoc) AS ?viaLocation) WHERE {
  ${rootPattern(root)}
  FILTER EXISTS { ?item wdt:P585|wdt:P580|wdt:P582 ?anyTime }
  OPTIONAL { ?item wdt:P625 ?c . BIND(?item AS ?hasCoord) }
  OPTIONAL {
    FILTER NOT EXISTS { ?item wdt:P625 ?c2 }
    ?item wdt:P276/wdt:P625 ?lc . BIND(?item AS ?viaLoc)
  }
}`;

/** @param {readonly string[]} qids */
export const buildLabelsQuery = (qids) => `
SELECT ?c ?ja ?en WHERE {
  VALUES ?c { ${qids.map((q) => `wd:${q}`).join(" ")} }
  OPTIONAL { ?c rdfs:label ?ja FILTER(LANG(?ja) = "ja") }
  OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en) = "en") }
}`;

/**
 * 指定した項目を、座標や年の有無を条件にせずに引く（手動追加した項目の確認用）。
 * P571（成立日）は取得条件には使っていないが、年の代わりに何を持っているかを知るために見る。
 * @param {readonly string[]} qids
 */
export const buildManualItemsQuery = (qids) => `
SELECT ?item ?links ?p31 ?coord ?prop ?t WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
  ?item wikibase:sitelinks ?links .
  OPTIONAL { ?item wdt:P31 ?p31 }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL {
    VALUES (?w ?prop) { (wdt:P585 "P585") (wdt:P580 "P580") (wdt:P582 "P582") (wdt:P571 "P571") }
    ?item ?w ?t .
  }
}`;

/**
 * 指定した項目のうち、war グループのルートのどれかの（下位クラスの）インスタンスであるもの。
 * 親が「戦争」かどうかを、項目の取得と同じ基準（P31/P279*）で判定するため。
 * @param {readonly string[]} qids @param {readonly string[]} warRootQids
 */
export const buildWarFlagsQuery = (qids, warRootQids) => `
SELECT DISTINCT ?item WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
  VALUES ?root { ${warRootQids.map((q) => `wd:${q}`).join(" ")} }
  ?item wdt:P31/wdt:P279* ?root .
}`;

// ── 選抜リストの項目の属性（R4b-1）。QID を VALUES で渡すので、どれも軽い。

/** @param {readonly string[]} qids */
const valuesOf = (qids) => `VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }`;

/** sitelinks・ラベル・P31。 @param {readonly string[]} qids */
export const buildListCoreQuery = (qids) => `
SELECT ?item ?links ?p31 ?ja ?en WHERE {
  ${valuesOf(qids)}
  ?item wikibase:sitelinks ?links .
  ${LABELS_AND_P31}
}`;

/** 年のプロパティ（精度つき、BestRank）。 @param {readonly string[]} qids @param {readonly string[]} props */
export const buildListTimesQuery = (qids, props) => `
SELECT ?item ?prop ?t ?prec WHERE {
  ${valuesOf(qids)}
  VALUES (?p ?psv ?prop) { ${props.map((p) => `(p:${p} psv:${p} "${p}")`).join(" ")} }
  ?item ?p ?st . ?st a wikibase:BestRank ; ?psv ?v .
  ?v wikibase:timeValue ?t ; wikibase:timePrecision ?prec .
}`;

/** 場所。P625 は項目自身の座標、それ以外は値の項目（?loc）が持つ座標。 @param {readonly string[]} qids @param {readonly string[]} props */
export const buildListPlacesQuery = (qids, props) => `
SELECT ?item ?prop ?loc ?coord WHERE {
  ${valuesOf(qids)}
  {
    ?item wdt:P625 ?coord . BIND("P625" AS ?prop)
  } UNION {
    VALUES (?w ?prop) { ${props.filter((p) => p !== "P625").map((p) => `(wdt:${p} "${p}")`).join(" ")} }
    ?item ?w ?loc . ?loc wdt:P625 ?coord .
  }
}`;

/**
 * 指定した項目のうち、人口（P1082）を持つもの。都市・国・地方を、P31 の種類を列挙せずに見分けるために使う
 * （年表の行の主題から、地名のリンクを外す）。
 * @param {readonly string[]} qids
 */
export const buildPopulatedQuery = (qids) => `
SELECT DISTINCT ?item WHERE {
  ${valuesOf(qids)}
  ?item wdt:P1082 ?population .
}`;

// ── 応答の解釈（純粋関数） ──────────────────────────────────

/** @param {string} uri */
export const qidOf = (uri) => uri.slice(uri.lastIndexOf("/") + 1);

/**
 * WKT の `Point(lon lat)` を読む。地球以外の天体（月面など）は先頭に `<…globe…>` が付くので null。
 * @param {string} wkt
 * @returns {{ lon: number, lat: number } | null}
 */
export const parsePoint = (wkt) => {
  const m = /^Point\((-?[\d.eE+-]+) (-?[\d.eE+-]+)\)$/.exec(wkt.trim());
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : null;
};

/**
 * xsd:dateTime から天文年を取り出す（Date は使わない。CLAUDE.md「年の扱い」）。
 * @param {string} dateTime 例: "-1273-05-01T00:00:00Z"
 * @returns {number | null}
 */
export const parseYear = (dateTime) => {
  const m = /^(-?)(\d+)-/.exec(dateTime);
  return m ? (m[1] === "-" ? -1 : 1) * Number(m[2]) : null;
};

// ── 問い合わせ（副作用） ────────────────────────────────────

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @typedef {{ status: "ok", bindings: readonly Record<string, { value: string }>[], ms: number }
 *   | { status: "timeout", ms: number }
 *   | { status: "error", ms: number, detail: string }} QueryResult
 */

/**
 * 1回だけ問い合わせる。
 * @param {string} query
 * @returns {Promise<QueryResult & { retryAfterMs?: number }>}
 */
const requestOnce = async (query) => {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const res = await fetch(`${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    const body = await res.text();
    if (res.ok) {
      return { status: "ok", bindings: JSON.parse(body).results.bindings, ms: elapsed() };
    }
    if (body.includes("TimeoutException")) return { status: "timeout", ms: elapsed() };
    const retryAfter = Number(res.headers.get("retry-after"));
    return {
      status: "error",
      ms: elapsed(),
      detail: `HTTP ${res.status}`,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
    };
  } catch (e) {
    // クライアント側の打ち切りも、結果の途中切れ（JSON 不正）もタイムアウト扱いにして分割させる。
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError" || name === "SyntaxError") {
      return { status: "timeout", ms: elapsed() };
    }
    return { status: "error", ms: elapsed(), detail: String(e) };
  }
};

/**
 * 間隔を空けて問い合わせる。429 / 5xx は待ってから再試行する。
 * ゲートウェイの 502/504 は 60 秒付近で出るとタイムアウトと区別できないため、
 * 50 秒以上かかった error は timeout として返す（呼び出し側が分割する）。
 * @param {string} query
 * @param {readonly number[]} [delays]
 * @returns {Promise<QueryResult>}
 */
export const runQuery = async (query, delays = RETRY_DELAYS_MS) => {
  await sleep(PAUSE_BETWEEN_QUERIES_MS);
  const result = await requestOnce(query);
  if (result.status !== "error") return result;
  if (result.ms >= 50_000) return { status: "timeout", ms: result.ms };
  if (delays.length === 0) return result;
  const wait = Math.max(delays[0], result.retryAfterMs ?? 0);
  console.warn(`  ${result.detail} — ${Math.round(wait / 1000)}s 待って再試行`);
  await sleep(wait);
  return runQuery(query, delays.slice(1));
};
