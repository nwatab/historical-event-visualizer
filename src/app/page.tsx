import React from 'react';
import {LazyMap} from '../components'

const HomePage = () => {
  return (
    <div>
      <h1>クラシック作曲家の歴史的イベントマップ</h1>
        <LazyMap />
    </div>
  );
};

export default HomePage;