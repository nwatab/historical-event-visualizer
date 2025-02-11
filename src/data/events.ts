export interface ComposerEvent {
    id: number;
    composer: string;
    composition: string;
    location: [number, number]; // [緯度, 経度]
    date: string; // 'YYYY-MM-DD' の形式
  }
  
  export const composerEvents: ComposerEvent[] = [
    {
      id: 1,
      composer: 'ヨハン・セバスチャン・バッハ',
      composition: 'マタイ受難曲',
      location: [51.313, 9.492], // ドイツ、ライプツィヒ
      date: '1727-04-11',
    },
    {
      id: 2,
      composer: 'ヴォルフガング・アマデウス・モーツァルト',
      composition: 'フィガロの結婚',
      location: [48.208, 16.373], // オーストリア、ウィーン
      date: '1786-05-01',
    },
  ];