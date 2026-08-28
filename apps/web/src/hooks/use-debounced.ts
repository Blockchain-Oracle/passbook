import { useEffect, useState } from 'react'

/** The value once it has held still for `ms` — a quote or a lookup follows typing, not keystrokes. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return settled
}
