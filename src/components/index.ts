'use client'
import dynamic from 'next/dynamic'
const LazyMap = dynamic(() => import('./TimeSeriesMap'), {
    ssr: false,
  })
export { LazyMap }