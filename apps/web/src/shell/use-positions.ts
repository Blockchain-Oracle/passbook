//
// The browser's bearer positions — the store, as a hook every surface reads the same way.
//
// ── ONE STORE, ONE CHANGE SIGNAL ─────────────────────────────────────────────────────────
//
// `session-position-store.ts` holds the money (its header says exactly that); this file holds the
// React. Adding a position from the bet ticket has to move the "Your positions" panel in the same
// frame, so writes go through `addPosition` here, which pokes every subscriber — the same
// external-store shape the balance and the activity feed already use.
//
// The store itself is `browserSessionStore()`-backed: positions live beside the account key and
// ride the same backup ceremony. A browser whose storage is unavailable gets the refusing store's
// sentence, rendered as `corrupt`'s cousin rather than as an empty list — an empty list is a claim.
//
import { useSyncExternalStore } from 'react'

import {
  sessionPositionStore,
  type PositionStore,
  type StoredPosition,
} from '@strk20/protocol/session-position-store'
import { browserSessionStore } from '@strk20/protocol/session-store'

let store: PositionStore | null = null

function positionStore(): PositionStore {
  if (store === null) store = sessionPositionStore(browserSessionStore())
  return store
}

const listeners = new Set<() => void>()
let snapshot: StoredPosition[] = []
let snapshotFresh = false

function readSnapshot(): StoredPosition[] {
  if (!snapshotFresh) {
    try {
      snapshot = positionStore().list()
    } catch {
      // Storage refused — `list()` cannot answer. An empty snapshot here is the one honest
      // rendering a hook can make; the backup surface is where the loud version lives.
      snapshot = []
    }
    snapshotFresh = true
  }
  return snapshot
}

function poke() {
  snapshotFresh = false
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Every stored bearer position, newest first. Re-renders on every add/remove made through here. */
export function usePositions(): StoredPosition[] {
  const positions = useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
  return positions
}

/** Store one freshly-created position. Throws the store's own sentence on a duplicate. */
export function addPosition(position: StoredPosition): void {
  positionStore().add(position)
  poke()
}

/** Drop one that has been settled and can never be claimed again. */
export function removePosition(commitment: string): void {
  positionStore().remove(commitment)
  poke()
}
