// MapLibre GL JS v6 はワーカーを別ファイル (maplibre-gl-worker.mjs → maplibre-gl-shared.mjs) として
// 自身のモジュール URL 基準で読み込むが、バンドル後はその相対パスが失われる。
// そこでインストール済みパッケージから public/maplibre/ にコピーし、setWorkerUrl で明示指定する。
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const outDir = join(import.meta.dirname, "..", "public", "maplibre");
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

await mkdir(outDir, { recursive: true });
await Promise.all(files.map((f) => copyFile(join(distDir, f), join(outDir, f))));
console.log(`Copied ${files.join(", ")} to ${outDir}`);
