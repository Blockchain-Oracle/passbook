//
// The cross-tab submit lock, on the Web Locks API. One tab holds `passbook.submit-lock` for its
// lifetime and is the leader; every other tab's request stays queued and is granted by the browser
// the moment the leader closes or crashes — takeover for free, no heartbeat protocol.
//
// FAIL CLOSED: a tab that has not been granted the lock never submits. `acquire()` waits out a
// short election window (the grant is immediate when the lock is free) and then refuses with the
// sentence the user reads. Where `navigator.locks` is absent (Node, old browsers) a single-process
// in-memory manager stands in — same semantics, one process.
//

import { ACCOUNT_OPEN_IN_ANOTHER_TAB, SUBMISSION_ALREADY_IN_PROGRESS } from './session-copy.js'

export interface LockPeer {
  id: string
  startedAt: number
}

/** Only `leader` may submit. `electing` = request pending; `follower` = another tab holds it. */
export type LockRole = 'idle' | 'electing' | 'follower' | 'leader'

export interface LockState {
  readonly self: LockPeer
  readonly role: LockRole
  /** True while this tab holds the submit lock. The reentrancy guard. */
  readonly held: boolean
  /** Why this lock has permanently stood down, or `null`. */
  readonly fault: string | null
}

export const DEFAULT_LOCK_CHANNEL = 'passbook.submit-lock'

/** How long `acquire` waits for a pending grant before calling this tab a follower. */
export const DEFAULT_ELECTION_MS = 1_000

/** The double-click. User sentence first; the developer detail rides behind it for the log. */
export const SUBMIT_LOCK_ALREADY_HELD =
  `${SUBMISSION_ALREADY_IN_PROGRESS} ` +
  '(this tab already holds the submit lock; a second acquire would produce two releases for one hold)'

export const SUBMIT_LOCK_CLOSED = 'this submit lock has been closed'

/** Thrown by every acquire on a lock whose manager was explicitly withheld (`locks: null`). */
export const SUBMIT_LOCK_NO_CHANNEL =
  'this browser has no BroadcastChannel, so tabs cannot agree on which one submits; ' +
  'no tab may submit'

/** The slice of `LockManager` this module uses. `navigator.locks`, or the in-memory stand-in. */
export interface SubmitLockManager {
  request(
    name: string,
    /** `steal` releases the current holder (its request rejects with AbortError); the spec forbids pairing it with `signal`. */
    options: { mode: 'exclusive'; signal?: AbortSignal; steal?: boolean },
    callback: () => Promise<void>,
  ): Promise<void>
}

export interface SessionLockOptions {
  channelName?: string
  /** This tab's id. Generated when absent. */
  id?: string
  now?: () => number
  electionMs?: number
  /** `undefined` → `navigator.locks` or the in-memory fallback; `null` → a refusing lock. */
  locks?: SubmitLockManager | null
}

export interface SessionLock {
  readonly id: string
  state(): LockState
  isLeader(): boolean
  /** Takes the submit lock, or throws. The release is SYNCHRONOUS (called bare in a `finally`). */
  acquire(): Promise<() => void>
  /** Makes THIS tab the leader now: the holder is preempted and told so. Resolves once granted. */
  takeOver(): Promise<void>
  /** Gives the lock up so the next tab is granted it. */
  close(): void
}

// ── The in-memory stand-in ────────────────────────────────────────────────────────────────

interface Waiter { grant: () => void; abort: () => void }
const memoryQueues = new Map<string, { holder: boolean; queue: Waiter[] }>()

/** Exclusive-only, single process. Abort while queued rejects like the browser does. */
export function memoryLockManager(): SubmitLockManager {
  return {
    request: (name, options, callback) =>
      new Promise<void>((resolve, reject) => {
        const entry = memoryQueues.get(name) ?? { holder: false, queue: [] }
        memoryQueues.set(name, entry)
        const run = () => {
          entry.holder = true
          callback().then(resolve, reject).finally(() => {
            entry.holder = false
            const next = entry.queue.shift()
            if (next) next.grant()
            else memoryQueues.delete(name)
          })
        }
        const waiter: Waiter = { grant: run, abort: () => reject(new DOMException('aborted', 'AbortError')) }
        options.signal?.addEventListener('abort', () => {
          const at = entry.queue.indexOf(waiter)
          if (at >= 0) {
            entry.queue.splice(at, 1)
            waiter.abort()
          }
        })
        if (options.signal?.aborted) return waiter.abort()
        if (entry.holder) entry.queue.push(waiter)
        else run()
      }),
  }
}

function defaultLockManager(): SubmitLockManager {
  const nav = (globalThis as { navigator?: { locks?: SubmitLockManager } }).navigator
  return nav?.locks ?? memoryLockManager()
}

/** Uniqueness, not unpredictability. `randomUUID` is absent off secure origins. */
function newTabId(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const rand = () => Math.random().toString(36).slice(2, 10)
  return `tab-${Date.now().toString(36)}-${rand()}-${rand()}`
}

// ── The lock ──────────────────────────────────────────────────────────────────────────────

/** Builds a running lock. It requests leadership immediately. */
export function createSessionLock(options: SessionLockOptions = {}): SessionLock {
  const now = options.now ?? Date.now
  const electionMs = options.electionMs ?? DEFAULT_ELECTION_MS
  if (!Number.isFinite(electionMs) || electionMs <= 0) {
    throw new Error(`refusing a lock whose election window is ${String(electionMs)}: it must be a positive finite number`)
  }
  const startedAt = now()
  if (!Number.isFinite(startedAt)) {
    throw new Error(`refusing a lock whose clock answered ${String(startedAt)}: now() must return a finite number`)
  }
  const id = options.id ?? newTabId()
  const self: LockPeer = { id, startedAt }

  if (options.locks === null) {
    const dead: LockState = { self, role: 'idle', held: false, fault: SUBMIT_LOCK_NO_CHANNEL }
    return {
      id,
      state: () => dead,
      isLeader: () => false,
      acquire: async () => { throw new Error(SUBMIT_LOCK_NO_CHANNEL) },
      takeOver: async () => { throw new Error(SUBMIT_LOCK_NO_CHANNEL) },
      close: () => {},
    }
  }

  const locks = options.locks ?? defaultLockManager()
  const name = options.channelName ?? DEFAULT_LOCK_CHANNEL
  const abort = new AbortController()

  let state: LockState = { self, role: 'electing', held: false, fault: null }
  let closed = false
  let grants = 0
  let releaseLeadership: (() => void) | null = null
  let waiters: Array<() => void> = []

  const wake = () => {
    const waiting = waiters
    waiters = []
    for (const w of waiting) w()
  }
  const set = (patch: Partial<LockState>) => {
    state = { ...state, ...patch }
    if (state.role !== 'electing') wake()
  }

  // The request resolves only when the callback's promise does — i.e. when this tab closes.
  // A stolen lead rejects with AbortError: that tab steps down to follower and queues again, so
  // it is promoted back the moment the thief closes. Any other rejection is a fault to read.
  const requestLeadership = (steal: boolean): Promise<void> =>
    locks
      .request(name, steal ? { mode: 'exclusive', steal: true } : { mode: 'exclusive', signal: abort.signal }, () =>
        new Promise<void>((release) => {
          releaseLeadership = release
          if (closed) release()
          else set({ role: 'leader', held: false })
        }),
      )
      .catch((e: unknown) => {
        if (closed) return
        const stolen = state.role === 'leader' && (e as { name?: string } | null)?.name === 'AbortError'
        if (stolen) {
          releaseLeadership = null
          set({ role: 'follower', held: false })
          void requestLeadership(false)
          return
        }
        set({ role: 'idle', held: false, fault: `the submit lock request failed: ${String(e)}` })
      })
  void requestLeadership(false)

  // Not granted within the window while another tab is alive = follower. The queued request
  // stays in place, so the browser still promotes this tab when the leader goes away.
  const followerTimer = setTimeout(() => {
    if (!closed && state.role === 'electing') set({ role: 'follower' })
  }, electionMs)

  const waitForGrant = () =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, electionMs)
      waiters.push(() => { clearTimeout(t); resolve() })
    })

  return {
    id,
    state: () => state,
    isLeader: () => state.role === 'leader',

    acquire: async () => {
      if (closed) throw new Error(SUBMIT_LOCK_CLOSED)
      if (state.fault !== null) throw new Error(state.fault)
      if (state.role === 'electing') {
        await waitForGrant()
        if (closed) throw new Error(SUBMIT_LOCK_CLOSED)
      }
      if (state.role !== 'leader') {
        if (state.role === 'electing') set({ role: 'follower' })
        throw new Error(ACCOUNT_OPEN_IN_ANOTHER_TAB)
      }
      // Reentrancy is refused, not counted: one release per acquire, called in a `finally`.
      if (state.held) throw new Error(SUBMIT_LOCK_ALREADY_HELD)
      // Every grant gets its own number so a stale release cannot free a newer hold.
      const epoch = ++grants
      set({ held: true })
      return () => {
        if (epoch !== grants) return
        set({ held: false })
      }
    },

    takeOver: async () => {
      if (closed) throw new Error(SUBMIT_LOCK_CLOSED)
      // Read through a call: `state` is reassigned by `set` across the await, which narrowing cannot see.
      const leading = () => state.role === 'leader'
      if (leading()) return
      const granted = new Promise<void>((resolve) => waiters.push(resolve))
      void requestLeadership(true)
      await granted
      if (!leading()) throw new Error(state.fault ?? 'the submit lock could not be taken over')
    },

    close: () => {
      if (closed) return
      closed = true
      clearTimeout(followerTimer)
      if (releaseLeadership) releaseLeadership()
      else abort.abort()
      set({ role: 'idle', held: false })
      wake()
    },
  }
}
