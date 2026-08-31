//
// The cross-tab submit lock, on the Web Locks API. A tab holds `passbook.submit-lock` for exactly
// as long as ONE submission runs, and holds nothing at rest.
//
// ── IT USED TO BE HELD FOR THE TAB'S LIFETIME, AND THAT IS NOT THE SAME RULE ──────────────
//
// The invariant worth enforcing is "one pipeline at a time per account". What was enforced instead
// was "whichever tab opened first may ever submit": the lock was requested at construction and
// released only on close, so a second tab was refused for the life of the first — even when that
// first tab was idle and had never submitted anything. The refusal it printed, "That tab is
// submitting", was then simply false, and the only way out was a manual steal that could abort a
// real submission mid-flight.
//
// Holding per submission enforces the actual invariant and makes the sentence true. Two tabs can
// both read, both prepare, and the second to reach the chain waits out the first or is told to.
//
// A tab that has not been granted the lock never submits. Where `navigator.locks` is absent (Node,
// Safari before 15.4) a single-process in-memory manager stands in, and that stand-in is HONESTLY
// WEAKER: its queue is a module-level map, so two tabs each get their own and both are granted.
// It still refuses the case that actually happens — the same tab submitting twice — and refusing
// every submission instead would brick a browser over a risk that needs two tabs to exist at all.
// Cross-tab exclusion requires Web Locks; without them this degrades to per-tab, and says so.
//

import { ACCOUNT_OPEN_IN_ANOTHER_TAB, SUBMISSION_ALREADY_IN_PROGRESS } from './session-copy.js'

interface LockPeer {
  id: string
  startedAt: number
}

/** `submitting` = this tab holds the lock; `blocked` = another tab does. `idle` = nobody here. */
type LockRole = 'idle' | 'blocked' | 'submitting'

interface LockState {
  readonly self: LockPeer
  readonly role: LockRole
  /** True while this tab holds the submit lock. The reentrancy guard. */
  readonly held: boolean
  /** Why this lock has permanently stood down, or `null`. */
  readonly fault: string | null
}

const DEFAULT_LOCK_CHANNEL = 'passbook.submit-lock'

/**
 * How long `acquire` waits for the lock before refusing.
 *
 * Short on purpose, and it is a UX decision rather than a safety one. A submission takes tens of
 * seconds, so a window wide enough to outlast one would leave a button spinning with nothing to
 * show for it. This is sized to catch the case that actually happens — the other tab finishing
 * just as this one asks — and to tell the user plainly otherwise. Waiting is never silent.
 */
const DEFAULT_ACQUIRE_WAIT_MS = 3_000

/** The double-click. User sentence first; the developer detail rides behind it for the log. */
const SUBMIT_LOCK_ALREADY_HELD =
  `${SUBMISSION_ALREADY_IN_PROGRESS} ` +
  '(this tab already holds the submit lock; a second acquire would produce two releases for one hold)'

const SUBMIT_LOCK_CLOSED = 'this submit lock has been closed'

/** Thrown by every acquire on a lock whose manager was explicitly withheld (`locks: null`). */
const SUBMIT_LOCK_NO_CHANNEL =
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
  /** How long `acquire` waits for a grant before refusing. */
  acquireWaitMs?: number
  /** `undefined` → `navigator.locks` or the in-memory fallback; `null` → a refusing lock. */
  locks?: SubmitLockManager | null
}

export interface SessionLock {
  readonly id: string
  /** Takes the submit lock for one submission, or throws. The release is SYNCHRONOUS (bare in a `finally`). */
  acquire(): Promise<() => void>
  /** Drops anything still held. Safe to call twice. */
  close(): void
}

// ── The in-memory stand-in ────────────────────────────────────────────────────────────────

interface Waiter { grant: () => void; abort: () => void }
const memoryQueues = new Map<string, { holder: boolean; queue: Waiter[] }>()

/** Exclusive-only, single process. Abort while queued rejects like the browser does. */
function memoryLockManager(): SubmitLockManager {
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
  if (nav?.locks) return nav.locks
  // Named in the log, because the degradation is invisible from the outside: everything works
  // until a second tab submits at the same moment, which is precisely when nobody is watching.
  if (nav) console.warn('strk20: this browser has no Web Locks API; submissions are serialised per tab only')
  return memoryLockManager()
}

/** Uniqueness, not unpredictability. `randomUUID` is absent off secure origins. */
function newTabId(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const rand = () => Math.random().toString(36).slice(2, 10)
  return `tab-${Date.now().toString(36)}-${rand()}-${rand()}`
}

// ── The lock ──────────────────────────────────────────────────────────────────────────────

/** Builds a lock. Nothing is held until `acquire`. */
export function createSessionLock(options: SessionLockOptions = {}): SessionLock {
  const now = options.now ?? Date.now
  const waitMs = options.acquireWaitMs ?? DEFAULT_ACQUIRE_WAIT_MS
  if (!Number.isFinite(waitMs) || waitMs <= 0) {
    throw new Error(`refusing a lock whose acquire window is ${String(waitMs)}: it must be a positive finite number`)
  }
  const startedAt = now()
  if (!Number.isFinite(startedAt)) {
    throw new Error(`refusing a lock whose clock answered ${String(startedAt)}: now() must return a finite number`)
  }
  const id = options.id ?? newTabId()
  const self: LockPeer = { id, startedAt }

  if (options.locks === null) {
    return {
      id,
      acquire: async () => { throw new Error(SUBMIT_LOCK_NO_CHANNEL) },
      close: () => {},
    }
  }

  const locks = options.locks ?? defaultLockManager()
  const name = options.channelName ?? DEFAULT_LOCK_CHANNEL

  let state: LockState = { self, role: 'idle', held: false, fault: null }
  let closed = false
  /**
   * Set synchronously at the top of `acquire`, because `state.held` is only true AFTER the grant.
   * Two overlapping acquires in one tab — a double-clicked button, or send and register firing
   * together — would both pass a `held` check, and the second would queue against its own tab and
   * time out three seconds later claiming another tab was submitting. Which is a false sentence.
   */
  let acquiring = false

  const set = (patch: Partial<LockState>) => {
    state = { ...state, ...patch }
  }

  return {
    id,

    acquire: async () => {
      if (closed) throw new Error(SUBMIT_LOCK_CLOSED)
      if (state.fault !== null) throw new Error(state.fault)
      // Reentrancy is refused, not counted: one release per acquire, called in a `finally`.
      if (state.held || acquiring) throw new Error(SUBMIT_LOCK_ALREADY_HELD)
      acquiring = true
      try {
        return await grant()
      } finally {
        acquiring = false
      }
    },

    close: () => {
      if (closed) return
      closed = true
      // Deliberately does NOT release a hold that is still running. The submission it guards is
      // still going to POST, and freeing the lock here would let another tab start a second
      // pipeline over the same notes — the exact thing this lock exists to prevent. The in-flight
      // release runs in its own `finally`, and a real page teardown frees the lock via the browser.
      if (!state.held) set({ role: 'idle' })
    },
  }

  /** The grant itself. Split out so `acquire` can hold a synchronous flag across it. */
  async function grant(): Promise<() => void> {
    // The request stays queued until granted or aborted. Aborting a QUEUED request rejects it;
    // aborting after the grant does nothing, which is why the timer is cleared inside the callback.
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), waitMs)

    // The grant HANDS THE RELEASER OUT rather than assigning a captured variable: the callback
    // runs inside the lock manager, so its effects are invisible to control-flow analysis and a
    // captured `release` reads as never-assigned at every use below.
    const granted = new Promise<() => void>((resolve, reject) => {
      locks
        .request(name, { mode: 'exclusive', signal: abort.signal }, () =>
          new Promise<void>((done) => {
            clearTimeout(timer)
            resolve(done)
          }),
        )
        // Resolving means the callback's promise settled — i.e. the hold is over, not that it failed.
        .then(() => undefined, reject)
    })

    let release: () => void
    try {
      release = await granted
    } catch (e) {
      clearTimeout(timer)
      // Queued-then-aborted is the ordinary "another tab is submitting". Anything else is a
      // broken lock manager, and standing down permanently beats submitting past it.
      if ((e as { name?: string } | null)?.name === 'AbortError') {
        set({ role: 'blocked' })
        throw new Error(ACCOUNT_OPEN_IN_ANOTHER_TAB)
      }
      set({ role: 'idle', fault: `the submit lock request failed: ${String(e)}` })
      throw new Error(state.fault!)
    }

    if (closed) {
      release()
      throw new Error(SUBMIT_LOCK_CLOSED)
    }
    set({ role: 'submitting', held: true })
    let released = false
    return () => {
      if (released) return
      released = true
      set({ role: 'idle', held: false })
      release()
    }
  
  }
}
