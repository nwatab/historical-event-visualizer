// 生成済みの public/data/events/ について、指定した年・ズームで地図に出るマーカーの数を数える。
// MIN_ZOOM_BY_IMPORTANCE（src/lib/timeline.ts）を決めるための確認用。
//
//   node scripts/wikidata/count-markers.mjs [年 …]      例: node scripts/wikidata/count-markers.mjs 1500 1800 1950
//
// 窓の判定・importance とズームの関係は、アプリのコード（timeline.ts / mapFilters.ts / eventData.ts）をそのまま使う。
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_DATA_DIR } from "./config.mjs";
import { importFromSrc } from "./load-ts.mjs";

const [{ eventMarkers, placelessEvents, EVENT_WINDOW_YEARS }, { importancesVisibleAt }, { filesForYear, mergeEventFiles }] =
  await Promise.all([importFromSrc("lib/timeline.ts"), importFromSrc("lib/mapFilters.ts"), importFromSrc("lib/eventData.ts")]);

/** 世界全体の初期表示のズーム（幅の広い画面 1.3、縦長の画面 -0.6）と、閾値の前後。 */
const ZOOMS = [-0.6, 1.3, 2, 4];
const years = process.argv.slice(2).map(Number).filter(Number.isFinite);
const manifest = JSON.parse(await readFile(join(APP_DATA_DIR, "manifest.json"), "utf8"));

const rows = await Promise.all(
  (years.length > 0 ? years : [1500, 1800, 1950]).map(async (year) => {
    const files = filesForYear(manifest.files, year, EVENT_WINDOW_YEARS);
    const chunks = await Promise.all(files.map(async (/** @type {{ file: string }} */ f) => JSON.parse(await readFile(join(APP_DATA_DIR, f.file), "utf8"))));
    const events = mergeEventFiles(chunks);
    const features = eventMarkers(events, year).features.filter((/** @type {any} */ f) => f.properties.placeKind !== "none");
    const counts = ZOOMS.map((zoom) => {
      const visible = importancesVisibleAt(zoom);
      const shown = features.filter((/** @type {any} */ f) => visible.includes(f.properties.importance));
      return `zoom ${zoom}: マーカー ${shown.length}（イベント ${new Set(shown.map((/** @type {any} */ f) => f.properties.id)).size}）`;
    });
    const placeless = placelessEvents(events, year, []);
    return `${year}年  読むファイル ${files.map((/** @type {{ file: string }} */ f) => f.file).join(", ")}（${events.length} 件）\n  ${counts.join("\n  ")}\n  場所を特定できない出来事: 窓内 ${placeless.total} 件 → 一覧に出す ${placeless.shown.length} 件`;
  }),
);
console.log(rows.join("\n"));
