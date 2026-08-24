//
// The cross-tab leader lock (story 1.11, AC2/AC3) — one tab submits, the others say so.
//
// WHAT IT IS FOR. Two tabs open on the same account both pass `preflightRegistration`, both
// prove, and both submit; the pool writes the viewing key once, so the second one reverts
// `NON_ZERO_VALUE` after somebody has already paid for it. Channel opens have the sharper
// version of the same problem: their indices must be strictly sequential
// (`actions.ts`'s INDEX_NOT_SEQUENTIAL), and two tabs assigning an index from the same read
// both pick the same number. Nothing in this repository owned "which tab may submit", so
// `register.ts` shipped the seam with a no-op default. This module is what fills it.
//
// A PURE CORE WITH INJECTED EVERYTHING. `reduceLock` is `(state, event, now)` and touches
// nothing — no clock, no channel, no timers — so every election, every takeover and every
// contested claim in the suite runs in microseconds against hand-written events. The runtime
// wrapper below is the only part that knows a BroadcastChannel exists, and its clock and its
// timers are both parameters. `Date.now()` appears once, as a default.
//
// FAIL CLOSED, WHICH HERE MEANS: a tab that cannot work out whether it leads is a follower.
// The only transition into leadership is an election deadline passing with the channel silent
// — an ANSWERED silence, after this tab has announced itself and given every other tab a full
// `electionMs` to object. There is no path where uncertainty, an error, a closed channel or a
// missing message promotes anybody.
//
// BROADCASTCHANNEL IS THE MECHANISM, not Web Locks. Web Locks would hand us mutual exclusion
// for free and would also be the wrong tool: it cannot tell a waiting tab WHY it is waiting,
// and the product requirement here is a sentence on screen naming the other tab, not a promise
// that resolves whenever the other tab finishes. A tab has to know it is a follower while it
// is one, which means the tabs have to talk.
//
// NO `beforeunload`. Takeover handles the tab that crashed, was killed by the OS, or lost its
// process — and since that path has to exist anyway, a graceful handover on `close()` is an
// optimisation layered on top of it rather than a mechanism anything depends on.
//

import { ACCOUNT_OPEN_IN_ANOTHER_TAB, SUBMISSION_ALREADY_IN_PROGRESS } from './session-copy.js'
import type { DeadlineTimer } from './register.js'

// ── The protocol ──────────────────────────────────────────────────────────────────────────

/** A tab, as the total order sees it. `startedAt` first, `id` to break the tie. */
export interface LockPeer {
  id: string
  startedAt: number
}

/**
 * What tabs say to each other. Three messages, and no acknowledgements.
 *
 * There is no consensus round and no voting, because there does not need to be: leadership is
 * decided by a total order every tab can compute alone from values that are already in the
 * messages. A tab that hears a claim it loses to knows it lost without replying.
 */
export type LockMessage =
  /** "I would like to lead." Sent on start and whenever an election reopens. */
  | { type: 'claim'; id: string; startedAt: number }
  /** "I lead." Sent on promotion, as the answer to a claim, and as the heartbeat. */
  | { type: 'leader'; id: string; startedAt: number }
  /** "I am leaving." The graceful handover — an optimisation over waiting for takeover. */
  | { type: 'released'; id: string; startedAt: number }

/** Everything the reducer reacts to: the three wire messages plus two local events. */
export type LockEvent = LockMessage | { type: 'start' } | { type: 'tick' }

/** Where a tab stands. Only `leader` may submit; everything else is a follower for that purpose. */
export type LockRole = 'idle' | 'electing' | 'follower' | 'leader'

/**
 * The intervals. `takeoverMs` must be at least three heartbeats, and the factory refuses
 * anything less.
 *
 * Three is the smallest margin that does not turn ordinary scheduling into a coup. A
 * background tab gets its timers throttled hard, a laptop lid closing suspends the whole
 * process, and a busy main thread delays a callback by whole seconds — every one of those
 * makes a live leader miss a beat. Taking over after one missed heartbeat would mean the
 * common case (a leader that is merely slow) produces two tabs that both think they lead,
 * which is the one outcome this module promises never to produce.
 */
export interface LockTimings {
  /** How long a candidate waits for an objection before it may promote itself. */
  electionMs: number
  /** How often a leader says it is still there. */
  heartbeatMs: number
  /** How long a follower tolerates silence before reopening the election. */
  takeoverMs: number
}

/**
 * The shipped intervals.
 *
 * The takeover window is three and a half seconds: what a second tab waits after the first one
 * is killed before it may submit — long enough to survive a stalled main thread, short enough
 * that somebody who force-quit a tab does not think the app is broken.
 *
 * `electionMs` IS AT LEAST `heartbeatMs`, and that is a correctness rule rather than taste.
 *
 * A tab opening while the current leader is throttled hears nothing during its election and
 * promotes beside a leader that is alive — the transient two-leader case. Followers answering
 * claims on their leader's behalf (see the reducer) covers it whenever a follower exists; an
 * election window at least one heartbeat long is what covers the case where none does, because
 * a live leader emits a beat inside any window that long.
 *
 * The cost is a full second before a lone tab may submit, and `acquire` absorbs it by AWAITING
 * the election rather than refusing during it — so the user waits, once, instead of being told
 * something false about another tab.
 */
export const DEFAULT_LOCK_TIMINGS: LockTimings = {
  electionMs: 1_000,
  heartbeatMs: 1_000,
  takeoverMs: 3_500,
}

/** The default channel name. One per account is unnecessary — one browser, one active account. */
export const DEFAULT_LOCK_CHANNEL = 'passbook.submit-lock'

/**
 * The whole machine, as data. Copied on every transition rather than mutated, so a test can
 * hold on to a previous state and compare.
 */
export interface LockState {
  readonly self: LockPeer
  readonly timings: LockTimings
  readonly role: LockRole
  /**
   * When the current phase runs out, epoch ms: the election deadline while electing, the next
   * heartbeat while leading, the takeover deadline while following. One field, because at any
   * moment there is exactly one thing this tab is waiting for.
   */
  readonly expiresAt: number
  /** The tab we believe leads. `null` unless we are following one. */
  readonly leader: LockPeer | null
  /** True while this tab holds the submit lock. The reentrancy guard. */
  readonly held: boolean
  /**
   * Why this tab has permanently stood down, or `null`.
   *
   * Set exactly once, by the duplicate-id detection below, and never cleared. A faulted tab is
   * a follower forever: it does not reopen an election on takeover and it never leads again.
   * See `DUPLICATE_TAB_ID` for the one condition that produces it.
   */
  readonly fault: string | null
}

/** A transition: the next state, and what to broadcast. The reducer never sends anything itself. */
export interface LockTransition {
  state: LockState
  send: LockMessage[]
}

/** A machine that has not started. `idle` never leads and never expires into anything. */
export function initialLockState(self: LockPeer, timings: LockTimings = DEFAULT_LOCK_TIMINGS): LockState {
  return { self, timings, role: 'idle', expiresAt: 0, leader: null, held: false, fault: null }
}

/**
 * The reason a tab stands down permanently: another tab is using its id.
 *
 * Two tabs sharing an id is not a race, it is a broken invariant — the total order is
 * `(startedAt, id)`, so two peers with one id are indistinguishable to each other and the
 * tie-break that exists to separate them cannot. Worse, the self-echo guard makes each one
 * DROP the other's messages as its own, so neither ever hears an objection and BOTH promote on
 * silence: a permanent split, arrived at quietly.
 *
 * It is detectable, and cheaply: a message carrying our id and a `startedAt` that is not ours
 * cannot have come from us. Both tabs see it and both stand down, so the outcome is that
 * nobody submits — which is the fail-closed direction, and loud enough to diagnose.
 */
export const DUPLICATE_TAB_ID =
  'another tab is using this tab id, so leadership cannot be decided between them; ' +
  'this tab has stood down permanently'

/**
 * The total order on tabs: earlier start wins, and the id breaks a tie.
 *
 * Deterministic and computable by both sides from the same two numbers, which is what removes
 * the need for a consensus round — two tabs looking at the same pair of peers always agree on
 * which one wins, so the loser can simply stand down without being told to.
 *
 * The id tie-break is not decoration. Two tabs opened by the same click, or restored together
 * by a session restore, genuinely share a millisecond; without a second key they would each
 * conclude the other does not beat them and both would promote.
 */
export function beatsInLockOrder(a: LockPeer, b: LockPeer): boolean {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt
  return a.id < b.id
}

/** True when this state may submit. The one predicate; nothing compares `role` to a string. */
export function isLeader(state: LockState): boolean {
  return state.role === 'leader'
}

const claim = (self: LockPeer): LockMessage => ({ type: 'claim', id: self.id, startedAt: self.startedAt })
const assertLead = (self: LockPeer): LockMessage => ({ type: 'leader', id: self.id, startedAt: self.startedAt })

/**
 * The election, as a pure function. Every rule this module has is in here.
 *
 * Reads no clock and performs no I/O: `now` is a parameter and the messages to broadcast come
 * back in the return value. That is what makes the whole protocol — contested claims, silent
 * promotion, missed heartbeats, graceful handover — testable without a timer or a channel.
 */
export function reduceLock(state: LockState, event: LockEvent, now: number): LockTransition {
  const { self, timings } = state
  const stay: LockTransition = { state, send: [] }

  // A tab that has stood down for a duplicate id stays stood down, whatever arrives next —
  // `start` INCLUDED. Exempting it contradicted the word "permanent" and did real damage: a
  // faulted machine would broadcast a claim it can never honour, because its ticks are swallowed
  // here and it can therefore never promote, and a legitimate candidate that heard that claim
  // would stand down and wait out `takeoverMs` for a leader that is never coming.
  //
  // Nothing un-faults a machine. The id collision is a caller bug and the remedy is a new lock
  // with a unique id, not a transition.
  if (state.fault !== null) return stay

  if (event.type === 'claim' || event.type === 'leader' || event.type === 'released') {
    // A BroadcastChannel does not deliver a tab its own posts (verified on this Node build), so
    // a message carrying our id is either that echo — harmless, and ignored — or the thing that
    // must never be ignored: another tab using our id. `startedAt` tells them apart, because
    // ours is a value only we hold. See `DUPLICATE_TAB_ID`.
    if (event.id === self.id) {
      if (event.startedAt === self.startedAt) return stay
      return {
        state: {
          ...state,
          role: 'follower',
          leader: null,
          held: false,
          fault: DUPLICATE_TAB_ID,
          // PARKED, so the runtime stops arming timers for it. Left at whatever the previous
          // phase set, `expiresAt` sits in the past forever, the reducer swallows every tick as
          // a no-op, and `schedule()` re-arms a zero-delay timeout after each one — a spin that
          // burns a core until the tab closes. The runtime skips faulted states too; both ends,
          // because either alone is one edit away from bringing it back.
          expiresAt: 0,
        },
        send: [],
      }
    }
  }

  switch (event.type) {
    case 'start':
      // Announce, then wait to be objected to. Leadership is never taken at this moment, only
      // asked for — the promotion happens on the tick that finds the deadline passed.
      //
      // `held` is cleared. Restarting the machine abandons whatever grant was outstanding, and
      // carrying the flag across would leave a lock nobody holds marked as held — permanently
      // refusing every acquire, since only a release clears it and the release belonged to a
      // grant that is now gone.
      return {
        state: { ...state, role: 'electing', leader: null, held: false, expiresAt: now + timings.electionMs },
        send: [claim(self)],
      }

    case 'claim': {
      const other: LockPeer = { id: event.id, startedAt: event.startedAt }

      if (state.role === 'leader') {
        // Incumbency, and it is deliberate that the total order is not consulted. A leader that
        // stood down for a better-ordered latecomer would leave the seat empty while the
        // latecomer is still only a candidate — and if the latecomer then heard the old
        // leader's earlier messages it could stand down too. Answering the claim is what makes
        // a late arrival converge in one message instead of negotiating.
        return { state, send: [assertLead(self)] }
      }

      if (state.role === 'electing') {
        if (beatsInLockOrder(other, self)) {
          // Lost. Wait for their heartbeat rather than promoting on their silence.
          return {
            state: { ...state, role: 'follower', leader: other, expiresAt: now + timings.takeoverMs },
            send: [],
          }
        }
        // Won — and RE-SEND, which is load-bearing rather than chatter. A BroadcastChannel
        // delivers only to channels that were already open when the message was posted, so a
        // tab that started after our claim never received it and is sitting in its own election
        // hearing nothing. Without this re-send it promotes on silence and there are two
        // leaders. It terminates: the loser answers a claim with nothing at all.
        return { state, send: [claim(self)] }
      }

      // A FOLLOWER ANSWERS ON ITS LEADER'S BEHALF, which is the fix for the transient
      // two-leader case and reverses the rule that used to live here.
      //
      // "Stay quiet, the leader will answer" assumed a responsive leader. A throttled one —
      // backgrounded, suspended by the OS, stuck behind a busy main thread — is exactly the
      // leader that does NOT answer, and it is alive. Meanwhile a newcomer only waits
      // `electionMs` before promoting, while this module's own takeover rule says three
      // heartbeats are needed to tell throttled from dead. So the newcomer promotes beside a
      // live leader, and for a moment two tabs may submit.
      //
      // A follower is not throttled at the same instant and it already knows who leads, so it
      // can say so. The message it sends names the LEADER, not itself — it is relaying a fact,
      // not claiming a seat — and the newcomer becomes that leader's follower. Should the leader
      // genuinely be dead, nothing is lost: this follower's own takeover clock is still running,
      // and whoever's expires first reopens a real election.
      if (state.role === 'follower' && state.leader !== null) {
        return { state, send: [assertLead(state.leader)] }
      }
      // Following nobody in particular, or not started at all. Nothing truthful to say.
      return stay
    }

    case 'leader': {
      const other: LockPeer = { id: event.id, startedAt: event.startedAt }

      if (state.role === 'leader') {
        // Two tabs asserting leadership at once. This should be unreachable — incumbency plus
        // the re-send above closes the paths that produce it — so it is handled as the thing
        // that must never persist rather than the thing that must never happen: both sides
        // apply the same total order to the same pair, so exactly one of them stands down and
        // the split lasts one message.
        //
        // Standing down while HOLDING clears the flag without cancelling anything in flight —
        // nothing here can reach into a running submission. `register.ts` re-runs its
        // pre-flight inside the lock precisely because a lock is not the only line of defence.
        if (beatsInLockOrder(other, self)) {
          return {
            state: { ...state, role: 'follower', leader: other, expiresAt: now + timings.takeoverMs, held: false },
            send: [],
          }
        }
        return { state, send: [assertLead(self)] }
      }

      // A machine nobody started does not acquire a leader by overhearing one. Left to fall
      // through it became a follower with a live takeover clock, and its next tick would carry
      // it into an election it was never told to join — a lock the caller has not started must
      // stay inert until `start`.
      if (state.role === 'idle') return stay

      // A tab that already leads outranks a tab that is only asking to. Following it also
      // resets the takeover clock, which is what makes this message double as the heartbeat.
      return {
        state: { ...state, role: 'follower', leader: other, expiresAt: now + timings.takeoverMs },
        send: [],
      }
    }

    case 'released': {
      if (state.role === 'leader') return stay
      // A machine nobody started does not join an election because somebody else left one.
      if (state.role === 'idle') return stay
      // ALREADY electing, and this is the guard that keeps the election finite. Resetting the
      // deadline here means a channel carrying repeated handovers — several tabs closing in
      // sequence, or one misbehaving script — pushes the promotion out by `electionMs` every
      // time, and this tab never leads however long it waits. The handover is only news to a
      // tab that was waiting on a leader; to a candidate it is nothing it was not already doing.
      if (state.role === 'electing') return stay
      // Somebody else's leader left, not ours. Our own takeover clock is still the right one.
      if (state.leader !== null && state.leader.id !== event.id) return stay
      // The seat is empty and we were told so, so there is nothing to wait out — reopen the
      // election immediately instead of sitting through `takeoverMs` of silence we already
      // know the reason for. Still an election, not a promotion: if two followers heard the
      // same handover, exactly one of them wins the contested claim.
      return {
        state: { ...state, role: 'electing', leader: null, expiresAt: now + timings.electionMs },
        send: [claim(self)],
      }
    }

    case 'tick': {
      if (now < state.expiresAt) return stay
      switch (state.role) {
        case 'electing':
          // The one promotion in the module: a full election window during which this tab
          // announced itself and nothing objected.
          return {
            state: { ...state, role: 'leader', leader: self, expiresAt: now + timings.heartbeatMs },
            send: [assertLead(self)],
          }
        case 'leader':
          return { state: { ...state, expiresAt: now + timings.heartbeatMs }, send: [assertLead(self)] }
        case 'follower':
          // Three-plus heartbeats of silence. The leader is gone — crashed, killed, or
          // suspended past the point where it can be told apart from gone.
          return {
            state: { ...state, role: 'electing', leader: null, expiresAt: now + timings.electionMs },
            send: [claim(self)],
          }
        case 'idle':
          return stay
        default:
          // Unreachable through the types, and reachable from untyped JavaScript. The fallthrough
          // direction is the one that matters: an unrecognised role must not promote.
          return stay
      }
    }

    default:
      // Same reasoning for an unrecognised event. TypeScript makes this dead code; a plain-JS
      // caller, a message shape added later, or a `parseLockMessage` that grows a fourth type
      // without a matching branch here all reach it, and every one of them must be inert.
      return stay
  }
}

// ── The wire ──────────────────────────────────────────────────────────────────────────────

/** The transport, as a seam. Two lines of BroadcastChannel, so a test can drive it directly. */
export interface LockChannel {
  post(message: LockMessage): void
  listen(handler: (message: LockMessage) => void): void
  close(): void
}

/**
 * Validates anything arriving off the channel before the reducer sees it.
 *
 * A BroadcastChannel is reachable by every script running on this origin, so what comes out of
 * it is untrusted input in the ordinary sense. It is also structured-cloned, so a message can
 * be any shape at all. An unchecked `startedAt` of `undefined` would make every total-order
 * comparison false and hand leadership to whoever sent it.
 */
export function parseLockMessage(value: unknown): LockMessage | null {
  if (!value || typeof value !== 'object') return null
  const m = value as { type?: unknown; id?: unknown; startedAt?: unknown }
  if (m.type !== 'claim' && m.type !== 'leader' && m.type !== 'released') return null
  if (typeof m.id !== 'string' || !m.id) return null
  if (typeof m.startedAt !== 'number' || !Number.isFinite(m.startedAt)) return null
  return { type: m.type, id: m.id, startedAt: m.startedAt }
}

/** A `LockChannel` over the real BroadcastChannel. The only place the browser API is named. */
export function broadcastLockChannel(name: string = DEFAULT_LOCK_CHANNEL): LockChannel {
  const channel = new BroadcastChannel(name)
  return {
    post: (message) => channel.postMessage(message),
    listen: (handler) => {
      channel.onmessage = (event: MessageEvent) => {
        const message = parseLockMessage(event.data)
        if (message) handler(message)
      }
    },
    close: () => channel.close(),
  }
}

/** The default timer, matching `register.ts`'s own — that module keeps its copy private. */
const REAL_TIMER: DeadlineTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

// ── The runtime ───────────────────────────────────────────────────────────────────────────

/**
 * Thrown when a tab that already holds the lock asks for it again — the double-click.
 *
 * USER SENTENCE FIRST, developer detail in parentheses behind it. `register.ts` stringifies
 * whatever is thrown here into `lock-unavailable`'s `reason`, and epic 6 renders that reason;
 * this is the most common refusal the tier produces, so it was also the most likely developer
 * string to end up on a screen. `SUBMISSION_ALREADY_IN_PROGRESS` says the true thing — the other
 * submission is in THIS tab, not another one — and the explanation still rides along for the log.
 */
export const SUBMIT_LOCK_ALREADY_HELD =
  `${SUBMISSION_ALREADY_IN_PROGRESS} ` +
  '(this tab already holds the submit lock; a second acquire would produce two releases for one hold)'

/** Thrown when the lock has been closed. A closed lock never leads and never grants. */
export const SUBMIT_LOCK_CLOSED = 'this submit lock has been closed'

/** Thrown by every acquire on a lock built where there is no BroadcastChannel. See below. */
export const SUBMIT_LOCK_NO_CHANNEL =
  'this browser has no BroadcastChannel, so tabs cannot agree on which one submits; ' +
  'no tab may submit'

export interface SessionLockOptions {
  channelName?: string
  /**
   * This tab's id.
   *
   * Generated when absent, and THE CALLER OWNS UNIQUENESS WHEN IT IS SUPPLIED. The total order
   * is `(startedAt, id)`, so two live tabs sharing an id cannot be separated by it — and the
   * self-echo guard makes each one discard the other's messages as its own. The reducer detects
   * that case and stands both tabs down (`DUPLICATE_TAB_ID`) rather than letting them both
   * promote, so a collision costs availability rather than correctness; it is still a caller
   * bug. Omit this and a unique id is generated for you.
   */
  id?: string
  timings?: Partial<LockTimings>
  now?: () => number
  timer?: DeadlineTimer
  /** Injected by tests, and by anything that wants a transport other than BroadcastChannel. */
  channel?: LockChannel
}

/**
 * A unique id for this tab. UNIQUENESS, NOT UNPREDICTABILITY — nothing here is a secret.
 *
 * `crypto.randomUUID` is the right answer where it exists and it is absent in exactly the place
 * a demo gets hosted: it is restricted to secure contexts, so a page served over plain HTTP has
 * `crypto` and no `randomUUID` on it. Reaching for it unguarded turns that into a TypeError at
 * boot, before anything has rendered. The fallback does not need to resist guessing, because an
 * attacker who can post to this channel can already claim leadership by asking for it — it only
 * has to not collide with the two or three other tabs the same person has open.
 */
function newTabId(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const rand = () => Math.random().toString(36).slice(2, 10)
  return `tab-${Date.now().toString(36)}-${rand()}-${rand()}`
}

export interface SessionLock {
  readonly id: string
  /** The current machine state. A snapshot — the lock keeps transitioning after you read it. */
  state(): LockState
  isLeader(): boolean
  /**
   * Takes the submit lock, or throws. Matches `RegisterDeps.acquireSubmitLock` exactly.
   *
   * The returned release is SYNCHRONOUS because `register.ts:877` calls it bare inside a
   * `finally`. A release returning a promise would be dropped there un-awaited, and the lock
   * would stay held past the end of the call that took it.
   */
  acquire(): Promise<() => void>
  /** Leaves the election: hands over if leading, stops the timers, closes the channel. */
  close(): void
}

/**
 * Builds a running lock. It starts electing immediately.
 *
 * Auto-starting is the safe default in both directions: a lock that had to be started
 * separately would, if the call were forgotten, sit in `idle` forever — never leading, so
 * never submitting, and the failure would look exactly like another tab holding the lock.
 * Starting an election costs one broadcast.
 */
export function createSessionLock(options: SessionLockOptions = {}): SessionLock {
  const now = options.now ?? Date.now
  const timer = options.timer ?? REAL_TIMER

  // Field by field with `??`, NOT a spread. `{...DEFAULT, ...{ electionMs: undefined }}` yields
  // `electionMs: undefined` — a key that is present and empty overrides the default rather than
  // falling back to it, which is how a caller building options conditionally
  // (`{ electionMs: opts.fast ? 50 : undefined }`) ends up with NaN deadlines.
  const supplied = options.timings ?? {}
  const timings: LockTimings = {
    electionMs: supplied.electionMs ?? DEFAULT_LOCK_TIMINGS.electionMs,
    heartbeatMs: supplied.heartbeatMs ?? DEFAULT_LOCK_TIMINGS.heartbeatMs,
    takeoverMs: supplied.takeoverMs ?? DEFAULT_LOCK_TIMINGS.takeoverMs,
  }

  // FINITE, checked explicitly, because the two non-finite values fail in opposite and equally
  // bad directions and neither is caught by a comparison. `NaN` makes every deadline NaN, and
  // `now < NaN` is false — so every tick fires the transition and the machine churns forever,
  // promoting on the first one. `Infinity` on `takeoverMs` means a dead leader is never
  // replaced and no tab ever submits again. Comparisons alone catch neither: `NaN > 0` is false
  // (so the positive check would reject it as "non-positive", naming the wrong problem) and
  // `Infinity >= heartbeat * 3` passes.
  for (const [name, value] of Object.entries(timings)) {
    if (!Number.isFinite(value)) {
      throw new Error(`refusing a lock whose ${name} is ${String(value)}: every interval must be a finite number`)
    }
  }
  if (!(timings.electionMs > 0) || !(timings.heartbeatMs > 0) || !(timings.takeoverMs > 0)) {
    throw new Error(`refusing a lock with a non-positive interval: ${JSON.stringify(timings)}`)
  }
  if (timings.electionMs < timings.heartbeatMs) {
    // See `DEFAULT_LOCK_TIMINGS`. An election shorter than the heartbeat interval can complete
    // without a live leader having had an opportunity to emit a single beat, so a tab opening
    // beside a throttled leader promotes next to it.
    throw new Error(
      `refusing an election window of ${timings.electionMs}ms against a ${timings.heartbeatMs}ms ` +
        'heartbeat: it must be at least one heartbeat, or a tab opening beside a throttled ' +
        'leader promotes without ever having had the chance to hear it',
    )
  }
  if (timings.takeoverMs < timings.heartbeatMs * 3) {
    // Refused rather than clamped. A takeover window under three heartbeats makes an ordinary
    // throttled background tab look dead, and the symptom — two tabs that intermittently both
    // believe they lead — is the exact failure this module exists to make impossible. A silent
    // clamp would hide the misconfiguration in the one place it must not be hidden.
    throw new Error(
      `refusing a takeover window of ${timings.takeoverMs}ms against a ${timings.heartbeatMs}ms ` +
        'heartbeat: it must be at least three heartbeats, or a merely slow leader gets deposed',
    )
  }

  // The clock is a seam too, and every deadline in the machine is `now() + interval`. A clock
  // answering NaN makes each one NaN, and `now < NaN` is false — so every tick fires its
  // transition and the very first one promotes this tab. Checked once, here, rather than on
  // every read: a clock that is broken at construction is broken.
  const startedAt = now()
  if (!Number.isFinite(startedAt)) {
    throw new Error(`refusing a lock whose clock answered ${String(startedAt)}: now() must return a finite number`)
  }

  const id = options.id ?? newTabId()

  // NO TRANSPORT MEANS NO LEADER, EVER — a refusing lock, not a boot crash and not a silent
  // no-op channel. The no-op is the dangerous one and it is what a "graceful degradation"
  // instinct reaches for: with a channel that drops every message, every tab hears silence,
  // every tab wins its own election, and every tab submits. That is the precise failure this
  // module exists to prevent, arriving through the code path that was trying to be helpful.
  // Throwing at construction is merely unhelpful — it takes down a page over a feature check.
  // So: the lock exists, it never leads, and every acquire says why.
  if (!options.channel && typeof BroadcastChannel !== 'function') {
    const refuse = async (): Promise<() => void> => {
      throw new Error(SUBMIT_LOCK_NO_CHANNEL)
    }
    const dead = initialLockState({ id, startedAt }, timings)
    return { id, state: () => dead, isLeader: () => false, acquire: refuse, close: () => {} }
  }

  const channel = options.channel ?? broadcastLockChannel(options.channelName ?? DEFAULT_LOCK_CHANNEL)

  let state = initialLockState({ id, startedAt }, timings)
  let handle: unknown
  let closed = false
  /** Grants issued by this lock. The generation a release is scoped to — see `acquire`. */
  let grants = 0
  /** Callers parked inside `acquire` waiting for the election to resolve. See `acquire`. */
  let electionWaiters: Array<() => void> = []

  const wakeElectionWaiters = () => {
    if (electionWaiters.length === 0) return
    const waiting = electionWaiters
    electionWaiters = []
    for (const wake of waiting) wake()
  }

  const schedule = () => {
    if (handle !== undefined) {
      timer.clearTimeout(handle)
      handle = undefined
    }
    // A faulted machine has nothing left to wait for — the reducer swallows every event it can
    // receive. Arming a timer for it produces a zero-delay callback that transitions nothing
    // and immediately re-arms: a spin that runs until the tab is closed.
    if (closed || state.role === 'idle' || state.fault !== null) return
    handle = timer.setTimeout(() => {
      handle = undefined
      dispatch({ type: 'tick' })
    }, Math.max(0, state.expiresAt - now()))
  }

  const dispatch = (event: LockEvent) => {
    if (closed) return
    const transition = reduceLock(state, event, now())
    state = transition.state
    // Anyone waiting on the election now has their answer, whichever way it went.
    if (state.role !== 'electing') wakeElectionWaiters()
    for (const message of transition.send) {
      try {
        channel.post(message)
      } catch (e) {
        // A post can fail on a channel the browser tore down while this tab was unloading.
        // Losing a heartbeat is what takeover already handles, so this must not become an
        // exception thrown out of a timer callback, where nothing would catch it.
        console.warn(`session lock: broadcasting ${message.type} failed and was ignored: ${String(e)}`)
      }
    }
    schedule()
  }

  channel.listen((message) => dispatch(message))
  dispatch({ type: 'start' })

  return {
    id,
    state: () => state,
    isLeader: () => isLeader(state),

    acquire: async () => {
      if (closed) throw new Error(SUBMIT_LOCK_CLOSED)

      // WAIT OUT AN ELECTION IN PROGRESS RATHER THAN LIE ABOUT IT.
      //
      // Refusing here used to throw `ACCOUNT_OPEN_IN_ANOTHER_TAB`, and for the whole election
      // window that sentence is a factual claim nobody has checked: a lone tab whose user clicks
      // "create account" within a second of the page loading was told another tab was submitting
      // when there was no other tab. Being wrong about that is worse than being slow — it sends
      // someone hunting through their windows for a tab that does not exist, and it teaches them
      // the message is noise for the time it is true.
      //
      // The wait is BOUNDED by the election deadline the machine is already counting down; the
      // timer that promotes or demotes this tab is what wakes the waiter. Nothing new can hang
      // here that would not also have hung the election itself, and `close()` wakes waiters too,
      // so a lock torn down mid-wait rejects rather than parking the caller forever.
      if (state.role === 'electing') {
        await new Promise<void>((resolve) => electionWaiters.push(resolve))
        if (closed) throw new Error(SUBMIT_LOCK_CLOSED)
      }

      // The fail-closed line. Anything that is not established leadership — following, idle,
      // faulted, or an election that resolved the other way — refuses, with the sentence the
      // user reads. By this point it is true.
      if (!isLeader(state)) throw new Error(ACCOUNT_OPEN_IN_ANOTHER_TAB)
      // Reentrancy is refused rather than counted. The seam hands back one release per
      // acquire and `register.ts` calls it in a `finally`, so a nested acquire would produce
      // two releases for one hold and the first `finally` to run would free the lock while the
      // outer call is still submitting. A caller that needs to nest has a structural problem
      // this module should surface, not paper over.
      if (state.held) throw new Error(SUBMIT_LOCK_ALREADY_HELD)

      // EVERY GRANT GETS ITS OWN NUMBER, and a release only frees the grant it came from.
      //
      // Without this the flag is global and a STALE release frees somebody else's hold. The
      // sequence is real and it runs entirely through supported transitions: this tab is
      // leading and holding, a competing `leader` message deposes it (the reducer clears `held`
      // on the way down, because a follower holding a submit lock is not a state that should
      // exist), it wins the seat back, a second registration acquires — and only then does the
      // FIRST registration's `finally` fire. A bare `held = false` there unlocks the second
      // registration's hold from under it, and a third acquire is granted while two submissions
      // are in flight. Which is a double registration: exactly what the lock is for.
      //
      // Comparing epochs also subsumes the "a release is idempotent" rule, so there is one
      // mechanism rather than two: a second call of the same release finds its epoch current
      // and clears an already-clear flag, and any call after a newer grant finds it stale.
      const epoch = ++grants
      state = { ...state, held: true }
      return () => {
        if (epoch !== grants) return
        state = { ...state, held: false }
      }
    },

    close: () => {
      if (closed) return
      closed = true
      if (handle !== undefined) {
        timer.clearTimeout(handle)
        handle = undefined
      }
      if (isLeader(state)) {
        try {
          channel.post({ type: 'released', id, startedAt: state.self.startedAt })
        } catch (e) {
          // The handover is an optimisation over takeover, so failing to send it costs the
          // other tabs `takeoverMs` and nothing else.
          console.warn(`session lock: broadcasting the handover failed and was ignored: ${String(e)}`)
        }
      }
      state = { ...state, role: 'idle', leader: null, held: false }
      // Anyone parked in `acquire` waiting for the election gets woken to find a closed lock,
      // rather than waiting on a timer that will never fire again.
      wakeElectionWaiters()
      try {
        channel.close()
      } catch (e) {
        console.warn(`session lock: closing the channel threw and was ignored: ${String(e)}`)
      }
    },
  }
}

/**
 * The adapter for `register.ts`'s frozen seam.
 *
 * `RegisterDeps.acquireSubmitLock` is declared `() => Promise<() => void>` and this matches it
 * exactly, which is the entire point: `register.ts` is not edited, does not import this module,
 * and does not know a leader election exists. It already turns a throwing acquire into
 * `{ kind: 'lock-unavailable', reason: String(e) }`, so a follower's refusal arrives at the UI
 * as a typed failure carrying `ACCOUNT_OPEN_IN_ANOTHER_TAB` verbatim inside the reason.
 */
export function makeAcquireSubmitLock(lock: Pick<SessionLock, 'acquire'>): () => Promise<() => void> {
  return () => lock.acquire()
}
