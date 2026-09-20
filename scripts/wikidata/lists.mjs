// 科学・技術・経済・文化を取るための、Wikipedia の選抜リスト（人が編集する表）。
//
// R4a の結論: P31 と座標に頼る取得では、この4分類は実質的に空になる（発明・発見・著作は「出来事」の項目ではなく、
// 物・概念・著作の項目として存在するため）。そこで、人が選抜したリストから項目を取り、分類はリストの節で決める。
//
// 出典はすべて英語版 Wikipedia（CC BY-SA 4.0）。ページ名は 2026-09-20 に API（list=allpages, prop=info）で
// 存在とリダイレクトでないことを確認した。「Wikipedia:Vital articles/Level/5/…」は「…/Level 5/…」へのリダイレクト。

/** @typedef {import("./p31-domain-map.mjs").Domain} Domain */

export const VITAL_PREFIX = "Wikipedia:Vital articles/Level 5/";

/**
 * Vital articles Level 5 のページ。
 * - domain: null は「節から分類を決めない」。History がこれに当たり、分類は P31 の写像表に任せる
 *   （History の節は地域・時代別で、7分類と対応しないため）。importance の「選抜済み」には数える。
 * - sections: 見出しのうち、取り込むもの（その下位の見出しも含む）。省略時は全部。
 * - excludeSections: 取り込まないもの。
 *
 * 入れていないページと理由:
 * - Biology and health sciences/Animals, /Plants … 生物の分類群で、年も場所も持たない。数千件が「取れなかった項目」に並ぶだけになる。
 * - Society and social sciences の Business and economics / Companies 以外 … 依頼の範囲が「経済」のため。
 * - Philosophy and religion … 依頼の範囲外。CLAUDE.md の culture は「思想・宗教・文化」なので、足す候補ではある。
 *
 * @typedef {{ page: string, domain: Domain | null, sections?: readonly string[], excludeSections?: readonly string[] }} VitalPage
 * @type {readonly VitalPage[]}
 */
export const VITAL_PAGES = Object.freeze([
  { page: "History", domain: null },

  { page: "Physical sciences/Basics and measurement", domain: "science" },
  { page: "Physical sciences/Astronomy", domain: "science" },
  { page: "Physical sciences/Chemistry", domain: "science" },
  { page: "Physical sciences/Earth science", domain: "science" },
  { page: "Physical sciences/Physics", domain: "science" },
  { page: "Biology and health sciences/Biology", domain: "science" },
  { page: "Biology and health sciences/Health", domain: "science" },
  { page: "Mathematics", domain: "science" },

  { page: "Technology", domain: "technology" },
  { page: "Technology/Agriculture", domain: "technology" },
  { page: "Technology/Computing and communication", domain: "technology" },
  { page: "Technology/Optical, navigation and astronomical", domain: "technology" },
  { page: "Technology/Transportation", domain: "technology" },
  { page: "Technology/Weapons", domain: "technology" },

  {
    page: "Society and social sciences/Politics and economics",
    domain: "economy",
    sections: ["Business and economics", "Companies"],
  },

  { page: "Arts/Audiovisual arts", domain: "culture" },
  // 架空の人物は作品でも出来事でもないので除く
  { page: "Arts/Narrative arts", domain: "culture", excludeSections: ["Fictional and legendary characters"] },
]);

/**
 * 年表形式の記事。1行（箇条書き1つ）を1項目として扱い、行頭の年と、行内のリンクを取る。
 * 行内のリンクには人名や地名が混ざるので、「人間（Q5）でも地理的な項目でもない最初のリンク」をその行の主題とみなす
 * （fetch-lists.mjs）。年表に書かれた年（listYear）は、Wikidata に年が無い項目の手入力の手がかりとして残す。
 *
 * 試したが入れなかった記事（2026-09-20 に wikitext を取得して確認）:
 * - Timeline of art … 行が芸術家の生没（"Birth of …" / "Death of …"）で、主題が人になる。
 * - Timeline of astronomy … 箇条書きではなく、この parser では 0 行。
 * - Timeline of chemistry … 年と本文が別の行に分かれた定義リスト形式で、1 行しか読めない。
 * - Timeline of international trade … 年が行頭に無い文章形式で、134 行中 11 行しか読めない。
 *   このため経済の出典は Vital articles だけになる。
 * @typedef {{ page: string, domain: Domain }} TimelinePage
 * @type {readonly TimelinePage[]}
 */
export const TIMELINE_PAGES = Object.freeze([
  { page: "Timeline of historic inventions", domain: "technology" },
  { page: "Timeline of scientific discoveries", domain: "science" },
  { page: "Timeline of mathematics", domain: "science" },
  { page: "Timeline of medicine and medical technology", domain: "science" },
  { page: "Timeline of architecture", domain: "culture" },
  { page: "Timeline of religion", domain: "culture" },
]);

/** 年表の1行から QID を引くリンクの数の上限（行頭から）。API の問い合わせ数を抑えるため。 */
export const TIMELINE_LINKS_PER_LINE = 3;

// 年として使う Wikidata のプロパティ（先頭が優先）。
// 依頼の指定は P571（成立）・P577（出版）・P585（時点）。P575（発見・発明の時点）と P580（開始）は
// 科学・技術の項目がよく使うので足した。指定の3つだけの場合との差は REPORT に出す。
export const LIST_TIME_PROPS = Object.freeze(["P585", "P575", "P571", "P577", "P580"]);
export const LIST_TIME_PROPS_SPEC = Object.freeze(["P571", "P577", "P585"]);

// 場所として使うプロパティ（先頭が優先）。P625 以外は、値の項目が持つ P625 を使う。
// 依頼の指定は P625・P276（場所）・P495（原産国）・P159（本部所在地）。
// P189（発見地）・P740（結成地）・P291（出版地）・P17（国）は足したもの。
// P495 と P17 は国なので、座標は国の代表点になる（REPORT で「国単位」として別に数える）。
export const LIST_PLACE_PROPS = Object.freeze(["P625", "P189", "P276", "P159", "P740", "P291", "P495", "P17"]);
export const LIST_PLACE_PROPS_SPEC = Object.freeze(["P625", "P276", "P495", "P159"]);
export const COUNTRY_LEVEL_PLACE_PROPS = Object.freeze(["P495", "P17"]);

// 年表の行の主題にしない項目の P31（人が編集する表）。QID は 2026-09-20 に wbgetentities で照合した。
// 地理的な項目を網羅はできないので、場所を表す項目の判定は「自分の P625 を持ち、年のプロパティを1つも持たない」も併用する。
export const NON_SUBJECT_CLASSES = Object.freeze([
  "Q5", // human
  "Q6256", // country
  "Q3624078", // sovereign state
  "Q3024240", // historical country
  "Q515", // city
  "Q5107", // continent
]);
