# place-overrides の下書き（人の確認待ち）

`pnpm wikidata:place-overrides-review` が `place-overrides.json` の `status: "draft"` の項目から作り直す（2026-09-22 生成）。手で編集しない。直すのは JSON のほう。

- 確認が済んだ項目は、JSON の `status` を消す（`"draft"` のままだと `pnpm wikidata:build-app-data` は使わない。`--with-drafts` を付けると使う。その出力はコミットしない）。
- **地点と出典の出所**: 「出典」の列の Wikipedia の記事（と節）の本文を、調査用のサブエージェントが API で取得して読んだもの。「要旨」は該当箇所の要約で、引用ではない。
  要旨の中の `ファイル名:行番号` は、調査時に保存した本文（セッションの作業用ディレクトリ。リポジトリには無い）の位置。人が出典の記事で確認する前提の下書き。
- **QID と座標の出所**: QID はサブエージェントが wbsearchentities / wbgetentities で照合したもの。「Wikidata」のラベルと座標は、その QID から `pnpm wikidata:fetch-app-extras` が取得した値（P625）で、報告とは独立に取り直している。
- 案の内訳: point 0 件、none 0 件、origin 0 件（合計 0 件）

| # | QID | 項目 | 年 | 分類 | imp | sitelinks | 今の場所 | 案 | 地点（先頭がラベルの付く点） | 出典・要旨 | 理由 | 要確認 |
|---:|---|---|---:|---|---:|---:|---|---|---|---|---|---|
