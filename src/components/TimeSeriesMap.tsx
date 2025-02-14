'use client';

import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { composerEvents } from '../data/events';
import {
  format,
  parseISO,
  differenceInDays,
  addDays,
  addYears,
  addMonths,
} from 'date-fns';

import L from 'leaflet';

L.Icon.Default.mergeOptions({
  iconUrl: '/marker-icon.png',
  iconRetinaUrl: '/marker-icon-2x.png',
  shadowUrl: '/marker-shadow.png',
});

const TimeSeriesMap = () => {
  // 日付の範囲設定
  const MIN = parseISO('1700-01-01');
  const MAX = parseISO('1800-12-31');
  const TOTAL_DAYS = differenceInDays(MAX, MIN);

  const [currentDay, setCurrentDay] = useState(0); // MIN からの経過日数
  const [isPlaying, setIsPlaying] = useState(false);
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  // 選択された日付
  const selectedDate = addDays(MIN, currentDay);

  // ±dN年の範囲を定義（ここでは ±5年）
  const YEAR_MARGIN = 5;
  const lowerBound = addYears(selectedDate, -YEAR_MARGIN);
  const upperBound = addYears(selectedDate, YEAR_MARGIN);

  // 選択された日付の前後 ±dN年内のイベントをフィルタリング
  const filteredEvents = composerEvents.filter((event) => {
    const eventDate = parseISO(event.date);
    return eventDate >= lowerBound && eventDate <= upperBound;
  });

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  // アニメーションの効果（月単位で進める）
  useEffect(() => {
    if (isPlaying) {
      animationRef.current = setInterval(() => {
        setCurrentDay((prevDay) => {
          const currentDate = addDays(MIN, prevDay);
          const nextDate = addMonths(currentDate, 1);
          const nextDayCount = differenceInDays(nextDate, MIN);
          if (nextDayCount > TOTAL_DAYS) {
            clearInterval(animationRef.current!);
            setIsPlaying(false);
            return prevDay;
          }
          return nextDayCount;
        });
      }, 5); // アニメーション速度を調整（ミリ秒）
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
          {/* シンプルな range input を使用 */}
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
          {format(selectedDate, 'yyyy')}
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
          <Marker key={event.id} position={event.location}>
            <Tooltip direction="top" offset={[0, -20]} permanent>
              <div>
                <strong>{event.composer}</strong>
                <br />
                {event.composition}
              </div>
            </Tooltip>
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
