import { describe, it, expect, afterEach } from 'vitest'
import {
  beatsInLockOrder,
  createSessionLock,
  DEFAULT_LOCK_TIMINGS,
  initialLockState,
  isLeader,
  makeAcquireSubmitLock,
  parseLockMessage,
  reduceLock,
  DUPLICATE_TAB_ID,
  SUBMIT_LOCK_ALREADY_HELD,
  SUBMIT_LOCK_CLOSED,
  SUBMIT_LOCK_NO_CHANNEL,
  type LockChannel,
  type LockMessage,
  type LockPeer,
  type LockState,
  type LockTimings,
  type SessionLock,
} from '../src/session-lock.js'
import { ACCOUNT_OPEN_IN_ANOTHER_TAB } from '../src/session-copy.js'
import type { DeadlineTimer } from '../src/register.js'

// ── The pure core ─────────────────────────────────────────────────────────────────────────

// Three distinct values, all satisfying the two construction rules (election >= heartbeat,
// takeover >= 3 heartbeats), so a test asserting on one interval cannot pass by coincidence
// against another. Every clock in this file is hand-driven, so the magnitudes cost nothing.
const TIMINGS: LockTimings = { electionMs: 600, heartbeatMs: 500, takeoverMs: 2_000 }
const SELF: LockPeer = { id: 'self', startedAt: 1_000 }
// Distinct ids as well as distinct times: several tests turn on whether a message came from
// the tab we are following or from a stranger, and a shared id would make those pass by
// accident in one direction and fail in the other.
const EARLIER: LockPeer = { id: 'earlier-tab', startedAt: 500 }
const LATER: LockPeer = { id: 'later-tab', startedAt: 5_000 }

const at = (role: LockState['role'], over: Partial<LockState> = {}): LockState => ({
  ...initialLockState(SELF, TIMINGS),
  role,
  ...over,
})

const claimFrom = (p: LockPeer): LockMessage => ({ type: 'claim', id: p.id, startedAt: p.startedAt })
const leaderFrom = (p: LockPeer): LockMessage => ({ type: 'leader', id: p.id, startedAt: p.startedAt })
const releasedFrom = (p: LockPeer): LockMessage => ({ type: 'released', id: p.id, startedAt: p.startedAt })

describe('the total order on tabs is deterministic and antisymmetric', () => {
  it('an earlier start wins', () => {
    expect(beatsInLockOrder(EARLIER, SELF)).toBe(true)
    expect(beatsInLockOrder(SELF, EARLIER)).toBe(false)
  })

  it('the id breaks a tie — two tabs opened by one click share a millisecond', () => {
    // Without a second key both would conclude the other does not beat them, and both promote.
    const a = { id: 'aaa', startedAt: 1_000 }
    const b = { id: 'bbb', startedAt: 1_000 }
    expect(beatsInLockOrder(a, b)).toBe(true)
    expect(beatsInLockOrder(b, a)).toBe(false)
  })

  it('nobody beats themselves', () => {
    expect(beatsInLockOrder(SELF, { ...SELF })).toBe(false)
  })
})

describe('the election reducer is pure and fails closed (AC2)', () => {
  it('start announces and waits: electing, never leading', () => {
    const { state, send } = reduceLock(initialLockState(SELF, TIMINGS), { type: 'start' }, 1_000)
    expect(state.role).toBe('electing')
    expect(isLeader(state)).toBe(false)
    expect(state.expiresAt).toBe(1_000 + TIMINGS.electionMs)
    expect(send).toEqual([claimFrom(SELF)])
  })

  it('silence BEFORE the deadline is a follower, not a leader', () => {
    const electing = at('electing', { expiresAt: 1_250 })
    const { state, send } = reduceLock(electing, { type: 'tick' }, 1_249)
    expect(state).toBe(electing)
    expect(isLeader(state)).toBe(false)
    expect(send).toEqual([])
  })

  it('ANSWERED silence promotes: the deadline passes and this tab leads', () => {
    const { state, send } = reduceLock(at('electing', { expiresAt: 1_250 }), { type: 'tick' }, 1_250)
    expect(isLeader(state)).toBe(true)
    expect(state.leader).toEqual(SELF)
    expect(state.expiresAt).toBe(1_250 + TIMINGS.heartbeatMs)
    expect(send).toEqual([leaderFrom(SELF)])
  })

  it('an idle machine never promotes, whatever the clock says', () => {
    const { state, send } = reduceLock(initialLockState(SELF, TIMINGS), { type: 'tick' }, 9e12)
    expect(state.role).toBe('idle')
    expect(isLeader(state)).toBe(false)
    expect(send).toEqual([])
  })

  it('a contested claim we lose makes us a follower waiting on their heartbeat', () => {
    const { state, send } = reduceLock(at('electing', { expiresAt: 1_250 }), claimFrom(EARLIER), 1_100)
    expect(state.role).toBe('follower')
    expect(state.leader).toEqual(EARLIER)
    expect(state.expiresAt).toBe(1_100 + TIMINGS.takeoverMs)
    expect(send).toEqual([])
  })

  it('a contested claim we win is RE-SENT, because the latecomer never heard the first one', () => {
    // A BroadcastChannel delivers only to channels open at post time. Without the re-send the
    // later tab hears nothing, promotes on its own silence, and there are two leaders.
    const { state, send } = reduceLock(at('electing', { expiresAt: 1_250 }), claimFrom(LATER), 1_100)
    expect(state.role).toBe('electing')
    expect(send).toEqual([claimFrom(SELF)])
  })

  it('the re-send terminates: the loser answers a claim with a LEADER message, not another claim', () => {
    // Two claims would ping-pong. The loser is a follower by now and answers on its leader's
    // behalf, and a `leader` message provokes no reply from anyone — so the exchange ends.
    const loser = reduceLock(at('electing'), claimFrom(EARLIER), 1_100)
    const answer = reduceLock(loser.state, claimFrom(LATER), 1_200)
    expect(answer.send).toEqual([leaderFrom(EARLIER)])
    // And the answer names the LEADER, never the follower sending it.
    expect(answer.send[0]!.id).not.toBe(SELF.id)
    // A `leader` message is where it stops.
    expect(reduceLock(answer.state, leaderFrom(EARLIER), 1_300).send).toEqual([])
  })

  it('an incumbent leader answers a claim instead of standing down for it', () => {
    // Even from a tab that beats it on the total order. Standing down would empty the seat
    // while the claimant is still only a candidate.
    const { state, send } = reduceLock(at('leader', { leader: SELF }), claimFrom(EARLIER), 1_100)
    expect(isLeader(state)).toBe(true)
    expect(send).toEqual([leaderFrom(SELF)])
  })

  it('a follower ANSWERS a claim on its leader behalf — the throttled-leader fix (S3)', () => {
    // The rule this replaces was "stay quiet, the leader will answer", which assumed a
    // responsive leader. A throttled one is exactly the leader that does not answer, and it is
    // alive — so the newcomer heard silence and promoted beside it. A follower is not throttled
    // at the same instant and already knows who leads, so it relays the fact.
    const follower = at('follower', { leader: EARLIER, expiresAt: 4_600 })
    const { state, send } = reduceLock(follower, claimFrom(LATER), 1_200)
    // It relays; it does not claim the seat, and its own takeover clock is untouched.
    expect(send).toEqual([leaderFrom(EARLIER)])
    expect(state).toBe(follower)
    expect(state.expiresAt).toBe(4_600)
  })

  it('a follower with no leader in mind says nothing — it has no fact to relay', () => {
    const rudderless = at('follower', { leader: null, expiresAt: 4_600 })
    const { state, send } = reduceLock(rudderless, claimFrom(LATER), 1_200)
    expect(state).toBe(rudderless)
    expect(send).toEqual([])
  })

  it('an idle machine answers nothing at all', () => {
    const idle = initialLockState(SELF, TIMINGS)
    expect(reduceLock(idle, claimFrom(LATER), 1_200).send).toEqual([])
    // And overhearing a leader does not quietly enlist it — its next tick would otherwise
    // carry it into an election it was never told to join.
    const heard = reduceLock(idle, leaderFrom(EARLIER), 1_200)
    expect(heard.state).toBe(idle)
    expect(heard.state.role).toBe('idle')
    expect(reduceLock(heard.state, { type: 'tick' }, 9e12).state.role).toBe('idle')
  })

  it('an established leader outranks a candidate: a leader message ends our election', () => {
    const { state, send } = reduceLock(at('electing', { expiresAt: 1_250 }), leaderFrom(LATER), 1_100)
    expect(state.role).toBe('follower')
    expect(state.leader).toEqual(LATER)
    expect(send).toEqual([])
  })

  it('a heartbeat resets the takeover clock — that is what makes it a heartbeat', () => {
    const follower = at('follower', { leader: EARLIER, expiresAt: 4_600 })
    const { state } = reduceLock(follower, leaderFrom(EARLIER), 2_000)
    expect(state.expiresAt).toBe(2_000 + TIMINGS.takeoverMs)
  })

  it('a leader keeps beating, and keeps leading', () => {
    const { state, send } = reduceLock(at('leader', { leader: SELF, expiresAt: 2_000 }), { type: 'tick' }, 2_000)
    expect(isLeader(state)).toBe(true)
    expect(state.expiresAt).toBe(2_000 + TIMINGS.heartbeatMs)
    expect(send).toEqual([leaderFrom(SELF)])
  })

  it('a leader that vanishes is taken over only after the full window', () => {
    const follower = at('follower', { leader: EARLIER, expiresAt: 4_600 })
    expect(reduceLock(follower, { type: 'tick' }, 4_599).state).toBe(follower)

    const { state, send } = reduceLock(follower, { type: 'tick' }, 4_600)
    expect(state.role).toBe('electing')
    expect(state.leader).toBeNull()
    // An election, not a promotion: two followers waking together still produce one leader.
    expect(isLeader(state)).toBe(false)
    expect(send).toEqual([claimFrom(SELF)])
  })

  it('a graceful handover reopens the election without waiting out the takeover window', () => {
    const follower = at('follower', { leader: EARLIER, expiresAt: 4_600 })
    const { state, send } = reduceLock(follower, releasedFrom(EARLIER), 1_200)
    expect(state.role).toBe('electing')
    expect(state.expiresAt).toBe(1_200 + TIMINGS.electionMs)
    expect(state.expiresAt).toBeLessThan(follower.expiresAt)
    expect(send).toEqual([claimFrom(SELF)])
  })

  it("somebody else's leader leaving does not disturb our own takeover clock", () => {
    const follower = at('follower', { leader: EARLIER, expiresAt: 4_600 })
    expect(reduceLock(follower, releasedFrom(LATER), 1_200).state).toBe(follower)
  })

  it('two tabs asserting leadership resolve by the same total order on both sides', () => {
    // Unreachable in the protocol as written, and handled as the thing that must never
    // PERSIST: the loser stands down, so the split lasts exactly one message.
    const loser = reduceLock(at('leader', { leader: SELF, held: true }), leaderFrom(EARLIER), 2_000)
    expect(loser.state.role).toBe('follower')
    expect(loser.state.held).toBe(false)

    const winner = reduceLock(at('leader', { leader: SELF }), leaderFrom(LATER), 2_000)
    expect(isLeader(winner.state)).toBe(true)
    expect(winner.send).toEqual([leaderFrom(SELF)])
  })

  it('ignores our own echo — same id AND same startedAt — whatever the transport does', () => {
    for (const message of [claimFrom(SELF), leaderFrom(SELF), releasedFrom(SELF)]) {
      const electing = at('electing', { expiresAt: 1_250 })
      expect(reduceLock(electing, message, 1_100).state).toBe(electing)
    }
  })

  it('a repeated handover does not push an election out forever', () => {
    // The starvation this closes: resetting the deadline on every `released` means a channel
    // carrying handovers — several tabs closing in sequence, or one misbehaving script — keeps
    // this candidate one `electionMs` away from promoting, indefinitely.
    let state = at('electing', { expiresAt: 1_250 })
    for (let i = 0; i < 5; i++) {
      const step = reduceLock(state, releasedFrom(EARLIER), 1_100 + i)
      state = step.state
      expect(step.send).toEqual([])
    }
    expect(state.expiresAt).toBe(1_250)
    // And the deadline it started with still promotes it.
    expect(isLeader(reduceLock(state, { type: 'tick' }, 1_250).state)).toBe(true)
  })

  it('a handover to a machine nobody started does not start one', () => {
    const idle = initialLockState(SELF, TIMINGS)
    const step = reduceLock(idle, releasedFrom(EARLIER), 1_100)
    expect(step.state).toBe(idle)
    expect(step.state.role).toBe('idle')
    expect(step.send).toEqual([])
  })

  it('restarting clears a hold, so a lock is not left permanently refusing', () => {
    // `held` is only ever cleared by the release belonging to that grant. Carrying it across a
    // restart would strand it: the grant is gone, so nothing can ever clear the flag, and every
    // acquire from then on reports the lock as already held.
    const { state } = reduceLock(at('leader', { leader: SELF, held: true }), { type: 'start' }, 2_000)
    expect(state.held).toBe(false)
    expect(state.role).toBe('electing')
  })
})

describe('two tabs sharing an id both stand down (R7)', () => {
  // The id is half the total order, so two tabs holding one cannot be separated by it — and the
  // self-echo guard makes each DROP the other's messages as its own, so neither hears an
  // objection and both promote on silence. A permanent split, arrived at quietly.
  const impostor = (type: LockMessage['type']): LockMessage => ({
    type,
    id: SELF.id,
    startedAt: SELF.startedAt + 500,
  })

  for (const type of ['claim', 'leader', 'released'] as const) {
    it(`detects it on a ${type} carrying our id and somebody else's start time`, () => {
      const { state, send } = reduceLock(at('electing', { expiresAt: 1_250 }), impostor(type), 1_100)
      expect(state.role).toBe('follower')
      expect(state.fault).toBe(DUPLICATE_TAB_ID)
      expect(isLeader(state)).toBe(false)
      expect(send).toEqual([])
    })
  }

  it('stands a LEADER down and clears its hold', () => {
    const { state } = reduceLock(at('leader', { leader: SELF, held: true }), impostor('leader'), 1_100)
    expect(state.role).toBe('follower')
    expect(state.held).toBe(false)
    expect(state.fault).toBe(DUPLICATE_TAB_ID)
  })

  it('never leads again — not on a tick, not on a takeover, not on a handover', () => {
    const faulted = reduceLock(at('electing', { expiresAt: 1_250 }), impostor('claim'), 1_100).state
    for (const event of [
      { type: 'tick' } as const,
      releasedFrom(EARLIER),
      claimFrom(LATER),
      leaderFrom(EARLIER),
    ]) {
      const step = reduceLock(faulted, event, 9_999_999)
      expect(step.state).toBe(faulted)
      expect(isLeader(step.state)).toBe(false)
      expect(step.send).toEqual([])
    }
  })

  it('`start` does not un-fault it either — permanent means permanent (S2)', () => {
    // The start exemption contradicted the word and did real damage: a faulted machine would
    // broadcast a claim it can never honour (its ticks are swallowed, so it can never promote),
    // and a legitimate candidate that heard that claim would stand down and wait out
    // `takeoverMs` for a leader that is never coming.
    const faulted = reduceLock(at('electing', { expiresAt: 1_250 }), impostor('claim'), 1_100).state
    const restarted = reduceLock(faulted, { type: 'start' }, 2_000)
    expect(restarted.state).toBe(faulted)
    expect(restarted.send).toEqual([])
    expect(restarted.state.fault).toBe(DUPLICATE_TAB_ID)
    expect(isLeader(restarted.state)).toBe(false)
  })

  it('parks its deadline, so nothing is left for a timer to fire on (S1)', () => {
    const faulted = reduceLock(at('electing', { expiresAt: 1_250 }), impostor('claim'), 1_100).state
    expect(faulted.expiresAt).toBe(0)
  })

  it('both sides of the collision stand down, so nobody submits', () => {
    // Symmetric by construction: each tab sees its own id with a startedAt that is not its own.
    const one = { id: 'shared', startedAt: 1_000 }
    const two = { id: 'shared', startedAt: 1_400 }
    const oneState = reduceLock(
      { ...initialLockState(one, TIMINGS), role: 'electing', expiresAt: 1_250 },
      claimFrom(two),
      1_100,
    ).state
    const twoState = reduceLock(
      { ...initialLockState(two, TIMINGS), role: 'electing', expiresAt: 1_650 },
      claimFrom(one),
      1_500,
    ).state
    expect(oneState.fault).toBe(DUPLICATE_TAB_ID)
    expect(twoState.fault).toBe(DUPLICATE_TAB_ID)
    expect([isLeader(oneState), isLeader(twoState)]).toEqual([false, false])
  })

  it('never mutates the state it was given', () => {
    const before = at('electing', { expiresAt: 1_250 })
    const snapshot = JSON.stringify(before)
    reduceLock(before, { type: 'tick' }, 9_999)
    reduceLock(before, claimFrom(EARLIER), 9_999)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('what arrives off the channel is validated before the reducer sees it', () => {
  it('accepts the three real messages', () => {
    expect(parseLockMessage({ type: 'claim', id: 'a', startedAt: 1 })).toEqual(claimFrom({ id: 'a', startedAt: 1 }))
    expect(parseLockMessage({ type: 'leader', id: 'a', startedAt: 1 })?.type).toBe('leader')
    expect(parseLockMessage({ type: 'released', id: 'a', startedAt: 1 })?.type).toBe('released')
  })

  for (const [name, value] of [
    ['null', null],
    ['a string', 'claim'],
    ['an unknown type', { type: 'coup', id: 'a', startedAt: 1 }],
    ['a missing id', { type: 'claim', startedAt: 1 }],
    ['an empty id', { type: 'claim', id: '', startedAt: 1 }],
    ['a missing timestamp', { type: 'claim', id: 'a' }],
    // Every total-order comparison against NaN is false, so this one would hand leadership
    // to whoever sent it.
    ['a NaN timestamp', { type: 'claim', id: 'a', startedAt: Number.NaN }],
    ['a timestamp that is a string', { type: 'claim', id: 'a', startedAt: '1' }],
  ] as const) {
    it(`rejects ${name}`, () => {
      expect(parseLockMessage(value)).toBeNull()
    })
  }
})

// ── The running lock, over two real BroadcastChannel instances ────────────────────────────

/**
 * Every message this file's channels have delivered. The drain loop below watches it, so
 * "the channel is quiet" is an observation rather than a fixed number of turns.
 */
let messagesDelivered = 0

/** A hand-driven clock and timer. No test in this file waits on real time. */
function testClock(start = 1_000) {
  let clock = start
  let seq = 0
  const pending = new Map<number, { at: number; fn: () => void }>()

  const timer: DeadlineTimer = {
    setTimeout: (fn, ms) => {
      const handle = ++seq
      pending.set(handle, { at: clock + ms, fn })
      return handle
    },
    clearTimeout: (handle) => void pending.delete(handle as number),
  }

  /** One macrotask turn — what a BroadcastChannel needs to deliver. Zero milliseconds. */
  const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  /**
   * Runs the channel to quiet before any timer fires, which is what the real thing does.
   *
   * A BroadcastChannel delivers in well under a millisecond and the election window is 250 of
   * them, so in a browser a claim always lands long before the deadline it is racing. Firing a
   * timer while a claim is still in flight would be testing a transport this protocol does not
   * run on, and the transient it produces is an artifact of the harness rather than a fact
   * about the election.
   */
  const drain = async () => {
    for (let i = 0; i < 40; i++) {
      const before = messagesDelivered
      await turn()
      if (messagesDelivered === before) return
    }
    throw new Error('the channel never went quiet: the tabs are talking in a loop')
  }

  /** Deliver messages and fire due timers until nothing is left to do at this instant. */
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      await drain()
      const due = [...pending].filter(([, s]) => s.at <= clock)
      if (due.length === 0) return
      for (const [handle, s] of due) {
        pending.delete(handle)
        s.fn()
      }
    }
    throw new Error('the lock never settled: a transition is scheduling work at the same instant')
  }

  return {
    timer,
    now: () => clock,
    settle,
    /** How many timers are armed. A lock with nothing to wait for must have none. */
    pendingCount: () => pending.size,
    advance: async (ms: number) => {
      clock += ms
      await settle()
    },
  }
}

/** A channel over a real BroadcastChannel that can also be killed, to model a crashed tab. */
function testChannel(name: string) {
  const bc = new BroadcastChannel(name)
  let dead = false
  const channel: LockChannel = {
    post: (message) => {
      if (!dead) bc.postMessage(message)
    },
    listen: (handler) => {
      bc.onmessage = (event: MessageEvent) => {
        if (dead) return
        const message = parseLockMessage(event.data)
        if (!message) return
        messagesDelivered += 1
        handler(message)
      }
    },
    close: () => bc.close(),
  }
  return {
    channel,
    /** Stop talking and stop listening, without the graceful handover. A killed tab. */
    kill: () => {
      dead = true
    },
    close: () => bc.close(),
  }
}

describe('two lock instances on one channel (AC2)', () => {
  const opened: Array<{ lock?: SessionLock; wire: ReturnType<typeof testChannel> }> = []
  let channelSeq = 0

  afterEach(() => {
    for (const o of opened) {
      try {
        o.lock?.close()
      } catch {
        // Already closed by the test; closing twice is a no-op and must not fail teardown.
      }
      o.wire.close()
    }
    opened.length = 0
  })

  /**
   * Opens tabs on ONE channel, and hands back the opener so a later test can add another to
   * the same one. The channel name is unique per group so tests cannot leak into each other.
   */
  function group(clock: ReturnType<typeof testClock>) {
    const name = `passbook.test-lock-${process.pid}-${++channelSeq}`
    const open = (id: string) => {
      const wire = testChannel(name)
      const lock = createSessionLock({
        id,
        channel: wire.channel,
        timings: TIMINGS,
        now: clock.now,
        timer: clock.timer,
      })
      const tab = { lock, wire }
      opened.push(tab)
      return tab
    }
    return { open, tabs: (...ids: string[]) => ids.map(open) }
  }

  it('a quiet channel promotes the single tab after the election window', async () => {
    const clock = testClock()
    const [a] = group(clock).tabs('solo')
    await clock.settle()
    expect(a!.lock.isLeader()).toBe(false)

    await clock.advance(TIMINGS.electionMs - 1)
    expect(a!.lock.isLeader()).toBe(false)

    await clock.advance(1)
    expect(a!.lock.isLeader()).toBe(true)
  })

  it('a contested election produces exactly one leader, and never two at any point', async () => {
    const clock = testClock()
    // Constructed in the order 'zzz', then 'aaa' — so a leader chosen by the TOTAL ORDER and
    // one chosen by arrival order are different tabs, and the assertion can tell them apart.
    const [z, a] = group(clock).tabs('zzz-tab', 'aaa-tab')

    const everSplit: string[] = []
    const sample = (where: string) => {
      if (z!.lock.isLeader() && a!.lock.isLeader()) everSplit.push(where)
    }

    await clock.settle()
    sample('after the claims')
    for (let step = 0; step < 12; step++) {
      await clock.advance(TIMINGS.electionMs)
      sample(`step ${step}`)
    }

    expect(everSplit).toEqual([])
    expect(a!.lock.isLeader()).toBe(true)
    expect(z!.lock.isLeader()).toBe(false)
    expect(z!.lock.state().leader?.id).toBe('aaa-tab')
  })

  it('a tab that starts LATER still loses to the earlier one, via the re-sent claim', async () => {
    // The later tab was not listening when the first claim went out, so the only way it learns
    // it lost is the incumbent answering its claim.
    const clock = testClock()
    const { open } = group(clock)
    const first = open('first')
    await clock.settle()

    // Opened onto the same channel afterwards, so it genuinely missed the first claim.
    const second = open('second')
    await clock.advance(TIMINGS.electionMs)

    expect(first.lock.isLeader()).toBe(true)
    expect(second.lock.isLeader()).toBe(false)
    expect(second.lock.state().leader?.id).toBe('first')
  })

  it('the follower refuses the submit lock with the byte-exact sentence (AC3)', async () => {
    const clock = testClock()
    const [z, a] = group(clock).tabs('zzz-tab', 'aaa-tab')
    await clock.advance(TIMINGS.electionMs)

    expect(a!.lock.isLeader()).toBe(true)
    await expect(z!.lock.acquire()).rejects.toThrow(
      expect.objectContaining({ message: ACCOUNT_OPEN_IN_ANOTHER_TAB }),
    )
    // Byte for byte, not merely "contains".
    const error = await z!.lock.acquire().catch((e: Error) => e)
    expect((error as Error).message).toBe(ACCOUNT_OPEN_IN_ANOTHER_TAB)
  })

  it('acquiring DURING an election waits for it, then grants — no false claim about a tab (S5)', async () => {
    // Refusing here used to throw "This account is open in another tab", which for the whole
    // election window is a factual claim nobody has checked. A lone tab whose user clicks
    // within a second of load was told about a tab that does not exist.
    const clock = testClock()
    const [a] = group(clock).tabs('solo')
    await clock.settle()
    expect(a!.lock.state().role).toBe('electing')

    let settled: 'pending' | 'granted' | 'refused' = 'pending'
    const pending = a!.lock
      .acquire()
      .then((release) => {
        settled = 'granted'
        return release
      })
      .catch(() => {
        settled = 'refused'
        return () => {}
      })

    // Still waiting — it has neither granted nor lied.
    await clock.settle()
    expect(settled).toBe('pending')

    await clock.advance(TIMINGS.electionMs)
    const release = await pending
    expect(settled).toBe('granted')
    expect(a!.lock.state().held).toBe(true)
    release()
  })

  it('acquiring during an election this tab LOSES refuses, and only then (S5)', async () => {
    const clock = testClock()
    const [z, a] = group(clock).tabs('zzz-tab', 'aaa-tab')
    // Grab the follower-to-be while it is still electing, before it has heard anything.
    await Promise.resolve()
    const attempt = z!.lock.acquire().catch((e: Error) => e)

    await clock.advance(TIMINGS.electionMs)
    expect(a!.lock.isLeader()).toBe(true)

    const error = await attempt
    expect(error).toBeInstanceOf(Error)
    // NOW the sentence is true, and it is byte-exact.
    expect((error as Error).message).toBe(ACCOUNT_OPEN_IN_ANOTHER_TAB)
  })

  it('a lock closed while a caller is waiting on the election wakes it rather than parking it', async () => {
    const clock = testClock()
    const [a] = group(clock).tabs('solo')
    await clock.settle()
    expect(a!.lock.state().role).toBe('electing')

    const attempt = a!.lock.acquire().catch((e: Error) => e)
    a!.lock.close()
    const error = await attempt
    expect((error as Error).message).toBe(SUBMIT_LOCK_CLOSED)
  })

  it('a follower that has already lost refuses immediately, without waiting', async () => {
    const clock = testClock()
    const [z, a] = group(clock).tabs('zzz-tab', 'aaa-tab')
    await clock.advance(TIMINGS.electionMs)
    expect(z!.lock.state().role).toBe('follower')
    expect(a!.lock.isLeader()).toBe(true)
    // No clock advance between the call and the rejection: the answer is already known.
    await expect(z!.lock.acquire()).rejects.toThrow(ACCOUNT_OPEN_IN_ANOTHER_TAB)
  })

  it('the leader vanishing promotes exactly one follower, after the takeover window', async () => {
    const clock = testClock()
    const [z, a] = group(clock).tabs('zzz-tab', 'aaa-tab')
    await clock.advance(TIMINGS.electionMs)
    expect(a!.lock.isLeader()).toBe(true)

    a!.wire.kill() // the tab was killed: no handover, no heartbeats, no listening
    await clock.advance(TIMINGS.takeoverMs - 1)
    expect(z!.lock.isLeader()).toBe(false)

    await clock.advance(1)
    // Takeover opens an ELECTION rather than promoting, so a second follower would still have
    // to lose a contested claim before anybody leads.
    expect(z!.lock.state().role).toBe('electing')
    expect(z!.lock.isLeader()).toBe(false)

    await clock.advance(TIMINGS.electionMs)
    expect(z!.lock.isLeader()).toBe(true)
  })

  it('a merely slow leader is not deposed — three heartbeats of margin', async () => {
    const clock = testClock()
    const [z, a] = group(clock).tabs('zzz-tab', 'aaa-tab')
    await clock.advance(TIMINGS.electionMs)
    expect(a!.lock.isLeader()).toBe(true)

    // Two missed beats and the follower is still following. A background tab whose timers the
    // browser throttled, or a main thread that stalled, looks exactly like this.
    a!.wire.kill()
    await clock.advance(TIMINGS.heartbeatMs * 2)
    expect(z!.lock.state().role).toBe('follower')
    expect(z!.lock.isLeader()).toBe(false)
  })

  it('a tab opening beside a THROTTLED leader does not promote next to it (S3)', async () => {
    // The transient two-leader case. The leader is alive but its timers are not running — a
    // backgrounded tab, a suspended process, a stalled main thread. The newcomer would hear
    // nothing for its whole election and promote. The follower answers on the leader's behalf.
    const clock = testClock()
    const { open } = group(clock)
    const leader = open('aaa-tab')
    const follower = open('mmm-tab')
    await clock.advance(TIMINGS.electionMs)
    expect(leader.lock.isLeader()).toBe(true)
    expect(follower.lock.state().role).toBe('follower')

    // The leader stops talking, but is NOT dead — well inside the takeover window.
    leader.wire.kill()
    const newcomer = open('zzz-tab')
    await clock.advance(TIMINGS.electionMs)

    // The newcomer learned who leads from the follower, and stood down.
    expect(newcomer.lock.isLeader()).toBe(false)
    expect(newcomer.lock.state().leader?.id).toBe('aaa-tab')
    // And no second leader appeared anywhere.
    expect([leader.lock.isLeader(), follower.lock.isLeader(), newcomer.lock.isLeader()])
      .toEqual([true, false, false])
  })

  it('with NO follower to answer, the newcomer still promotes on a genuinely silent channel', async () => {
    // The other half of S3: the relay only helps when somebody is there to relay. A lone tab on
    // a quiet channel must still be able to lead, or the fix would deadlock a fresh browser.
    const clock = testClock()
    const [solo] = group(clock).tabs('solo')
    await clock.advance(TIMINGS.electionMs)
    expect(solo!.lock.isLeader()).toBe(true)
  })

  it('a graceful close hands over without the follower waiting out takeoverMs', async () => {
    const clock = testClock()
    const [z, a] = group(clock).tabs('zzz-tab', 'aaa-tab')
    await clock.advance(TIMINGS.electionMs)
    expect(a!.lock.isLeader()).toBe(true)
    const wouldHaveWaitedUntil = z!.lock.state().expiresAt

    a!.lock.close()
    await clock.settle()
    // Still an election, not a promotion — the handover only skips the waiting.
    expect(z!.lock.state().role).toBe('electing')

    await clock.advance(TIMINGS.electionMs)
    expect(z!.lock.isLeader()).toBe(true)
    // The whole point: it led well before the takeover window a crashed tab would have cost.
    expect(clock.now()).toBeLessThan(wouldHaveWaitedUntil)
  })

  it('a closed lock leads nothing and grants nothing', async () => {
    const clock = testClock()
    const [a] = group(clock).tabs('solo')
    await clock.advance(TIMINGS.electionMs)
    expect(a!.lock.isLeader()).toBe(true)

    a!.lock.close()
    expect(a!.lock.isLeader()).toBe(false)
    await expect(a!.lock.acquire()).rejects.toThrow(SUBMIT_LOCK_CLOSED)
    a!.lock.close() // idempotent
  })
})

describe('the REAL transport, with no channel injected (R3)', () => {
  // Every other suite in this file injects a `LockChannel` or re-implements the wrapper, which
  // left `broadcastLockChannel` — the one transport that ships — executed by nothing. Its
  // `onmessage` wiring, its `parseLockMessage` filter and its `close` are all real code that a
  // typo would break silently. These build locks the way epic 6 will: a channel NAME, and the
  // module constructs the BroadcastChannel itself.
  const live: SessionLock[] = []
  let n = 0

  afterEach(() => {
    for (const lock of live) lock.close()
    live.length = 0
  })

  function realTabs(clock: ReturnType<typeof testClock>, ids: string[]) {
    const channelName = `passbook.test-real-${process.pid}-${++n}`
    return ids.map((id) => {
      const lock = createSessionLock({ id, channelName, timings: TIMINGS, now: clock.now, timer: clock.timer })
      live.push(lock)
      return lock
    })
  }

  it('elects one leader over a genuine BroadcastChannel', async () => {
    const clock = testClock()
    const [zzz, aaa] = realTabs(clock, ['zzz-tab', 'aaa-tab'])
    await clock.advance(TIMINGS.electionMs)

    expect(aaa!.isLeader()).toBe(true)
    expect(zzz!.isLeader()).toBe(false)
    // The follower learned who leads, which it can only have done by receiving a real message.
    expect(zzz!.state().leader?.id).toBe('aaa-tab')
  })

  it('refuses the follower with the byte-exact sentence, end to end', async () => {
    const clock = testClock()
    const [zzz, aaa] = realTabs(clock, ['zzz-tab', 'aaa-tab'])
    await clock.advance(TIMINGS.electionMs)

    const release = await aaa!.acquire()
    const error = await zzz!.acquire().catch((e: Error) => e)
    expect((error as Error).message).toBe(ACCOUNT_OPEN_IN_ANOTHER_TAB)
    release()
  })

  it('the real wrapper filters garbage posted onto the channel by anything else', async () => {
    // A BroadcastChannel is reachable by every script on the origin. The wrapper's parse filter
    // is the only thing between that and the reducer.
    const clock = testClock()
    const [solo] = realTabs(clock, ['solo'])
    await clock.advance(TIMINGS.electionMs)
    expect(solo!.isLeader()).toBe(true)

    const intruder = new BroadcastChannel(`passbook.test-real-${process.pid}-${n}`)
    try {
      for (const junk of [null, 'claim', 42, { type: 'coup' }, { type: 'leader', id: '', startedAt: 0 }, {
        type: 'leader',
        id: 'x',
        startedAt: 'soon',
      }]) {
        intruder.postMessage(junk)
      }
      await clock.settle()
      // None of it reached the reducer, so the leader is untouched.
      expect(solo!.isLeader()).toBe(true)
      expect(solo!.state().leader?.id).toBe('solo')

      // And a WELL-FORMED message from the same channel does land, so the filter is a filter
      // and not a wall — otherwise the test above would pass on a wrapper that drops everything.
      intruder.postMessage({ type: 'leader', id: 'aaa-earlier', startedAt: 1 })
      await clock.settle()
      expect(solo!.isLeader()).toBe(false)
      expect(solo!.state().leader?.id).toBe('aaa-earlier')
    } finally {
      intruder.close()
    }
  })

  it('close() releases the underlying channel', async () => {
    const clock = testClock()
    const [solo] = realTabs(clock, ['solo'])
    await clock.advance(TIMINGS.electionMs)
    solo!.close()
    // A closed BroadcastChannel throws on post; the lock must already have stopped using it.
    expect(() => solo!.close()).not.toThrow()
    expect(solo!.isLeader()).toBe(false)
  })
})

describe('holding and releasing the submit lock (AC2)', () => {
  /**
   * A leader with no other tab on the channel, driven by a hand clock.
   *
   * `deliver` pushes a message in as though it had arrived off the wire, and `posted` records
   * what went out — the channel is a seam, so the test holds both ends of it.
   */
  async function soleLeader() {
    const clock = testClock()
    const posted: LockMessage[] = []
    let handler: ((m: LockMessage) => void) | null = null
    const channel: LockChannel = {
      post: (m) => void posted.push(m),
      listen: (h) => {
        handler = h
      },
      close: () => {},
    }
    const lock = createSessionLock({
      id: 'solo',
      channel,
      timings: TIMINGS,
      now: clock.now,
      timer: clock.timer,
    })
    await clock.advance(TIMINGS.electionMs)
    expect(lock.isLeader()).toBe(true)
    return { lock, clock, posted, deliver: (m: LockMessage) => handler?.(m) }
  }

  it('grants once, and the release is SYNCHRONOUS', async () => {
    const { lock } = await soleLeader()
    const release = await lock.acquire()
    expect(typeof release).toBe('function')
    // `register.ts:877` calls this bare inside a `finally`. A promise here would be dropped
    // un-awaited and the lock would stay held past the end of the call that took it.
    expect(release()).toBeUndefined()
    expect(lock.state().held).toBe(false)
  })

  it('refuses a reentrant acquire while holding — fail closed, no double release', async () => {
    const { lock } = await soleLeader()
    const release = await lock.acquire()
    await expect(lock.acquire()).rejects.toThrow(SUBMIT_LOCK_ALREADY_HELD)
    release()
    // And it is takeable again afterwards, so the refusal was not a permanent wedge.
    const second = await lock.acquire()
    second()
    expect(lock.state().held).toBe(false)
  })

  it('a double release is a no-op, not a second unlock', async () => {
    const { lock } = await soleLeader()
    const release = await lock.acquire()
    release()
    const other = await lock.acquire()
    release() // the stale one, called again — must not free the lock the new holder took
    expect(lock.state().held).toBe(true)
    other()
    expect(lock.state().held).toBe(false)
  })

  it('a release from a DEPOSED grant cannot free the hold taken after re-election (R1)', async () => {
    // The full sequence, every step of it a supported transition:
    //   lead → hold → deposed (the reducer clears `held` on the way down) → re-elected →
    //   a second registration acquires → and only NOW the first one's `finally` fires.
    // With a bare boolean the stale release unlocks the second registration's hold, a third
    // acquire is granted while two submissions are in flight, and that is a double registration.
    const { lock, clock, deliver } = await soleLeader()

    const staleRelease = await lock.acquire()
    expect(lock.state().held).toBe(true)

    // Deposed by a better-ordered tab asserting leadership.
    deliver({ type: 'leader', id: 'aaa-earlier', startedAt: 1 })
    expect(lock.isLeader()).toBe(false)
    expect(lock.state().held).toBe(false)

    // That tab goes away and this one wins the seat back.
    await clock.advance(TIMINGS.takeoverMs)
    await clock.advance(TIMINGS.electionMs)
    expect(lock.isLeader()).toBe(true)

    const liveRelease = await lock.acquire()
    expect(lock.state().held).toBe(true)

    staleRelease() // the first registration's `finally`, arriving late
    expect(lock.state().held).toBe(true)
    // And the lock genuinely is not grantable — a third submission cannot start.
    await expect(lock.acquire()).rejects.toThrow(SUBMIT_LOCK_ALREADY_HELD)

    liveRelease()
    expect(lock.state().held).toBe(false)
  })

  it('the factory matches the frozen seam exactly, release included', async () => {
    const { lock } = await soleLeader()
    const acquire: () => Promise<() => void> = makeAcquireSubmitLock(lock)
    const release = await acquire()
    release()
    expect(lock.state().held).toBe(false)
  })

  it('the factory over a follower throws the sentence register.ts will carry', async () => {
    const acquire = makeAcquireSubmitLock({
      acquire: async () => {
        throw new Error(ACCOUNT_OPEN_IN_ANOTHER_TAB)
      },
    })
    await expect(acquire()).rejects.toThrow(ACCOUNT_OPEN_IN_ANOTHER_TAB)
  })
})

describe('the lock refuses a configuration that would produce two leaders', () => {
  it('rejects a takeover window under three heartbeats', () => {
    expect(() =>
      createSessionLock({
        channel: { post: () => {}, listen: () => {}, close: () => {} },
        timings: { electionMs: 1_000, heartbeatMs: 1_000, takeoverMs: 2_999 },
      }),
    ).toThrow(/at least three heartbeats/)
  })

  it('accepts exactly three', () => {
    const lock = createSessionLock({
      channel: { post: () => {}, listen: () => {}, close: () => {} },
      timings: { electionMs: 1_000, heartbeatMs: 1_000, takeoverMs: 3_000 },
      timer: { setTimeout: () => 0, clearTimeout: () => {} },
    })
    expect(lock.isLeader()).toBe(false)
    lock.close()
  })

  it('rejects an election window shorter than one heartbeat (S3)', () => {
    // An election that can finish without a live leader having had the chance to emit a single
    // beat is how a tab opening beside a throttled leader promotes next to it.
    expect(() =>
      createSessionLock({
        channel: { post: () => {}, listen: () => {}, close: () => {} },
        timings: { electionMs: 999, heartbeatMs: 1_000, takeoverMs: 3_000 },
      }),
    ).toThrow(/at least one heartbeat/)
  })

  it('rejects a non-positive interval', () => {
    expect(() =>
      createSessionLock({
        channel: { post: () => {}, listen: () => {}, close: () => {} },
        timings: { electionMs: 0, heartbeatMs: 1_000, takeoverMs: 5_000 },
      }),
    ).toThrow(/non-positive interval/)
  })

  it('rejects a clock that cannot answer', () => {
    // Every deadline is `now() + interval`, so a NaN clock makes them all NaN — and `now < NaN`
    // is false, so every tick fires its transition and the first one promotes this tab.
    expect(() =>
      createSessionLock({
        channel: { post: () => {}, listen: () => {}, close: () => {} },
        now: () => Number.NaN,
      }),
    ).toThrow(/now\(\) must return a finite number/)
  })

  it('the shipped defaults satisfy their own rules', () => {
    expect(DEFAULT_LOCK_TIMINGS.takeoverMs).toBeGreaterThanOrEqual(DEFAULT_LOCK_TIMINGS.heartbeatMs * 3)
    expect(DEFAULT_LOCK_TIMINGS.electionMs).toBeGreaterThanOrEqual(DEFAULT_LOCK_TIMINGS.heartbeatMs)
    expect(DEFAULT_LOCK_TIMINGS.electionMs).toBeGreaterThan(0)
  })

  const deadChannel = (): LockChannel => ({ post: () => {}, listen: () => {}, close: () => {} })

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    it(`rejects ${String(bad)} in any interval`, () => {
      // NaN makes every deadline NaN, and `now < NaN` is false — so every tick fires and the
      // machine promotes on the first one. Infinity on takeover means a dead leader is never
      // replaced. Neither is caught by a comparison: `NaN > 0` is false (which would blame the
      // wrong rule) and `Infinity >= heartbeat * 3` passes.
      for (const key of ['electionMs', 'heartbeatMs', 'takeoverMs'] as const) {
        expect(() =>
          createSessionLock({
            channel: deadChannel(),
            timings: { ...TIMINGS, [key]: bad },
          }),
        ).toThrow(/must be a finite number/)
      }
    })
  }

  it('an explicitly-undefined interval falls back to the default rather than overriding it', () => {
    // `{...DEFAULT, ...{ electionMs: undefined }}` yields `electionMs: undefined`. A caller
    // building options conditionally writes exactly that shape.
    const lock = createSessionLock({
      channel: deadChannel(),
      timings: { electionMs: undefined, heartbeatMs: undefined, takeoverMs: undefined },
      timer: { setTimeout: () => 0, clearTimeout: () => {} },
    })
    expect(lock.state().timings).toEqual(DEFAULT_LOCK_TIMINGS)
    lock.close()
  })

  it('generates a unique id without crypto.randomUUID — plain-HTTP hosting still boots', () => {
    // `randomUUID` is restricted to secure contexts, so a demo served over plain HTTP has
    // `crypto` and no `randomUUID` on it. Reaching for it unguarded is a TypeError at boot.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!
    const withoutUUID = Object.create(
      Object.getPrototypeOf(globalThis.crypto) as object,
      { randomUUID: { value: undefined, configurable: true } },
    ) as Crypto
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: withoutUUID })
    try {
      const ids = new Set<string>()
      for (let i = 0; i < 200; i++) {
        const lock = createSessionLock({
          channel: deadChannel(),
          timer: { setTimeout: () => 0, clearTimeout: () => {} },
        })
        ids.add(lock.id)
        lock.close()
      }
      // Uniqueness is the whole requirement — nothing here is a secret.
      expect(ids.size).toBe(200)
      expect([...ids].every((id) => id.length > 8)).toBe(true)
    } finally {
      Object.defineProperty(globalThis, 'crypto', original)
    }
  })
})

describe('an environment with no BroadcastChannel fails CLOSED (R8)', () => {
  function withoutBroadcastChannel<T>(body: () => T): T {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel')!
    Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined })
    try {
      return body()
    } finally {
      Object.defineProperty(globalThis, 'BroadcastChannel', original)
    }
  }

  it('builds a lock that never leads and refuses every acquire, with a named reason', async () => {
    // NOT a no-op channel, which is the tempting graceful degradation and the dangerous one:
    // with every message dropped, every tab hears silence, every tab wins its own election, and
    // every tab submits — the precise failure this module exists to prevent, arriving through
    // the code path that was trying to be helpful.
    const lock = withoutBroadcastChannel(() => createSessionLock({ channelName: 'passbook.absent' }))
    expect(lock.isLeader()).toBe(false)
    expect(lock.state().role).toBe('idle')
    await expect(lock.acquire()).rejects.toThrow(SUBMIT_LOCK_NO_CHANNEL)
    await expect(makeAcquireSubmitLock(lock)()).rejects.toThrow(SUBMIT_LOCK_NO_CHANNEL)
    lock.close()
  })

  it('does not throw at construction — a page must not die over a feature check', () => {
    expect(() => withoutBroadcastChannel(() => createSessionLock()).close()).not.toThrow()
  })

  it('still has an id, and an injected channel still works', async () => {
    const lock = withoutBroadcastChannel(() =>
      createSessionLock({
        channel: { post: () => {}, listen: () => {}, close: () => {} },
        timings: TIMINGS,
        now: () => 1_000,
        timer: { setTimeout: (fn: () => void) => setTimeout(fn, 0), clearTimeout: () => {} },
      }),
    )
    expect(lock.id.length).toBeGreaterThan(0)
    // An injected transport bypasses the check entirely — the guard is about the DEFAULT.
    expect(lock.state().role).toBe('electing')
    lock.close()
  })
})

describe('a faulted lock stops scheduling entirely (S1)', () => {
  it('arms no further timers once it has stood down', async () => {
    // The spin this closes: the fault left a stale `expiresAt` in the past, the reducer swallowed
    // every tick as a no-op, and `schedule()` re-armed a zero-delay timeout after each one —
    // burning a core until the tab closed. Driven through `createSessionLock` rather than the
    // reducer, because the bug lived in the runtime half.
    const clock = testClock()
    let handler: ((m: LockMessage) => void) | null = null
    const lock = createSessionLock({
      id: 'shared',
      channel: {
        post: () => {},
        listen: (h) => {
          handler = h
        },
        close: () => {},
      },
      timings: TIMINGS,
      now: clock.now,
      timer: clock.timer,
    })

    await clock.advance(TIMINGS.electionMs)
    expect(lock.isLeader()).toBe(true)
    expect(clock.pendingCount()).toBe(1) // the heartbeat

    // Another tab turns up using this tab's id.
    handler!({ type: 'leader', id: 'shared', startedAt: clock.now() + 500 })
    expect(lock.state().fault).toBe(DUPLICATE_TAB_ID)

    // Nothing is left armed, and advancing the clock does not arm anything either.
    expect(clock.pendingCount()).toBe(0)
    await clock.advance(TIMINGS.takeoverMs * 10)
    expect(clock.pendingCount()).toBe(0)
    expect(lock.isLeader()).toBe(false)
    lock.close()
  })
})

describe('the shipped defaults, on the real timer and the real clock (S8)', () => {
  // REAL_TIMER and the `Date.now` default were executed by nothing — every other suite injects
  // both, the same gap R3 closed for the transport. This is the one test that waits on actual
  // milliseconds, and it waits on single-digit ones.
  it('elects on wall-clock time and cancels its heartbeat on close', async () => {
    const posted: LockMessage[] = []
    const lock = createSessionLock({
      id: 'real-timer',
      channel: { post: (m) => void posted.push(m), listen: () => {}, close: () => {} },
      // No `timer`, no `now` — the module's own defaults.
      timings: { electionMs: 5, heartbeatMs: 5, takeoverMs: 15 },
    })

    expect(lock.isLeader()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(lock.isLeader()).toBe(true)
    expect(posted.filter((m) => m.type === 'leader').length).toBeGreaterThan(0)

    lock.close()
    const afterClose = posted.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    // The pending heartbeat was cancelled: nothing but the handover went out after close.
    expect(posted.length).toBe(afterClose)
    expect(posted[posted.length - 1]!.type).toBe('released')
  })
})

describe('a transport that throws cannot take the machine with it (R9)', () => {
  it('transitions still happen when post() throws', async () => {
    // A post fails on a channel the browser tore down while the tab was unloading. Losing a
    // heartbeat is what takeover already handles; an exception out of a timer callback is not.
    const clock = testClock()
    let posts = 0
    const lock = createSessionLock({
      id: 'solo',
      channel: {
        post: () => {
          posts += 1
          throw new Error('channel is closing')
        },
        listen: () => {},
        close: () => {},
      },
      timings: TIMINGS,
      now: clock.now,
      timer: clock.timer,
    })

    // The `start` claim already threw, and the machine is electing anyway.
    expect(posts).toBe(1)
    expect(lock.state().role).toBe('electing')

    await clock.advance(TIMINGS.electionMs)
    expect(lock.isLeader()).toBe(true)
    expect(posts).toBe(2)

    // And it keeps beating rather than wedging on the failure.
    await clock.advance(TIMINGS.heartbeatMs)
    expect(posts).toBe(3)
    expect(lock.isLeader()).toBe(true)

    // A grant still works — the transport is broken, the state machine is not.
    const release = await lock.acquire()
    release()
    lock.close()
  })

  it('close() is safe when the handover post AND the channel close both throw', async () => {
    const clock = testClock()
    const lock = createSessionLock({
      id: 'solo',
      channel: {
        post: () => {},
        listen: () => {},
        close: () => {
          throw new Error('already closed by the browser')
        },
      },
      timings: TIMINGS,
      now: clock.now,
      timer: clock.timer,
    })
    await clock.advance(TIMINGS.electionMs)
    expect(lock.isLeader()).toBe(true)
    expect(() => lock.close()).not.toThrow()
    expect(lock.isLeader()).toBe(false)
  })
})
