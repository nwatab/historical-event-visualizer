// 国の代表点しか場所が無い項目（placeQuality: "country"）の sitelinks 上位について、
// 人が確認するための下書き（scripts/wikidata/place-overrides.draft.md）を作る。
//
//   pnpm wikidata:place-overrides-draft
//
// 座標の候補は、必ず Wikidata の他の項目の P625 から取り、根拠（どの項目からどう辿ったか）を書く。
// 記憶や推測で座標を書かない。根拠が見つからなければ、座標候補は空欄にして仮分類を none にする。
// 仮分類（point / origin / none）は下の規則で機械的に付けた「たたき台」で、人が確認して直す前提。
import { mkdir, writeFile } from "node:fs/promises";
import {
  APP_RAW_DIR,
  CLASS_LABELS_PATH,
  PLACE_CANDIDATES_PATH,
  PLACE_CANDIDATE_LABELS_PATH,
  PLACE_OVERRIDES_DRAFT_PATH,
} from "./config.mjs";
import { loadAnalysis, readJson, readJsonOr } from "./load-analysis.mjs";
import { DOMAIN_LABELS, formatYear } from "./report-common.mjs";
import {
  PLACE_CANDIDATE_ROUTES,
  buildLabelsQuery,
  buildPlaceCandidatesQuery,
  parsePoint,
  qidOf,
  runQuery,
} from "./sparql.mjs";

const TOP_N = 100;

/** @typedef {keyof typeof PLACE_CANDIDATE_ROUTES} Route */
/** 保存する候補。ラベルは持たせず、表を作るときに引く。 @typedef {{ route: Route, agent?: string, src: string, lon: number, lat: number }} Candidate */

// 候補の辿り方の強さ（先頭が強い）。capital は「国を首都で代表させる」だけなので、地点の根拠には採らない
const ROUTE_ORDER = /** @type {const} */ (["creation", "agentWork", "agentHq", "capital"]);
const ROUTE_LABELS = Object.freeze({
  creation: "P1071（制作地）",
  agentWork: "の P937（活動地）",
  agentHq: "の P159（本部所在地）",
  capital: "の P36（首都）",
});

// 仮分類に使う P31（人が編集する表）。QID と英語ラベルは 2026-09-20 に wbgetentities の出力で照合した
// （上位100件に実際に現れた P31 から選んだ）。どちらにも当たらない P31（機器・ソフトウェア・楽器・計画など）は、候補があれば point。
// - CONCEPT: 広がりを持つ概念（ジャンル・宗教・言語・競技・通貨・様式など）。起点が分かれば origin
// - WORK: 作品（映画・番組・小説・楽曲・ゲームなど）。「どこで起きたか」が無いので、候補があっても none
/** @type {ReadonlySet<string>} */
const CONCEPT_CLASSES = new Set([
  "Q188451", // music genre
  "Q483394", // genre
  "Q968159", // art movement
  "Q3326867", // painting movement
  "Q1792644", // art style
  "Q1792379", // art genre
  "Q32880", // architectural style
  "Q107357104", // type of dance
  "Q112613966", // singing style
  "Q7777573", // theatrical genre
  "Q112248470", // type of dramatico-musical work
  "Q89522629", // poetic form
  "Q8142", // currency
  "Q756202", // reserve currency
  "Q25401445", // decimal currency
  "Q13479982", // cryptocurrency
  "Q1368", // money
  "Q14083", // dollar
  "Q339180", // pound
  "Q25530138", // yuan
  "Q15788", // ruble
  "Q1403377", // franc
]);
/** @type {ReadonlySet<string>} */
const WORK_CLASSES = new Set([
  "Q7725634", // literary work
  "Q47461344", // written work
  "Q116476516", // dramatic work
  "Q13593966", // literary trilogy
  "Q1667921", // novel series
  "Q699", // fairy tale
  "Q46337", // manifesto
  "Q1002697", // periodical
  "Q11424", // film
  "Q202866", // animated film
  "Q20650540", // anime film
  "Q130371093", // film franchise
  "Q196600", // media franchise
  "Q5398426", // television series
  "Q117467246", // animated television series
  "Q113791292", // animated short film series
  "Q21198342", // manga series
  "Q105543609", // musical work/composition
  "Q23691", // national anthem
]);

/**
 * @param {readonly string[]} p31 @param {Candidate | undefined} best capital 以外で最も強い候補
 * @returns {{ kind: "point" | "origin" | "none", reason: string }}
 */
export const provisionalKind = (p31, best) => {
  if (p31.some((c) => WORK_CLASSES.has(c))) return { kind: "none", reason: "場所の概念が無い（作品）" };
  const isConcept = p31.some((c) => CONCEPT_CLASSES.has(c));
  if (!best) {
    return {
      kind: "none",
      reason: isConcept
        ? "広がる概念だが、起点の根拠が見つからない（根拠にする項目が決まれば origin）"
        : "地点の根拠が見つからない（根拠にする項目が決まれば point）",
    };
  }
  if (isConcept) return { kind: "origin", reason: "起点は明確だが広がる概念" };
  return { kind: "point", reason: "地名が特定できる" };
};

/** @param {Candidate} c @param {(qid: string) => string} labelOf */
const describe = (c, labelOf) =>
  c.route === "creation" || !c.agent
    ? `${ROUTE_LABELS.creation} → ${labelOf(c.src)}（${c.src}）の P625`
    : `${labelOf(c.agent)}（${c.agent}）${ROUTE_LABELS[c.route]} → ${labelOf(c.src)}（${c.src}）の P625`;

// ── メイン ────────────────────────────────────────────────

await mkdir(APP_RAW_DIR, { recursive: true });
const { population } = await loadAnalysis();
const targets = population
  .filter((i) => i.countryLevelPlace)
  .sort((a, b) => b.sitelinks - a.sitelinks || a.qid.localeCompare(b.qid))
  .slice(0, TOP_N);

/** @type {Record<string, Candidate[]>} */
const known = await readJsonOr(PLACE_CANDIDATES_PATH, {});
const missing = targets.map((i) => i.qid).filter((q) => !(q in known));
/** @template T @param {readonly T[]} xs @param {number} size @returns {T[][]} */
const chunksOf = (xs, size) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

const ROUTES = /** @type {Route[]} */ (Object.keys(PLACE_CANDIDATE_ROUTES));

/** @param {readonly string[]} batch @returns {Promise<[string, Candidate[]][]>} どれかの route が失敗したら空（再実行で取り直す） */
const fetchCandidates = async (batch) => {
  const results = await ROUTES.reduce(
    async (accP, route) => [...(await accP), { route, result: await runQuery(buildPlaceCandidatesQuery(batch, route)) }],
    /** @type {Promise<{ route: Route, result: Awaited<ReturnType<typeof runQuery>> }[]>} */ (Promise.resolve([])),
  );
  const failed = results.find((r) => r.result.status !== "ok");
  if (failed) {
    console.warn(`  候補の取得に失敗（${batch.length} 件、${failed.route}）: ${failed.result.status}。再実行すれば、この分だけ取り直す`);
    return [];
  }
  const rows = results.flatMap(({ route, result }) =>
    result.status !== "ok"
      ? []
      : result.bindings.flatMap((b) => {
          const point = parsePoint(b.coord.value);
          return point
            ? [{ item: qidOf(b.item.value), route, ...(b.agent ? { agent: qidOf(b.agent.value) } : {}), src: qidOf(b.src.value), ...point }]
            : [];
        }),
  );
  console.log(`  ${batch.length} 件 → 候補 ${rows.length}`);
  return batch.map((qid) => [
    qid,
    rows
      .filter((r) => r.item === qid)
      .map((r) => ({ route: r.route, ...(r.agent ? { agent: r.agent } : {}), src: r.src, lon: r.lon, lat: r.lat })),
  ]);
};
const fetched = Object.fromEntries(
  await chunksOf(missing, 20).reduce(
    async (accP, batch) => [...(await accP), ...(await fetchCandidates(batch))],
    /** @type {Promise<[string, Candidate[]][]>} */ (Promise.resolve([])),
  ),
);
/** @type {Record<string, Candidate[]>} */
const candidates = { ...known, ...fetched };
await writeFile(PLACE_CANDIDATES_PATH, JSON.stringify(candidates));

const unfetched = targets.filter((i) => !(i.qid in candidates));
if (unfetched.length > 0) throw new Error(`候補を取得できていない項目が ${unfetched.length} 件あります。もう一度実行してください。`);

// 表に出すラベル: P31 のクラス、候補の関係者と場所。足りない分だけ引く
/** @type {Record<string, { ja?: string, en?: string }>} */
const classLabels = await readJson(CLASS_LABELS_PATH);
/** @type {Record<string, { ja?: string, en?: string }>} */
const knownLabels = await readJsonOr(PLACE_CANDIDATE_LABELS_PATH, {});
const wanted = [
  ...new Set([
    ...targets.flatMap((i) => i.p31),
    ...targets.flatMap((i) => candidates[i.qid].flatMap((c) => [c.src, ...(c.agent ? [c.agent] : [])])),
  ]),
].filter((q) => !(q in classLabels) && !(q in knownLabels));
const newLabels = Object.fromEntries(
  await chunksOf(wanted, 300).reduce(
    async (accP, batch) => {
      const acc = await accP;
      const result = await runQuery(buildLabelsQuery(batch));
      if (result.status !== "ok") throw new Error(`ラベルの取得に失敗: ${result.status}。もう一度実行してください。`);
      const byItem = Map.groupBy(result.bindings, (b) => qidOf(b.c.value));
      return [
        ...acc,
        ...batch.map((q) => {
          const rs = byItem.get(q) ?? [];
          const ja = rs.find((b) => b.ja)?.ja.value;
          const en = rs.find((b) => b.en)?.en.value;
          return /** @type {[string, { ja?: string, en?: string }]} */ ([q, { ...(ja ? { ja } : {}), ...(en ? { en } : {}) }]);
        }),
      ];
    },
    /** @type {Promise<[string, { ja?: string, en?: string }][]>} */ (Promise.resolve([])),
  ),
);
const labels = { ...classLabels, ...knownLabels, ...newLabels };
await writeFile(PLACE_CANDIDATE_LABELS_PATH, JSON.stringify({ ...knownLabels, ...newLabels }));
const labelOfClass = (/** @type {string} */ q) => labels[q]?.en ?? q;
const labelOf = (/** @type {string} */ q) => labels[q]?.ja ?? labels[q]?.en ?? q;

const rows = targets.map((item, idx) => {
  /** @type {Candidate[]} */
  const cs = [...(candidates[item.qid] ?? [])].sort((a, b) => ROUTE_ORDER.indexOf(a.route) - ROUTE_ORDER.indexOf(b.route));
  const best = cs.find((c) => c.route !== "capital");
  const { kind, reason } = provisionalKind(item.p31, best);
  const use = kind === "none" ? undefined : best;
  const others = cs.filter((c) => c !== use && c.route !== "capital").slice(0, 3);
  const capital = cs.find((c) => c.route === "capital");
  const domain = item.classification.status === "mapped" ? DOMAIN_LABELS[item.classification.domain] : "";
  return [
    idx + 1,
    `[${item.qid}](https://www.wikidata.org/wiki/${item.qid})`,
    item.label,
    formatYear(/** @type {any} */ (item.start).year),
    domain,
    item.sitelinks,
    item.p31.map(labelOfClass).join(", "),
    `**${kind}**`,
    use ? `${use.lat.toFixed(4)}, ${use.lon.toFixed(4)}` : "",
    [
      reason,
      use ? `根拠: ${describe(use, labelOf)}` : "",
      others.length > 0 ? `他の候補: ${others.map((c) => `${describe(c, labelOf)} = ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`).join(" ／ ")}` : "",
      !use && capital ? `（参考）${describe(capital, labelOf)} はあるが、国を首都で代表させるだけなので採らない` : "",
    ]
      .filter(Boolean)
      .join("。"),
  ];
});

const counts = Map.groupBy(rows, (r) => String(r[7]));
const md = [
  "# place-overrides の下書き（人の確認待ち）",
  "",
  "> `pnpm wikidata:place-overrides-draft`（scripts/wikidata/build-place-overrides-draft.mjs）が生成した下書き。",
  "> 国の代表点しか場所が無い項目（Wikidata の P495 原産国 / P17 国 から取った座標）のうち、sitelinks 上位 100 件。",
  "",
  "## 確認のしかた",
  "",
  "- **仮分類**は機械的に付けたたたき台。`point`（特定地点で起きた）/ `origin`（広がる概念の起点）/ `none`（場所の概念が無い）を、行ごとに確認して直す。",
  "- **座標候補**（緯度, 経度）は、すべて Wikidata の他の項目の P625 から取った値で、根拠の欄に辿り方と QID を書いてある。記憶や推測で書いた座標は無い。",
  "  - 辿り方: P1071（制作地）、発見者・発明者・作者・創設者・開発者・製造者・作曲者・監督（P61/P170/P50/P112/P178/P176/P86/P57）の P937（活動地）、それらや制作会社（P272）の P159（本部所在地）。",
  "  - P495 / P17 の先の P36（首都）は、国を首都で代表させるだけなので、座標候補には採っていない（参考として根拠の欄に書いた）。",
  "  - 根拠が見つからない項目は、座標候補を空欄にして `none` にしてある。座標を足す場合は、根拠にする Wikidata の項目（QID）を決めてから、その P625 を写す。",
  "  - 作者の活動地や会社の本部は、その出来事の場所と一致するとは限らない（発明者の晩年の活動地など）。`point` にする前に、根拠の項目を開いて確認する。",
  "- 承認後は、この表を `scripts/wikidata/place-overrides.json` にして build-app-data.mjs に読ませる（未実装。表が承認されてから作る）。",
  "  101 位以下の項目は、当面 `none` として扱う。",
  "",
  `仮分類の内訳: ${["**point**", "**origin**", "**none**"].map((k) => `${k} ${counts.get(k)?.length ?? 0} 件`).join("、")}`,
  "",
  `| # | QID | ラベル | 年 | 分類 | sitelinks | P31 | 仮分類 | 座標候補（緯度, 経度） | 理由・根拠 |`,
  `| ---: | --- | --- | ---: | --- | ---: | --- | --- | --- | --- |`,
  ...rows.map((r) => `| ${r.join(" | ")} |`),
  "",
].join("\n");
await writeFile(PLACE_OVERRIDES_DRAFT_PATH, md);
console.log(`${rows.length} 件 → ${PLACE_OVERRIDES_DRAFT_PATH}`);
console.log([...counts.entries()].map(([k, v]) => `${k}: ${v.length}`).join("、"));
