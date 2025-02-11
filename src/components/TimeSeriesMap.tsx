'use client';
import { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { composerEvents } from '../data/events';

const TimeSeriesMap = () => {
  const [selectedDate, setSelectedDate] = useState('1700-01-01');

  // 選択された日付までのイベントをフィルタリング
  const filteredEvents = composerEvents.filter(
    (event) => event.date <= selectedDate
  );

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(e.target.value);
  };

  return (
    <div>
      <h2>時系列マップ</h2>
      <input
        type="date"
        value={selectedDate}
        min="1700-01-01"
        max="1800-12-31"
        onChange={handleDateChange}
      />
      <MapContainer
        center={[51.0, 10.0]} // ドイツ中心
        zoom={5}
        style={{ height: '600px', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {filteredEvents.map((event) => (
          <Marker key={event.id} position={event.location}>
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