import { useEffect, useState } from 'react'
import { serverNow } from './clock'

/** Re-renders once in a while so "3 min ago" stays true without any new data arriving. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
