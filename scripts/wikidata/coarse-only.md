# 場所が大陸・海洋だけの項目

`pnpm wikidata:build-app-data` が作り直す（2026-09-21 生成）。手で編集しない。

Wikidata の場所（戦争の P276 など）が大陸・海洋（粒度 coarse。`place-granularity.mjs`）しか無く、`placeKind: "none"` で地図に出ていない項目。
`place-overrides.json` で人が場所を決めた項目は、ここから消える。P495 / P17 だけで none の項目は含まない（`pnpm wikidata:place-overrides-draft` のほう）。

44 件。sitelinks の多い順。

| sitelinks | 項目 | QID | 開始 | 終了 | 分類 | importance | 種別 | Wikidata の場所 |
|---:|---|---|---:|---:|---|---:|---|---|
| 68 | ロマネスク | Q46805 | 1000 |  | culture | 2 | other | ヨーロッパ |
| 55 | ルネサンス音楽 | Q201405 | 1400 |  | culture | 2 | other | ヨーロッパ |
| 53 | 大西洋の戦い | Q157627 | 1939 |  | conflict | 3 | other | 大西洋 |
| 53 | アッシリア人大虐殺 | Q852236 | 1914 |  | conflict | 3 | other | 西アジア |
| 47 | バウンティ号の反乱 | Q749811 | 1789 |  | conflict | 3 | war | 太平洋 |
| 47 | インディアン戦争 | Q849680 | 1609 | 1924 | conflict | 3 | war | 北アメリカ |
| 45 | イスパノアメリカ独立戦争 | Q1123201 | 1808 | 1833 | conflict | 3 | war | イスパノアメリカ |
| 44 | モンゴルの侵攻と征服 | Q2092093 | 1206 | 1337 | conflict | 2 | war | ユーラシア |
| 40 | ロシア・ポーランド戦争 | Q631991 | 1654 | 1667 | conflict | 3 | war | ヨーロッパ |
| 39 | ローマ内戦 (192年-197年) | Q243721 | 193 |  | conflict | 2 | war | ヨーロッパ |
| 36 | ムスリムのシリア征服 | Q248984 | 633 | 640 | conflict | 2 | war | 近東 |
| 36 | 英西戦争 | Q430726 | 1585 | 1604 | conflict | 3 | war | 大西洋 |
| 35 | バナナ戦争 | Q768496 | 1898 | 1934 | conflict | 3 | war | 中央アメリカ |
| 32 | 対仏大同盟 | Q15053704 | 1792 | 1815 | conflict | 3 | war | ヨーロッパ |
| 32 | 擬似戦争 | Q655480 | 1798 | 1800 | conflict | 3 | war | 大西洋 |
| 31 | ジョージアン様式 | Q1125300 | 1720 |  | culture | 2 | other | ヨーロッパ |
| 29 | アラブの冬 | Q17512479 | 2012 | 2018 | conflict | 2 | war | アラブ世界 |
| 29 | アン女王戦争 | Q869045 | 1702 | 1713 | conflict | 2 | war | 北アメリカ |
| 28 | オスマン・ペルシア戦争 | Q4203073 | 1514 | 1823 | conflict | 2 | war | 中東 |
| 27 | European Wars of Religion | Q2490042 | 1524 | 1697 | conflict | 2 | war | ヨーロッパ |
| 24 | ウィリアム王戦争 | Q1070342 | 1688 | 1697 | conflict | 2 | war | 北アメリカ |
| 24 | ジョージ王戦争 | Q517578 | 1744 | 1748 | conflict | 2 | war | 北アメリカ |
| 24 | 第四次マイソール戦争 | Q617782 | 1798 | 1799 | conflict | 2 | war | インド亜大陸 |
| 24 | チンチャ諸島戦争 | Q742813 | 1864 | 1866 | conflict | 2 | war | 大西洋、南アメリカ、南太平洋 |
| 22 | 第2次百年戦争 | Q233559 | 1688 | 1815 | conflict | 2 | war | ヨーロッパ |
| 19 | 連合戦争 | Q601811 | 1836 | 1839 | conflict | 2 | war | 南アメリカ |
| 16 | モンゴルのインド侵攻 | Q2079940 | 1221 |  | conflict | 2 | other | インド亜大陸 |
| 16 | アンティオキア継承戦争 | Q23498601 | 1201 | 1219 | conflict | 2 | war | 中東 |
| 15 | ココリツリの流行 | Q63472138 | 1600 |  | population | 2 | other | 南アメリカ、中央アメリカ |
| 13 | Child's War | Q4122573 | 1686 | 1690 | conflict | 2 | war | インド亜大陸 |
| 12 | ポルトガル・マムルーク海戦 | Q4373383 | 1505 | 1517 | conflict | 2 | war | インド洋 |
| 10 | Second Thirty Years' War | Q163270 | 1914 | 1945 | conflict | 1 | war | ユーラシア |
| 10 | Parthian War of Caracalla | Q3651748 | 216 | 217 | conflict | 1 | war | 西アジア |
| 10 | スペイン・ポルトガル戦争 (1776年-1777年) | Q4204142 | 1776 | 1777 | conflict | 1 | war | 南アメリカ |
| 8 | アフリカのオスマン帝国の戦争 | Q16931603 | 1516 | 1911 | conflict | 1 | war | アフリカ |
| 7 | ビザンチン・サーサーン戦争 (440年) | Q16208236 | 440 |  | conflict | 1 | war | 近東 |
| 7 | ティムールの征服戦争 | Q65121240 | 1369 | 1426 | conflict | 2 | war | ユーラシア |
| 5 | Totoposte Wars | Q19356854 | 1890 | 1906 | conflict | 1 | war | 中央アメリカ |
| 4 | Timur's invasion of India | Q12910863 | 1398 | 1399 | conflict | 1 | war | インド亜大陸 |
| 4 | Guatemalan-Salvadoran war of 1906 | Q24960897 | 1906 |  | conflict | 1 | war | 中央アメリカ |
| 2 | Mutiny on the Fœderis Arca | Q109045619 | 1864 |  | conflict | 1 | war | 大西洋 |
| 2 | Shunga-Greek War | Q123602725 | -200 |  | conflict | 1 | war | インド亜大陸 |
| 2 | Conflict between Willem Leyel and Bernt Pessart | Q125768501 | 1643 | 1645 | conflict | 1 | war | インド洋 |
| 2 | Aramaization of Assyria | Q139750750 | -1200 | -600 | conflict | 1 | war | 近東 |
