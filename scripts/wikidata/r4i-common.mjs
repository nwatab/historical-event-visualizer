// R4i のスクリプト（r4i-gaps.mjs・r4i-check.mjs）が共通で使う表。

/**
 * B の一覧の節から、年が無い行が前近代か近代かを分ける（人が見た目安。記事の最上位の節名、2026-09-23 に確認）。
 * 一覧全体が前近代のもの（中世イスラーム世界・先コロンブス期）と近代のもの（南アフリカ）は、節によらない。
 * @type {Readonly<Record<string, { premodern?: readonly string[], modern?: readonly string[], all?: "premodern" | "modern" }>>}
 */
export const B_SECTION_ERAS = Object.freeze({
  中国: { premodern: ["Four Great Inventions", "Prehistoric China", "Ancient and Imperial China"], modern: ["Modern (1912–present)"] },
  中世イスラーム世界: { all: "premodern" },
  インド: { premodern: ["Ancient India"], modern: ["Modern India"] },
  "アメリカ大陸（先コロンブス期）": { all: "premodern" },
  エジプト: { premodern: ["Ancient Egypt", "Graeco-Roman era", "Medieval Egypt"], modern: ["Modern Egypt"] },
  南アフリカ: { all: "modern" },
  インドネシア: {},
  フィリピン: { modern: ["Modern technologies"] },
});
