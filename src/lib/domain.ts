import type { Domain } from "@/types/event";

/** 凡例などで使う表示順。定義は CLAUDE.md の「分類（Domain）」を参照。 */
export const DOMAINS: readonly Domain[] = [
  "conflict",
  "polity",
  "science",
  "technology",
  "economy",
  "culture",
  "population",
];

export const DOMAIN_LABELS: Readonly<Record<Domain, string>> = {
  conflict: "戦争・紛争",
  polity: "政体変動",
  science: "科学",
  technology: "技術",
  economy: "経済・交易",
  culture: "思想・宗教・文化",
  population: "人口・環境",
};
