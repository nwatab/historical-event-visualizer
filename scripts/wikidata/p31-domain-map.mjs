// Wikidata の P31（分類）の値 → 7分類の写像表（人が編集する表）。
//
// - 分類の定義と境界は CLAUDE.md「分類（Domain）」に従う。
// - 見るのは各項目の「直接の P31」だけ。P279（上位クラス）は辿らない。
//   Wikidata のクラス階層は予想外のつながり方をするので、表に書いた QID だけが効くようにして、
//   人が結果を追えるようにするため。その代わり、表に無い P31 は REPORT.md の「写像漏れ」に
//   出現回数順で出るので、そこから足していく。
// - domain: "exclude" は「取得はされるが、世界史の出来事として扱わない」と判断した種類。
//   7分類に当たる P31 を併せ持つ項目は落とさない（classify.mjs を参照）。
// - label は人が読むためのメモ（照合には使わない）。QID とラベルの対応は、
//   data/raw/wikidata/class-labels.json（SPARQL で取得）または wbgetentities の出力で確認して書く。
//
// 7分類の値は src/types/event.ts の Domain と同じ（scripts/ は .mjs なので型を import できず、転記している）。

/** @typedef {"conflict" | "polity" | "science" | "technology" | "economy" | "culture" | "population"} Domain */

/**
 * 複数の分類に当たったときに主分類を選ぶ順（先頭が優先）。
 *
 * 理由:
 * 1. CLAUDE.md の境界の規則と合わせる。「武力による政権交代でも主眼が体制の変化なら polity」
 *    → polity を conflict より前に。「宗教建築は主眼が信仰・芸術なら culture（tags に technology）」
 *    → culture を technology より前に。
 * 2. 数が多く一般的な種類（battle, war）は後ろ、数が少なく具体的な種類を前に置く。
 *    Wikidata では「戦争」かつ「革命」、「虐殺」かつ「飢饉」のように、一般的な P31 に
 *    具体的な P31 が足されていることが多く、具体的なほうがその項目の語られ方に近い。
 * 3. 取得データに依存しない固定の順にする（件数から動的に決めると、再取得のたびに主分類が動く）。
 * どの順にしても、当たった分類はすべて tags に残るので、情報は失われない。
 * 実際に複数分類に当たった件数は REPORT.md に出す。
 *
 * @type {readonly Domain[]}
 */
export const DOMAIN_PRIORITY = Object.freeze([
  "science",
  "economy",
  "population",
  "culture",
  "technology",
  "polity",
  "conflict",
]);

/**
 * weak: true は総称的なクラス（disaster, attack）。tags には入るが、主分類を決めるときは、
 * weak でない P31 が1つでも当たっていればそちらだけで決める。
 * 例: 「テロ攻撃 + disaster」の項目が、優先順のせいで population にならないようにする。
 * @typedef {{ qid: string, label: string, domain: Domain | "exclude", weak?: true, note?: string }} MapEntry
 */

/** @type {readonly MapEntry[]} */
export const P31_DOMAIN_MAP = Object.freeze([
  // ── conflict（紛争）: 組織的な武力衝突そのもの
  { qid: "Q178561", label: "battle", domain: "conflict" },
  { qid: "Q198", label: "war", domain: "conflict" },
  { qid: "Q103495", label: "world war", domain: "conflict", note: "第一次・第二次世界大戦の P31 はこれと historical period だけ（R4e）" },
  {
    qid: "Q1006311",
    label: "war of national liberation",
    domain: "conflict",
    note: "アメリカ独立戦争の P31 はこれだけ。ラベルは 2026-09-20 に wbgetentities で照合（ja: 民族解放戦争。R4e）",
  },
  { qid: "Q188055", label: "siege", domain: "conflict" },
  { qid: "Q124734", label: "rebellion", domain: "conflict" },
  { qid: "Q8465", label: "civil war", domain: "conflict" },
  { qid: "Q3199915", label: "massacre", domain: "conflict" },
  { qid: "Q645883", label: "military operation", domain: "conflict" },
  { qid: "Q831663", label: "military campaign", domain: "conflict" },
  { qid: "Q350604", label: "armed conflict", domain: "conflict" },
  { qid: "Q124757", label: "riot", domain: "conflict" },
  { qid: "Q511866", label: "mutiny", domain: "conflict" },
  { qid: "Q177716", label: "pogrom", domain: "conflict" },
  { qid: "Q41397", label: "genocide", domain: "conflict", note: "CLAUDE.md: 虐殺は conflict" },

  // ── polity（政体変動）
  { qid: "Q10931", label: "revolution", domain: "polity" },
  { qid: "Q45382", label: "coup d'état", domain: "polity" },
  { qid: "Q131569", label: "treaty", domain: "polity" },
  { qid: "Q625298", label: "peace treaty", domain: "polity", note: "CLAUDE.md: 講和条約は polity" },
  { qid: "Q1464916", label: "declaration of independence", domain: "polity" },
  { qid: "Q194465", label: "annexation", domain: "polity" },
  { qid: "Q209715", label: "coronation", domain: "polity" },
  { qid: "Q3024240", label: "historical country", domain: "polity", note: "建国〜滅亡を period として扱う" },

  // ── science（科学）
  { qid: "Q2401485", label: "expedition", domain: "science" },
  { qid: "Q366301", label: "research expedition", domain: "science" },
  { qid: "Q56458151", label: "meteorite fall", domain: "science" },
  { qid: "Q463796", label: "impact event", domain: "science" },

  // ── technology（技術）
  { qid: "Q210112", label: "nuclear weapons testing", domain: "technology" },
  { qid: "Q2656967", label: "nuclear explosion", domain: "technology" },
  { qid: "Q1620824", label: "nuclear accident", domain: "technology" },
  { qid: "Q797476", label: "rocket launch", domain: "technology" },
  { qid: "Q7572593", label: "space launch", domain: "technology" },
  { qid: "Q172754", label: "world's fair", domain: "technology", note: "技術の展示が主眼。tags で economy/culture を足す余地あり" },

  // ── economy（経済・交易）
  { qid: "Q290178", label: "economic crisis", domain: "economy" },
  { qid: "Q114380", label: "financial crisis", domain: "economy" },
  { qid: "Q1020018", label: "stock market crash", domain: "economy" },
  { qid: "Q806663", label: "bank run", domain: "economy" },
  { qid: "Q185565", label: "hyperinflation", domain: "economy" },
  { qid: "Q273182", label: "gold rush", domain: "economy" },
  { qid: "Q49776", label: "strike", domain: "economy" },

  // ── culture（思想・宗教・文化）
  { qid: "Q5389", label: "Olympic Games", domain: "culture" },
  { qid: "Q51645", label: "ecumenical council", domain: "culture" },
  { qid: "Q111161", label: "synod", domain: "culture" },

  // ── population（人口・環境）
  { qid: "Q7944", label: "earthquake", domain: "population" },
  { qid: "Q7692360", label: "volcanic eruption", domain: "population" },
  { qid: "Q8070", label: "tsunami", domain: "population" },
  { qid: "Q8068", label: "flood", domain: "population" },
  { qid: "Q8092", label: "tropical cyclone", domain: "population" },
  { qid: "Q43059", label: "drought", domain: "population" },
  { qid: "Q169950", label: "wildfire", domain: "population" },
  { qid: "Q168983", label: "conflagration", domain: "population" },
  { qid: "Q8065", label: "natural disaster", domain: "population" },
  { qid: "Q44512", label: "epidemic", domain: "population" },
  { qid: "Q12184", label: "pandemic", domain: "population" },
  { qid: "Q1516910", label: "plague epidemic", domain: "population" },
  { qid: "Q168247", label: "famine", domain: "population" },
  { qid: "Q177626", label: "human migration", domain: "population" },
  { qid: "Q6784066", label: "mass migration", domain: "population" },
  { qid: "Q15589476", label: "population transfer", domain: "population" },
  { qid: "Q837556", label: "forced displacement", domain: "population" },
  { qid: "Q379693", label: "deportation", domain: "population" },
  { qid: "Q154278", label: "ethnic cleansing", domain: "population" },
  { qid: "Q815962", label: "colonization", domain: "population" },

  // ── ここから下は、2026-09-20 の取得結果に実際に現れた P31 を出現回数の多い順に見て足したもの。
  // label は data/raw/wikidata/class-labels.json（SPARQL で取得した英語ラベル）から機械的に転記した。
  // conflict — 戦闘の種類
  { qid: "Q1261499", label: "naval battle", domain: "conflict" },
  { qid: "Q997267", label: "skirmish", domain: "conflict" },
  { qid: "Q48767773", label: "engagement", domain: "conflict" },
  { qid: "Q680838", label: "ambush", domain: "conflict" },
  { qid: "Q3817498", label: "last stand", domain: "conflict" },
  { qid: "Q104708121", label: "storming", domain: "conflict" },
  { qid: "Q646740", label: "landing operation", domain: "conflict" },
  { qid: "Q2001676", label: "offensive", domain: "conflict" },
  { qid: "Q476807", label: "military raid", domain: "conflict" },
  { qid: "Q467011", label: "invasion", domain: "conflict" },
  { qid: "Q1384277", label: "military expedition", domain: "conflict" },
  { qid: "Q582956", label: "punitive expedition", domain: "conflict" },
  { qid: "Q1361229", label: "conquest", domain: "conflict" },
  { qid: "Q19841484", label: "sack", domain: "conflict" },
  { qid: "Q6130595", label: "razzia", domain: "conflict" },
  { qid: "Q188686", label: "military occupation", domain: "conflict", note: "占領は武力行使の一部として conflict" },
  { qid: "Q42750320", label: "border incident", domain: "conflict" },
  { qid: "Q1174599", label: "attack", domain: "conflict", weak: true },
  // conflict — 砲爆撃
  { qid: "Q2380335", label: "airstrike", domain: "conflict" },
  { qid: "Q678146", label: "bombardment", domain: "conflict" },
  { qid: "Q4688003", label: "aerial bombing of a city", domain: "conflict" },
  { qid: "Q27653727", label: "naval bombing of a city", domain: "conflict" },
  { qid: "Q111034471", label: "missile strike", domain: "conflict" },
  { qid: "Q30588142", label: "drone warfare", domain: "conflict" },
  // conflict — 反乱・暴動
  { qid: "Q6107280", label: "revolt", domain: "conflict" },
  { qid: "Q1323212", label: "insurgency", domain: "conflict" },
  { qid: "Q1155622", label: "slave rebellion", domain: "conflict" },
  { qid: "Q13427116", label: "peasant revolt", domain: "conflict" },
  { qid: "Q3588250", label: "ethnic riot", domain: "conflict" },
  // conflict — 戦争犯罪
  { qid: "Q135010", label: "war crime", domain: "conflict" },
  // conflict — テロ（組織的・政治的な暴力として conflict に入れる。個人の犯罪は exclude）
  { qid: "Q2223653", label: "terrorist attack", domain: "conflict" },
  { qid: "Q891854", label: "bomb attack", domain: "conflict" },
  { qid: "Q217327", label: "suicide attack", domain: "conflict" },
  { qid: "Q18493502", label: "suicide bombing", domain: "conflict" },
  { qid: "Q20893947", label: "suicide car bombing", domain: "conflict" },
  { qid: "Q25917154", label: "truck bombing", domain: "conflict" },
  { qid: "Q61037469", label: "bus bombing", domain: "conflict" },
  { qid: "Q109217482", label: "shooting attack", domain: "conflict" },
  { qid: "Q6813020", label: "stabbing attack", domain: "conflict" },
  { qid: "Q18711682", label: "vehicle-ramming attack", domain: "conflict" },
  { qid: "Q28934204", label: "train attack", domain: "conflict" },
  { qid: "Q897797", label: "arson attack", domain: "conflict" },
  { qid: "Q134693479", label: "attack on church", domain: "conflict" },
  { qid: "Q898712", label: "aircraft hijacking", domain: "conflict" },
  { qid: "Q1371150", label: "hostage taking", domain: "conflict" },
  // polity — 追加分
  { qid: "Q25906438", label: "attempted coup d'état", domain: "polity" },
  { qid: "Q1691434", label: "United Nations treaty", domain: "polity" },
  { qid: "Q39087739", label: "coronation of the Thai monarch", domain: "polity" },
  { qid: "Q3882219", label: "assassination", domain: "polity", note: "歴史の授業では政治の文脈で語られる" },
  { qid: "Q1139665", label: "political murder", domain: "polity" },
  { qid: "Q88178910", label: "assassination attempt", domain: "polity" },
  { qid: "Q175331", label: "demonstration", domain: "polity", note: "政治的な要求の表明" },
  { qid: "Q273120", label: "protest", domain: "polity", note: "政治的な要求の表明" },
  // technology — 核実験の下位分類
  { qid: "Q3058675", label: "underground nuclear weapons test", domain: "technology" },
  { qid: "Q4367188", label: "underwater nuclear explosion", domain: "technology" },
  { qid: "Q98607365", label: "atmospheric nuclear test", domain: "technology" },
  { qid: "Q98391050", label: "nuclear test series", domain: "technology" },
  // culture — 追加分
  { qid: "Q10551516", label: "church council", domain: "culture" },
  // population — 追加分
  { qid: "Q3839081", label: "disaster", domain: "population", weak: true, note: "自然災害と人為的な災害が混ざる総称。生活環境を変えた出来事として population に寄せた" },
  { qid: "Q167903", label: "landslide", domain: "population" },
  { qid: "Q8081", label: "tornado", domain: "population" },
  { qid: "Q7935", label: "avalanche", domain: "population" },
  { qid: "Q838718", label: "city fire", domain: "population" },
  { qid: "Q5300157", label: "doublet earthquake", domain: "population" },
  { qid: "Q3193890", label: "environmental disaster", domain: "population" },
  { qid: "Q220187", label: "oil spill", domain: "population" },
  { qid: "Q1033074", label: "dam failure", domain: "population" },
  { qid: "Q54643580", label: "tailings dam failure", domain: "population" },
  // exclude — 日食（1万件以上ある。座標は「食が最大になる地点」で、人間の出来事ではない）
  { qid: "Q3887", label: "solar eclipse", domain: "exclude", note: "ルートとしては取得するが対象外" },
  { qid: "Q5681048", label: "partial solar eclipse", domain: "exclude" },
  { qid: "Q5691927", label: "annular solar eclipse", domain: "exclude" },
  { qid: "Q11086064", label: "total solar eclipse", domain: "exclude" },
  { qid: "Q28339417", label: "hybrid solar eclipse", domain: "exclude" },
  // exclude — 個人の犯罪
  { qid: "Q132821", label: "murder", domain: "exclude" },
  { qid: "Q21480300", label: "mass shooting", domain: "exclude" },
  { qid: "Q750215", label: "mass murder", domain: "exclude" },
  { qid: "Q81672", label: "attempted murder", domain: "exclude" },
  { qid: "Q473853", label: "school shooting", domain: "exclude" },
  { qid: "Q327541", label: "arson", domain: "exclude" },
  { qid: "Q318296", label: "kidnapping", domain: "exclude" },
  { qid: "Q459409", label: "hate crime", domain: "exclude" },
  { qid: "Q4676786", label: "deliberate murder", domain: "exclude" },
  { qid: "Q3307578", label: "murder–suicide", domain: "exclude" },
  { qid: "Q149086", label: "homicide", domain: "exclude" },
  { qid: "Q53706", label: "robbery", domain: "exclude" },
  { qid: "Q486775", label: "lynching", domain: "exclude" },
  { qid: "Q16738832", label: "criminal case", domain: "exclude" },
  { qid: "Q136281265", label: "university shooting", domain: "exclude" },
  { qid: "Q11547135", label: "homicide in Penal code of Japan", domain: "exclude" },
  { qid: "Q464643", label: "stabbing", domain: "exclude" },
  { qid: "Q2252077", label: "shooting", domain: "exclude" },
  { qid: "Q2406205", label: "shootout", domain: "exclude" },
  { qid: "Q806824", label: "bank robbery", domain: "exclude" },
  { qid: "Q11487748", label: "robbery-murder", domain: "exclude" },
  { qid: "Q365680", label: "assault", domain: "exclude" },
  { qid: "Q21175615", label: "school massacre", domain: "exclude" },
  { qid: "Q64149164", label: "mass stabbing", domain: "exclude" },
  { qid: "Q5300066", label: "double murder", domain: "exclude" },
  { qid: "Q47092", label: "rape", domain: "exclude" },
  { qid: "Q11519624", label: "unsolved crime", domain: "exclude" },
  { qid: "Q61039291", label: "knife attack", domain: "exclude" },
  { qid: "Q2920604", label: "prison riot", domain: "exclude" },
  { qid: "Q97368680", label: "police raid", domain: "exclude" },
  // exclude — 個別の事故
  { qid: "Q1550225", label: "mining accident", domain: "exclude" },
  { qid: "Q7625093", label: "structure fire", domain: "exclude" },
  { qid: "Q906512", label: "shipwrecking", domain: "exclude" },
  { qid: "Q179057", label: "explosion", domain: "exclude" },
  { qid: "Q1362483", label: "gas explosion", domain: "exclude" },
  { qid: "Q68800046", label: "industrial disaster", domain: "exclude" },
  { qid: "Q2165983", label: "stampede", domain: "exclude" },
  { qid: "Q2620513", label: "maritime disaster", domain: "exclude" },
  { qid: "Q744913", label: "aviation accident", domain: "exclude" },
  { qid: "Q171558", label: "accident", domain: "exclude" },
  { qid: "Q1078765", label: "railway accident", domain: "exclude" },
  { qid: "Q11396401", label: "train fire", domain: "exclude" },
  { qid: "Q30880545", label: "sinking", domain: "exclude" },
  { qid: "Q17094485", label: "industrial fire", domain: "exclude" },
  { qid: "Q1309431", label: "structural failure", domain: "exclude" },
  { qid: "Q42643444", label: "stadium disaster", domain: "exclude" },
  { qid: "Q2192508", label: "ship collision", domain: "exclude" },
  { qid: "Q106673346", label: "crowd crush", domain: "exclude" },
  { qid: "Q1331380", label: "derailment", domain: "exclude" },
  { qid: "Q109905701", label: "crowd collapses and crushes", domain: "exclude" },
  { qid: "Q11620651", label: "bridge failure", domain: "exclude" },
  { qid: "Q23007305", label: "mine explosion", domain: "exclude" },
  { qid: "Q1303061", label: "friendly fire", domain: "exclude" },
  // exclude — 出来事の種類ではないもの
  { qid: "Q12890393", label: "incident", domain: "exclude" },
  { qid: "Q17633526", label: "Wikinews article", domain: "exclude" },
  { qid: "Q64728935", label: "future event", domain: "exclude" },
  { qid: "Q4", label: "death", domain: "exclude" },

  // ── 2巡目: 1巡目の写像表で作った REPORT.md の「写像漏れ 上位50」から足したもの（2026-09-20）。
  { qid: "Q273976", label: "blockade", domain: "conflict" },
  { qid: "Q1348385", label: "war of succession", domain: "conflict" },
  { qid: "Q104212151", label: "series of wars", domain: "conflict" },
  { qid: "Q830494", label: "dogfight", domain: "conflict" },
  { qid: "Q25917186", label: "coordinated terrorist attack", domain: "conflict" },
  { qid: "Q6857862", label: "military strike", domain: "conflict" },
  { qid: "Q1546073", label: "covert operation", domain: "conflict" },
  { qid: "Q23036198", label: "hostage-rescue mission", domain: "conflict" },
  { qid: "Q7539194", label: "slave raid", domain: "conflict" },
  { qid: "Q56514238", label: "mass killing", domain: "conflict" },
  { qid: "Q6983405", label: "Nazi crime", domain: "conflict" },
  { qid: "Q117247713", label: "attack on mosque", domain: "conflict" },
  { qid: "Q96400402", label: "pub bombing", domain: "conflict" },
  { qid: "Q107706", label: "armistice", domain: "polity" },
  { qid: "Q217901", label: "capitulation", domain: "polity" },
  { qid: "Q6934728", label: "multilateral treaty", domain: "polity" },
  { qid: "Q3780403", label: "high-altitude nuclear explosion", domain: "technology" },
  { qid: "Q747501", label: "Plinian eruption", domain: "population" },
  { qid: "Q121742", label: "storm surge", domain: "population" },
  { qid: "Q114041309", label: "earthquake sequence", domain: "population" },
  { qid: "Q2924824", label: "rockslide", domain: "population" },
  { qid: "Q175768", label: "mudflow", domain: "population" },
  { qid: "Q107434304", label: "forest fire", domain: "population" },
  { qid: "Q2635501", label: "Kamchatka earthquake", domain: "population" },
  { qid: "Q11505155", label: "Hyūga-nada earthquake", domain: "population" },
  { qid: "Q7446977", label: "off Sanriku earthquake", domain: "population" },
  { qid: "Q121832207", label: "off Miyagi earthquake", domain: "population" },
  { qid: "Q3510594", label: "earthquake in Japan", domain: "population" },
]);
