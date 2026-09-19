/**
 * GitHub Pages のプロジェクトページ (https://<user>.github.io/<repo>/) で配信するためのパス接頭辞。
 * next.config.ts の basePath / assetPrefix と、静的ファイルを fetch する際の URL 組み立ての両方がこれを参照する。
 */
export const BASE_PATH = "/historical-event-visualizer";

/** public/ 配下のファイルパス（先頭スラッシュ付き）を配信 URL に変換する。 */
export const publicPath = (path: `/${string}`): string => `${BASE_PATH}${path}`;
