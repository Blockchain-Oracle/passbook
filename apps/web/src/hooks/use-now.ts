import { useEffect, useState } from 'react'

/** One clock per surface: epoch ms, re-read every `intervalMs`. `false` holds still (nothing in flight). */
export function useNow(intervalMs: number | false): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs === false) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
