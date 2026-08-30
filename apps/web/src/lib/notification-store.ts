//
// What the app has told you lately, kept so a missed toast is not a lost fact.
//
// A toast is a four-second window. Everything the app says about money — a submission, a
// settlement, a refusal with the reason in it — was going through that window and then being
// unrecoverable. This is the log behind the window: in memory only, capped, and deliberately NOT
// persisted, because it holds transaction hashes and amounts and this browser's storage is
// already carrying position secrets that matter more.
//
import { useSyncExternalStore } from 'react'

import type { NotificationTone } from '@/components/ui/notification'

export interface NotificationRecord {
  readonly id: string
  readonly tone: NotificationTone
  readonly title: string
  readonly description: string | null
  readonly hash: string | null
  readonly at: number
}

/** Enough to answer "what did that say?", not a second activity feed. */
const CAP = 20

interface State {
  readonly records: readonly NotificationRecord[]
  readonly unread: number
}

let state: State = { records: [], unread: 0 }
const listeners = new Set<() => void>()

function publish(next: State): void {
  state = next
  for (const listener of listeners) listener()
}

export function recordNotification(record: NotificationRecord): void {
  publish({
    records: [record, ...state.records].slice(0, CAP),
    // A `moving` card is a progress report that will be replaced by its own outcome; counting it
    // would leave a badge standing for something already superseded.
    unread: record.tone === 'moving' ? state.unread : state.unread + 1,
  })
}

export function markNotificationsRead(): void {
  if (state.unread === 0) return
  publish({ records: state.records, unread: 0 })
}

export function clearNotifications(): void {
  publish({ records: [], unread: 0 })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): State {
  return state
}

/** The centre's read. One store, so the sidebar badge and the list never disagree. */
export function useNotifications(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
