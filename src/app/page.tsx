

// サーバーサイドレンダリングを無効化して、Leaflet の "window" 依存性を回避
import TimeSeriesMap from '../components/TimeSeriesMap'

const HomePage = () => {
  return (
    <div>
      <h1>クラシック作曲家の歴史的イベントマップ</h1>
      <TimeSeriesMap />
    </div>
  );
};

export default HomePage;