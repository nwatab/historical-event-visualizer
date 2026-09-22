# Historical Event Visualizer

世界史のイベントを、時間とともに変化する世界地図の上に可視化するアプリです。

画面下部の年スライダー（紀元前3001年〜2025年）で年を動かすと、その年の出来事が地図上にマーカーで表示されます。キーボードの ← / → でも1年ずつ（Shift 併用で10年ずつ）動かせます。

- **一時点の出来事**（会戦、条約、発見など）は、前後20年の範囲で塗りつぶしの円として表示され、年が離れるほど小さくなります。
- **期間を持つ出来事**（戦争、帝国、飢饉など）は、開始年から終了年までのあいだ中抜きの輪として表示されます。
- **広がる出来事**（疫病や技術の伝播など）は、起点が二重の輪で表示され、年が進むにつれて到達した地点（小さい円）と、そこまでの経路の線が増えていきます。その年に到達した地点は、その年だけ大きく表示されます。終了年の後も20年間、経路全体が小さくなりながら残ります。詳細には到達点の一覧（年・地名）が出ます。
- マーカーは7分類で色分けされています。左上の凡例は、ホバーでその分類を強調し、クリック（タップ）で表示／非表示を切り替えます。
- マーカーをクリックすると、詳細（年または期間、説明、出典）が開きます。地図の何もない所をクリックすると閉じます。
- 重要度の高いイベントには、マーカーの横に名前のラベルが出ます。拡大すると、ラベルの付くイベントが増えます。
- 表示するマーカーは、重要度（importance 1〜3）とズームで絞っています。世界全体の表示では最も重要なものだけが出て、拡大すると増えます。古代のように出来事の少ない年は、重要度の低いものも最初から表示します（最も重要なマーカーが15に満たない年）。
- 起きた場所が国単位でしか分からない出来事（「フランス革命はフランスで起きた」など）は、その国の代表点に出ます。拡大すると国の代表点は場所として不正確になるので、zoom 4 以上では消えます。
- 1500年以降は、その年の**国境**が細い線で表示されます（[OpenHistoricalMap](https://www.openhistoricalmap.org/) のデータ。海岸線と海上の線は除いています）。線の上にカーソルを置くと、国の名前が出ます。凡例の「国境」で表示を切り替えられます。1500年より前は、データの穴が大きいため表示しません。国境の線は OpenHistoricalMap のデータをそのまま使っています。現代の係争地（クリミア、カシミール、台湾など）の線引きは OHM の編集者の判断によるもので、このアプリの見解ではありません。
- 場所を決められない出来事（概念など、原産国しか分からない項目や、場所が大陸・海洋しか無い項目）は、地図には出ませんが、年表には出ます。選ぶと、詳細に「地図上の位置は不明」と表示されます。年表では、こうした出来事を中抜きの点（期間なら破線の帯）で描き、ホバーの吹き出しに「（地図に位置なし）」と添えます。
- 年スライダーの上に年表があります。横軸は表示中の年を中心とした前後50年、縦軸は7分類のレーンで、一時点の出来事は点、期間を持つ出来事は帯です。ホイールで前後10年〜500年に変えられ（広げるほど重要度の高いものに絞られます）、ドラッグで年が動きます。項目の多い分類は、点と帯の代わりに年ごとの件数のヒストグラムになります。項目をクリックすると詳細が開きます。スマートフォンでは「開く」で表示し、2本指のピンチで前後の年数を変えられます。
- 年表の左の再生ボタン（またはスペースキー）で、年が自動で進みます。速度は 5 / 20 / 100 年/秒で、ボタンの下で切り替えます。年スライダーや年表を動かすと止まります。
- 年スライダーのトラックの下には、100年ごとの時間軸の目盛りがあります（紀元元年だけ太い線）。

データは約 19,800 件です（2026-09-21 生成。正確な件数と内訳は `public/data/events/manifest.json`）。Wikidata と英語版 Wikipedia の Vital articles から取得した項目に、手書きのサンプル35件と、人が書いた広がる出来事4件を統合しています。年代ごとのファイルに分けてあり、表示中の年の前後だけを読み込みます。分類は「戦争・紛争」が約7割を占め、地域はヨーロッパと北アメリカに偏っています（偏りの分析は `scripts/wikidata/FINDINGS-R4a.md`・`FINDINGS-R4b1.md`）。疫病の伝播のように地理的に広がる出来事は、Wikidata に経路のデータが無いため、出典（Wikipedia の記事）を確認しながら人が書いています（`data/diffusion/`）。現在は、黒死病、ユスティニアヌスのペスト、活版印刷の発明と伝播、初期イスラームの征服の 4 件です。スペインかぜと COVID-19 は、年の分解能が 1 年だと数か月の伝播を描けないため、見送っています。

分類・スキーマ・年の扱い・データの生成手順などの規約は [CLAUDE.md](CLAUDE.md) にまとめています。

公開 URL: https://nwatab.github.io/historical-event-visualizer/

## 技術構成

- [Next.js](https://nextjs.org/)（App Router、`output: 'export'` による静的エクスポート）
- [MapLibre GL JS](https://maplibre.org/)（外部タイルサーバーは使わず、同梱の GeoJSON だけで描画）
- Tailwind CSS v4
- パッケージマネージャ: pnpm
- デプロイ: GitHub Actions → GitHub Pages（`.github/workflows/deploy.yml`、`main` への push で実行）

GitHub Pages のプロジェクトページ配信に合わせて、`basePath` を `/historical-event-visualizer` にしています。
この値は `src/lib/config.ts` の `BASE_PATH` で一元管理しています。`public/` 配下のファイルを参照するときは `publicPath()` を使ってください。

## ローカル開発

Node.js 22 以上と pnpm が必要です。

```bash
pnpm install
pnpm dev
```

http://localhost:3000/historical-event-visualizer を開きます（basePath があるため、ルート `/` では表示されません）。

静的ビルドを確認するには:

```bash
pnpm build
```

`out/` に静的ファイルが生成されます。basePath 付きで配信するため、`out/` を `historical-event-visualizer/` というパスでマウントして配信してください。例:

```bash
mkdir -p /tmp/site && ln -sfn "$PWD/out" /tmp/site/historical-event-visualizer && python3 -m http.server 4173 -d /tmp/site
```

http://localhost:4173/historical-event-visualizer/ を開きます。

### MapLibre のワーカーファイル

MapLibre GL JS v6 は、ワーカーを別ファイル（`maplibre-gl-worker.mjs` と `maplibre-gl-shared.mjs`）として読み込みます。
バンドル後はその相対パスが解決できなくなるため、`pnpm dev` / `pnpm build` の実行前に `scripts/copy-maplibre-worker.mjs` がインストール済みパッケージから `public/maplibre/` へコピーし、`setWorkerUrl()` でその場所を指定しています。
`public/maplibre/` は生成物なので git 管理外です。

## データ出典

### イベントデータ — `public/data/events/`

`scripts/wikidata/` のスクリプトで取得・生成し、生成した JSON をリポジトリに含めています（手順と規則は [CLAUDE.md](CLAUDE.md) の「データパイプライン」）。生成日時、取得データの日時、使った Vital articles の版番号は `public/data/events/manifest.json` に記録しています。

- **[Wikidata](https://www.wikidata.org/)** — 項目の QID、ラベル、年、座標、分類（P31）、sitelinks 数。ライセンス: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)（[Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)）。[Wikidata Query Service](https://query.wikidata.org/) の SPARQL エンドポイントから取得。
- **[英語版 Wikipedia の Vital articles（Level 5）](https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level_5)** — 科学・技術・経済・文化の項目の選抜と、その分類（リストの節）に使用。ライセンス: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。使ったページは `scripts/wikidata/lists.mjs`、取得した版は manifest.json にあります。
- **[OpenHistoricalMap](https://www.openhistoricalmap.org/)** — 1500 年以降の国境の線（`public/data/borders/`）。© OpenHistoricalMap contributors（[CC0](https://creativecommons.org/publicdomain/zero/1.0/) / [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。[Copyright and Acknowledgements](https://www.openhistoricalmap.org/copyright)）。一部の国境線は [HDX](https://data.humdata.org/)（CC BY-IGO）および National Library of Scotland（CC BY）に由来します。海岸線と海上の線は使っていません（海岸線は下の Natural Earth）。取得と生成は `scripts/ohm/`、取得日と license 別の線の本数は `public/data/borders/manifest.json`、license の判断の根拠は `scripts/ohm/licenses.mjs` にあります。
- 各イベントの `source` は、日本語版 Wikipedia の記事（無ければ英語版、それも無ければ Wikidata の項目）への URL です。記事の本文は取得・転載していません。詳細パネルでは、Wikipedia へのリンクに CC BY-SA 4.0 の表記を添えています。
- **手書きのサンプル — `src/data/events.sample.ts`**（35件）。各イベントの `source` に参照した Wikipedia の URL を付けています（年や期間はその記事で確認しています）。`id` は Wikidata の QID です（該当する項目が無いものは slug）。生成時に統合し、QID が同じ項目は手書きを優先します。

### 陸地形状 — `public/geo/ne_110m_land.geojson`

- 出典: [Natural Earth](https://www.naturalearthdata.com/) 1:110m Physical Vectors — Land
- 取得元: [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector) の `geojson/ne_110m_land.geojson`（2026-09-19 に `master` ブランチ `ca96624` から取得。このファイルを最後に変更したコミットは `693f114`（2020-12-13））
- SHA-256: `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`
- ライセンス: パブリックドメイン（[Natural Earth Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/)）

ビルド時にはダウンロードせず、ファイルとしてリポジトリに含めています。
