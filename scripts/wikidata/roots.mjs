// 取得の入口にする Wikidata クラス（人が編集する表）。
//
// 「何を候補として引っ張ってくるか」だけを決める。7分類への振り分けは p31-domain-map.mjs が
// 各項目の直接の P31 を見て決めるので、ここに分類は書かない。
//
// - subclasses: true  … `wdt:P31/wdt:P279*`（下位クラスのインスタンスも取る）
// - subclasses: false … `wdt:P31` のみ。下位クラスが広すぎてタイムアウトするクラス用
//
// QID と英語ラベルは 2026-09-20 に wbgetentities / wbsearchentities の出力で照合した
// （記憶で書いた QID のうち3件が別物だったため、追加するときも必ず照合すること）。
// ルート同士が重なっていてもよい（結合時に QID で重複を除く）。

/** @typedef {{ qid: string, label: string, subclasses: boolean }} Root */

/** @type {readonly Root[]} */
export const ROOTS = Object.freeze([
  // ── 紛争まわり
  { qid: "Q178561", label: "battle", subclasses: true },
  { qid: "Q198", label: "war", subclasses: true },
  { qid: "Q188055", label: "siege", subclasses: true },
  { qid: "Q124734", label: "rebellion", subclasses: true },
  { qid: "Q8465", label: "civil war", subclasses: true },
  { qid: "Q3199915", label: "massacre", subclasses: true },
  { qid: "Q41397", label: "genocide", subclasses: true },
  { qid: "Q177716", label: "pogrom", subclasses: true },
  { qid: "Q645883", label: "military operation", subclasses: true },
  { qid: "Q831663", label: "military campaign", subclasses: true },
  { qid: "Q350604", label: "armed conflict", subclasses: true },
  { qid: "Q124757", label: "riot", subclasses: true },
  { qid: "Q511866", label: "mutiny", subclasses: true },
  { qid: "Q2223653", label: "terrorist attack", subclasses: true },
  { qid: "Q3882219", label: "assassination", subclasses: true },

  // ── 政体変動まわり
  { qid: "Q10931", label: "revolution", subclasses: true },
  { qid: "Q45382", label: "coup d'état", subclasses: true },
  { qid: "Q131569", label: "treaty", subclasses: true },
  { qid: "Q1464916", label: "declaration of independence", subclasses: true },
  { qid: "Q194465", label: "annexation", subclasses: true },
  { qid: "Q209715", label: "coronation", subclasses: true },
  { qid: "Q3024240", label: "historical country", subclasses: true },

  // ── 科学・技術まわり
  { qid: "Q2401485", label: "expedition", subclasses: true },
  { qid: "Q3533809", label: "circumnavigation of Earth", subclasses: true },
  { qid: "Q3887", label: "solar eclipse", subclasses: true },
  { qid: "Q56458151", label: "meteorite fall", subclasses: true },
  { qid: "Q463796", label: "impact event", subclasses: true },
  { qid: "Q2656967", label: "nuclear explosion", subclasses: true },
  { qid: "Q210112", label: "nuclear weapons testing", subclasses: true },
  { qid: "Q1620824", label: "nuclear accident", subclasses: true },
  { qid: "Q797476", label: "rocket launch", subclasses: true },
  { qid: "Q7572593", label: "space launch", subclasses: true },
  { qid: "Q172754", label: "world's fair", subclasses: true },

  // ── 経済まわり
  { qid: "Q290178", label: "economic crisis", subclasses: true },
  { qid: "Q114380", label: "financial crisis", subclasses: true },
  { qid: "Q1020018", label: "stock market crash", subclasses: true },
  { qid: "Q806663", label: "bank run", subclasses: true },
  { qid: "Q185565", label: "hyperinflation", subclasses: true },
  { qid: "Q273182", label: "gold rush", subclasses: true },
  { qid: "Q49776", label: "strike", subclasses: true },

  // ── 文化まわり
  { qid: "Q5389", label: "Olympic Games", subclasses: true },
  { qid: "Q51645", label: "ecumenical council", subclasses: true },
  { qid: "Q111161", label: "synod", subclasses: true },

  // ── 人口・環境まわり
  { qid: "Q7944", label: "earthquake", subclasses: true },
  { qid: "Q7692360", label: "volcanic eruption", subclasses: true },
  { qid: "Q8070", label: "tsunami", subclasses: true },
  { qid: "Q8068", label: "flood", subclasses: true },
  { qid: "Q8092", label: "tropical cyclone", subclasses: true },
  { qid: "Q43059", label: "drought", subclasses: true },
  { qid: "Q169950", label: "wildfire", subclasses: true },
  { qid: "Q168983", label: "conflagration", subclasses: true },
  { qid: "Q8065", label: "natural disaster", subclasses: true },
  { qid: "Q44512", label: "epidemic", subclasses: true },
  { qid: "Q12184", label: "pandemic", subclasses: true },
  { qid: "Q1516910", label: "plague epidemic", subclasses: true },
  { qid: "Q168247", label: "famine", subclasses: true },
  { qid: "Q177626", label: "human migration", subclasses: true },
  { qid: "Q6784066", label: "mass migration", subclasses: true },
  { qid: "Q15589476", label: "population transfer", subclasses: true },
  { qid: "Q837556", label: "forced displacement", subclasses: true },
  { qid: "Q379693", label: "deportation", subclasses: true },
  { qid: "Q154278", label: "ethnic cleansing", subclasses: true },
  { qid: "Q815962", label: "colonization", subclasses: true },

  // ── 分類を決め打ちしない広い網。写像漏れの P31 を見つけるために入れる。
  // 下位クラスまで辿ると Wikidata の出来事ほぼ全部になりタイムアウトするので、直接の P31 のみ。
  { qid: "Q13418847", label: "historical event", subclasses: false },
  { qid: "Q1190554", label: "occurrence", subclasses: false },
  { qid: "Q3839081", label: "disaster", subclasses: true },
]);
