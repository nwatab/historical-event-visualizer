'use client';

import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { composerEvents } from '../data/events';
import { format, parseISO, differenceInDays, addDays } from 'date-fns';

import L from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})
const TimeSeriesMap = () => {
  // 日付の範囲設定
  const MIN = parseISO('1700-01-01');
  const MAX = parseISO('1800-12-31');
  const TOTAL_DAYS = differenceInDays(MAX, MIN);

  const [currentDay, setCurrentDay] = useState(0); // MIN からの経過日数
  const [isPlaying, setIsPlaying] = useState(false);
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  // 選択された日付までのイベントをフィルタリング
  const selectedDate = addDays(MIN, currentDay);
  const filteredEvents = composerEvents.filter(
    (event) => parseISO(event.date) <= selectedDate
  );

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  // アニメーションの効果
  useEffect(() => {
    if (isPlaying) {
      animationRef.current = setInterval(() => {
        setCurrentDay((prevDay) => {
          if (prevDay >= TOTAL_DAYS) {
            clearInterval(animationRef.current!);
            setIsPlaying(false);
            return prevDay;
          }
          return prevDay + 1;
        });
      }, 100); // アニメーション速度を調整（ミリ秒）
    } else if (animationRef.current) {
      clearInterval(animationRef.current);
    }
    return () => {
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, [isPlaying, TOTAL_DAYS]);

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentDay(Number(e.target.value));
  };

  return (
    <div>
      <h2>時系列マップ</h2>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
        <button onClick={handlePlayPause}>{isPlaying ? '停止' : '再生'}</button>
        <div style={{ flexGrow: 1, marginLeft: '20px' }}>
          {/* react-range の代わりにシンプルな range input を使用 */}
          <input
            type="range"
            min={0}
            max={TOTAL_DAYS}
            step={1}
            value={currentDay}
            onChange={handleRangeChange}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginLeft: '10px' }}>
          {format(selectedDate, 'yyyy-MM-dd')}
        </div>
      </div>

      <MapContainer
        center={[51.0, 10.0]} // ドイツ中心
        zoom={5}
        style={{ height: '600px', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">
            OpenStreetMap
          </a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {filteredEvents.map((event) => (
          <Marker
            key={event.id}
            position={event.location}
          >
            <Popup>
              <strong>{event.composer}</strong>
              <br />
              {event.composition}
              <br />
              {event.date}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default TimeSeriesMap;
