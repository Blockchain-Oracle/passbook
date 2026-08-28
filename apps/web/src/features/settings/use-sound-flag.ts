import { useSyncExternalStore } from 'react'

// Genuinely non-cacheable UI state: a per-browser preference, not a chain read.
const KEY = 'passbook-sounds'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Off by default. Anything that wants to make a noise reads `soundsEnabled()` first. */
export function soundsEnabled(): boolean {
  return read()
}

export function setSoundsEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the switch still flips for this page, and a reload reads the default.
  }
  for (const l of listeners) l()
}

export function useSoundFlag(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => false)
  return [on, setSoundsEnabled]
}
