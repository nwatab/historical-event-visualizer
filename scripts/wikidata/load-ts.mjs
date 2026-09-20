// src/ の TypeScript のモジュールを、Node のスクリプトから import する。
//
// 手書きのサンプル（bce() を使って書かれている）や、マーカーの表示条件（timeline.ts / mapFilters.ts）を、
// スクリプト側に書き写さずにそのまま使うため。書き写すと、アプリとスクリプトで規則がずれる。
// typescript（devDependency）で JS に変換し、`@/…` と相対パスの import を、変換後のモジュール（data: URL）に差し替える。
// 型だけの import は変換で消える。npm パッケージの import には対応していない（実行時に使うものが出てきたらエラーになる）。
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const SRC_DIR = join(import.meta.dirname, "..", "..", "src");

/** @param {string} source */
const toJs = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  }).outputText;

/** @param {string} js */
const toDataUrl = (js) => `data:text/javascript;base64,${Buffer.from(js, "utf8").toString("base64")}`;

/** @param {string} file src/ 内の .ts ファイルの絶対パス @returns {Promise<string>} data: URL */
const moduleUrl = async (file) => {
  const js = toJs(await readFile(file, "utf8"));
  const specifiers = [...new Set([...js.matchAll(/from\s+"((?:@\/|\.)[^"]+)"/g)].map((m) => m[1]))];
  const urls = await Promise.all(
    specifiers.map(async (spec) => {
      const target = spec.startsWith("@/") ? join(SRC_DIR, spec.slice(2)) : resolve(dirname(file), spec);
      return /** @type {const} */ ([spec, await moduleUrl(`${target}.ts`)]);
    }),
  );
  return toDataUrl(urls.reduce((code, [spec, url]) => code.replaceAll(`"${spec}"`, JSON.stringify(url)), js));
};

/** @param {string} pathInSrc 例: "lib/timeline.ts" @returns {Promise<any>} */
export const importFromSrc = async (pathInSrc) => import(await moduleUrl(join(SRC_DIR, pathInSrc)));

/** 手書きのサンプル。 @returns {Promise<readonly any[]>} HistEvent の配列（src/types/event.ts） */
export const loadSampleEvents = async () => (await importFromSrc("data/events.sample.ts")).sampleEvents;
