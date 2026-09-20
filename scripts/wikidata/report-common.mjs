// レポートの各節が共通で使う定数と小さな純粋関数。
import { APP_YEAR_MAX } from "./config.mjs";
import { ERAS, eraOfYear } from "./importance.mjs";
import { REGIONS, REGION_LABELS } from "./regions.mjs";

/** @typedef {import("./regions.mjs").Region} Region */

// src/lib/domain.ts の DOMAINS / DOMAIN_LABELS と同じ並び・名称（.mjs から import できないため転記）。
export const DOMAINS = /** @type {const} */ (["conflict", "polity", "science", "technology", "economy", "culture", "population"]);
export const DOMAIN_LABELS = Object.freeze({
  conflict: "紛争",
  polity: "政体変動",
  science: "科学",
  technology: "技術",
  economy: "経済・交易",
  culture: "思想・宗教・文化",
  population: "人口・環境",
});

/** 天文年 → 表示。src/lib/year.ts の formatYear と同じ規則。 @param {number} y */
export const formatYear = (y) => (y <= 0 ? `前${1 - y}` : String(y));

/** "multi" は、座標が複数あって過半数を占める地域が無い項目（analyze.mjs の regionOfPlaces）。 @typedef {Region | "multi" | null} RegionKey */

/** @param {RegionKey} r */
export const regionLabel = (r) => (r === "multi" ? "複数地域にまたがる" : r ? REGION_LABELS[r] : "判定不能（外洋・極地）");
export const REGION_KEYS = /** @type {readonly RegionKey[]} */ ([...REGIONS, "multi", null]);

export const ERA_STEP = 500;
/**
 * 500年刻みの区間の番号。紀元前は「紀元前 N 年」の N で区切る（前500〜前1 が -1、前1000〜前501 が -2）。
 * 紀元後は 1〜500 が 1、501〜1000 が 2。天文年のまま floor すると「前501〜前2」のような半端な境界になるため。
 * @param {number} year 天文年
 */
export const eraOf = (year) => (year <= 0 ? -Math.ceil((1 - year) / ERA_STEP) : Math.ceil(year / ERA_STEP));
/** @param {number} era */
export const eraLabel = (era) =>
  era < 0
    ? `前${-era * ERA_STEP}〜前${(-era - 1) * ERA_STEP + 1}`
    : `${(era - 1) * ERA_STEP + 1}〜${Math.min(era * ERA_STEP, APP_YEAR_MAX)}`;

// 年代の5区分は importance の試算と同じもの（importance.mjs）を使う
export const coarseEra = eraOfYear;
export const COARSE_ERAS = ERAS;

/** 開始年（母集団の項目は必ず持つ）。 @param {{ start: { year: number } | null }} i */
export const yearOf = (i) => /** @type {{ year: number }} */ (i.start).year;
