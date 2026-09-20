// P31 の値 → 7分類。純粋関数のみ。写像表そのものは p31-domain-map.mjs にある。
import { DOMAIN_PRIORITY, P31_DOMAIN_MAP } from "./p31-domain-map.mjs";

/** @typedef {import("./p31-domain-map.mjs").Domain} Domain */

/** @type {ReadonlyMap<string, import("./p31-domain-map.mjs").MapEntry>} */
const ENTRY_BY_QID = new Map(P31_DOMAIN_MAP.map((e) => [e.qid, e]));

/**
 * 複数の P31 を持つ項目の扱い:
 * - 写像できた分類をすべて tags にする（CLAUDE.md: tags には主分類自身も含める）。
 * - 主分類は DOMAIN_PRIORITY の順で最初に当たったものにする。理由は p31-domain-map.mjs を参照。
 *   ただし総称的なクラス（weak）は、weak でない P31 が1つも当たらなかったときだけ主分類に使う。
 * - 7分類のどれかに当たる P31 が1つでもあれば採用する。"exclude" の P31 を併せ持っていても落とさない。
 *   実データでは「テロ攻撃 + 大量銃撃」「暗殺 + 殺人」「戦闘 + 沈没」のように、出来事の種類を表す P31 に
 *   手口や結果を表す P31 が併記されていることが多く、exclude を優先すると主要な項目が落ちるため。
 * - 当たった P31 が "exclude" だけなら excluded。exclude は「見た上で対象外と判断した」という印で、
 *   未判断（unmapped）と区別するためにある。
 * - どの P31 も表に無ければ unmapped。捨てずに数えて、レポートの「写像漏れ」に出す。
 *
 * @param {readonly string[]} p31
 * @returns {{ status: "mapped", domain: Domain, tags: readonly Domain[] }
 *   | { status: "excluded" } | { status: "unmapped" }}
 */
export const classify = (p31) => {
  const entries = p31.map((qid) => ENTRY_BY_QID.get(qid)).filter((e) => e !== undefined);
  const hits = entries.filter((e) => e.domain !== "exclude");
  if (hits.length === 0) return entries.length > 0 ? { status: "excluded" } : { status: "unmapped" };
  const strong = hits.filter((e) => !e.weak);
  const deciding = strong.length > 0 ? strong : hits;
  const domain = /** @type {Domain} */ (DOMAIN_PRIORITY.find((d) => deciding.some((e) => e.domain === d)));
  // tags は主分類を先頭に、残りを優先順で並べる
  const rest = DOMAIN_PRIORITY.filter((d) => d !== domain && hits.some((e) => e.domain === d));
  return { status: "mapped", domain, tags: [domain, ...rest] };
};

/** @param {string} qid */
export const isMappedClass = (qid) => ENTRY_BY_QID.has(qid);
