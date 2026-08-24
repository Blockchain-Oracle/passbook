import { describe, it, expect, afterEach } from 'vitest'
import type { Call } from 'starknet'
import { createSessionLock, makeAcquireSubmitLock, parseLockMessage, type LockChannel, type SessionLock } from '../src/session-lock.js'
import { ACCOUNT_OPEN_IN_ANOTHER_TAB } from '../src/session-copy.js'
import { assertActionListValid } from '../src/actions.js'
import { buildGateActionList, planGateCompanions } from '../src/message-book.js'
import { registerSponsored, type ProvedRegistration, type RegisterDeps, type RelayResponse, type SubmitBody } from '../src/register.js'
import { NET } from '../src/constants.js'
import { generateIdentity } from '../src/identity.js'
import { inMemorySessionStore } from '../src/session-store.js'
import { loadOrCreateAccountKey } from '../src/session-key.js'

const yieldTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Distinct values satisfying both construction rules: election >= heartbeat, takeover >= 3
// heartbeats. The clock is hand-driven, so the magnitudes cost nothing.
const TIMINGS = { electionMs: 600, heartbeatMs: 500, takeoverMs: 2_000 }

// ── Two lock instances on one real channel, driven without a clock ────────────────────────

const open: Array<{ lock: SessionLock; bc: BroadcastChannel }> = []
let seq = 0

afterEach(() => {
  for (const o of open) {
    try {
      o.lock.close()
    } catch {
      // Already closed by the test.
    }
    o.bc.close()
  }
  open.length = 0
})

/**
 * A leader and a follower, settled, on one real BroadcastChannel.
 *
 * The clock and the timers are hand-driven and are advanced exactly once, through the election
 * window — so the pair settles in microseconds and then STAYS put, with no heartbeat firing
 * underneath the registration tests that follow. `session-lock.test.ts` is where the timing
 * behaviour itself is asserted; here the lock only has to be real.
 */
async function leaderAndFollower() {
  const name = `passbook.test-integration-${process.pid}-${++seq}`

  let clock = 1_000
  let handles = 0
  const pending = new Map<number, { at: number; fn: () => void }>()
  const timer = {
    setTimeout: (fn: () => void, ms: number) => {
      const handle = ++handles
      pending.set(handle, { at: clock + ms, fn })
      return handle
    },
    clearTimeout: (handle: unknown) => void pending.delete(handle as number),
  }

  const make = (id: string) => {
    const bc = new BroadcastChannel(name)
    const channel: LockChannel = {
      post: (message) => bc.postMessage(message),
      listen: (handler) => {
        bc.onmessage = (event: MessageEvent) => {
          const message = parseLockMessage(event.data)
          if (message) handler(message)
        }
      },
      close: () => bc.close(),
    }
    const lock = createSessionLock({ id, channel, timer, now: () => clock, timings: TIMINGS })
    open.push({ lock, bc })
    return lock
  }

  // 'aaa-tab' wins the total order whichever is constructed first.
  const zzz = make('zzz-tab')
  const aaa = make('aaa-tab')

  clock += TIMINGS.electionMs
  for (let round = 0; round < 20; round++) {
    // Let the channel deliver before any timer fires — a real BroadcastChannel takes well
    // under a millisecond and the election window is 250 of them.
    await yieldTurn()
    await yieldTurn()
    const due = [...pending].filter(([, s]) => s.at <= clock)
    if (due.length === 0) break
    for (const [handle, s] of due) {
      pending.delete(handle)
      s.fn()
    }
  }

  expect(aaa.isLeader()).toBe(true)
  expect(zzz.isLeader()).toBe(false)
  return { leader: aaa, follower: zzz }
}

// ── AC2: serialised index assignment, and the contrast that makes it a claim ──────────────

/**
 * The next channel index, as the read-modify-write it really is.
 *
 * A tab reads how many channels the account already has, then opens at that index. The read is
 * a round trip, so there is a window between reading and committing — which is exactly where
 * two tabs both read the same number.
 */
function channelIndexSource() {
  let next = 0
  return {
    read: async () => {
      await yieldTurn()
      return next
    },
    commit: (index: number) => {
      next = Math.max(next, index + 1)
    },
  }
}

const openChannelAt = (index: number, senderAddress: string) =>
  buildGateActionList({
    messageBookAddress: '0x0abc',
    senderAddress,
    companion: { kind: 'OpenChannel', index, reason: 'the test opens a channel at this index' },
    mode: 1n,
    tag: 7n,
    payload: [1n],
    random: 3n,
    salt: 5n,
  })

/**
 * WHY THIS IS THE HONEST HEADLESS VERSION. Nothing in this repository submits a channel open
 * today — epic 2 does, and the gate script refuses `--execute` — so there is no on-chain
 * revert to catch. `assertActionListValid` is the client-side pre-check that stands between a
 * bad index and a paid fee, and it is the only place INDEX_NOT_SEQUENTIAL is enforced here.
 * Collecting what the two tabs assigned into one list and running that check is therefore the
 * strongest claim available without spending money: serialised assignments pass it, and the
 * unserialised ones the lock exists to prevent do not.
 */
describe('the lock is what keeps channel indices sequential (AC2)', () => {
  const SENDER = '0x0123456789abcdef'

  it('WITHOUT the lock, two concurrent attempts both take index 0 and the list is rejected', () => {
    // The contrast is the test. This is what a second tab does today, and
    // `assertActionListValid` is the client-side pre-check that catches it before a fee is
    // paid — the pool's own name for the revert is INDEX_NOT_SEQUENTIAL.
    const indices = [0, 0]
    const list = indices.flatMap((i) => openChannelAt(i, SENDER)).filter((a) => a.type === 'OpenChannel')
    expect(() => assertActionListValid(list)).toThrow('INDEX_NOT_SEQUENTIAL')
  })

  it('two attempts THROUGH the lock are serialised, and the indices come out sequential', async () => {
    const { leader } = await leaderAndFollower()
    const source = channelIndexSource()
    const assigned: number[] = []

    /** One channel-open attempt. Refused attempts assign nothing and are retried. */
    const attempt = async () => {
      for (let tries = 0; tries < 5; tries++) {
        let release: () => void
        try {
          release = await makeAcquireSubmitLock(leader)()
        } catch {
          // Refused — by the reentrancy guard here, and by the follower check across tabs.
          // Either way NO index was read, which is the whole point.
          await yieldTurn()
          continue
        }
        try {
          const index = await source.read()
          source.commit(index)
          assigned.push(index)
          return index
        } finally {
          release()
        }
      }
      throw new Error('the attempt never got the lock')
    }

    await Promise.all([attempt(), attempt()])

    expect(assigned.slice().sort()).toEqual([0, 1])
    const list = assigned
      .slice()
      .sort()
      .flatMap((i) => openChannelAt(i, SENDER))
      .filter((a) => a.type === 'OpenChannel')
    expect(() => assertActionListValid(list)).not.toThrow()
  })

  it("a follower's channel-open attempt is refused before it reads an index at all", async () => {
    const { leader, follower } = await leaderAndFollower()
    const source = channelIndexSource()
    let reads = 0

    const attempt = async (lock: SessionLock) => {
      const release = await makeAcquireSubmitLock(lock)()
      try {
        reads += 1
        const index = await source.read()
        source.commit(index)
        return index
      } finally {
        release()
      }
    }

    // Refused at the lock, so the read never happens — there is no second index in flight to
    // collide with the leader's.
    await expect(attempt(follower)).rejects.toThrow(ACCOUNT_OPEN_IN_ANOTHER_TAB)
    expect(reads).toBe(0)

    await expect(attempt(leader)).resolves.toBe(0)
    expect(reads).toBe(1)
  })

  it('the companion plan the real gate uses is itself sequential from zero', () => {
    // `planGateCompanions` is what a real multi-transaction run assigns indices from, and the
    // rule it encodes — sequential from 0, after the registration — is the rule the lock has
    // to preserve under concurrency.
    const plan = planGateCompanions(4)
    expect(plan[0]!.kind).toBe('SetViewingKey')
    const indices = plan.filter((c) => c.kind === 'OpenChannel').map((c) => c.index)
    expect(indices).toEqual([0, 1, 2])
    const list = indices.flatMap((i) => openChannelAt(i, SENDER)).filter((a) => a.type === 'OpenChannel')
    expect(() => assertActionListValid(list)).not.toThrow()
  })
})

// ── AC3: the real pipeline, two tabs, one submission ──────────────────────────────────────

const FEE_WEI = 6_000_000_000_000_000_000n
const HEAD = 1_000_000
const ACCOUNT_KEY = generateIdentity().privateKey
const ADDRESS = '0x0123456789abcdef'
const TX_HASH = '0xfeedface'

const APPLY_ACTIONS: Call = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: ['0x1', '0x0'] }

/** The register pipeline with every leg faked, so the only real thing in it is the lock. */
function pipeline(acquireSubmitLock: () => Promise<() => void>, submits: SubmitBody[]) {
  const deps: RegisterDeps = {
    canRegister: () => true,
    acquireSubmitLock,
    preflight: async () => ({ route: 'unregistered' }),
    readConstants: async () => ({ feeWei: FEE_WEI, paused: false, proofValidityBlocks: 100, blockNumber: HEAD }),
    readBlockNumber: async () => HEAD,
    prove: async (input): Promise<ProvedRegistration> => {
      // Slow enough that the second call is genuinely in flight while this one holds the lock.
      await yieldTurn()
      return { call: APPLY_ACTIONS, proofFacts: ['0x11'], provingBlockId: input.provingBlockId }
    },
    submit: async (_url, body): Promise<RelayResponse> => {
      submits.push(body)
      await yieldTurn()
      return { status: 200, body: { transactionHash: TX_HASH } }
    },
    confirm: async () => {},
  }
  return registerSponsored({ accountKey: ACCOUNT_KEY, account: { address: ADDRESS, signer: {} as never } }, deps)
}

describe('two concurrent registrations, one submission (AC2/AC3)', () => {
  it('across two tabs: the leader submits, the follower gets lock-unavailable with the sentence', async () => {
    const { leader, follower } = await leaderAndFollower()
    const submits: SubmitBody[] = []

    const [led, followed] = await Promise.all([
      pipeline(makeAcquireSubmitLock(leader), submits),
      pipeline(makeAcquireSubmitLock(follower), submits),
    ])

    expect(led.ok).toBe(true)
    expect(led.ok && led.transactionHash).toBe(TX_HASH)

    expect(followed.ok).toBe(false)
    expect(!followed.ok && followed.failure.kind).toBe('lock-unavailable')
    // The sentence arrives through the frozen seam untouched — `register.ts` stringifies the
    // thrown error into `reason`, so the reason CARRIES the exported const byte for byte.
    expect(!followed.ok && followed.failure.kind === 'lock-unavailable' && followed.failure.reason)
      .toContain(ACCOUNT_OPEN_IN_ANOTHER_TAB)

    // Exactly one transaction was ever offered to the relayer. The second tab never proved,
    // never relayed, and never spent a sponsorship on a NON_ZERO_VALUE revert.
    expect(submits).toHaveLength(1)
  })

  it('in ONE tab: a double submit is refused by the reentrancy guard, not run twice', async () => {
    const { leader } = await leaderAndFollower()
    const submits: SubmitBody[] = []

    const [first, second] = await Promise.all([
      pipeline(makeAcquireSubmitLock(leader), submits),
      pipeline(makeAcquireSubmitLock(leader), submits),
    ])

    const outcomes = [first, second]
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1)
    const refused = outcomes.find((r) => !r.ok)!
    expect(!refused.ok && refused.failure.kind).toBe('lock-unavailable')
    expect(submits).toHaveLength(1)
  })

  it('the lock is released after a success, so the next registration can take it', async () => {
    const { leader } = await leaderAndFollower()
    const submits: SubmitBody[] = []
    await pipeline(makeAcquireSubmitLock(leader), submits)
    expect(leader.state().held).toBe(false)
    const again = await pipeline(makeAcquireSubmitLock(leader), submits)
    expect(again.ok).toBe(true)
  })

  it('the account key the pipeline registers is the one the session persisted', async () => {
    // The two halves of this story meeting: the key comes out of the store, and the lock says
    // which tab may spend it.
    const store = inMemorySessionStore()
    const loaded = loadOrCreateAccountKey(store)
    expect(loaded.ok).toBe(true)

    const { leader } = await leaderAndFollower()
    const submits: SubmitBody[] = []
    const proved: string[] = []
    const result = await registerSponsored(
      { accountKey: loaded.ok ? loaded.accountKey : '', account: { address: ADDRESS, signer: {} as never } },
      {
        canRegister: () => true,
        acquireSubmitLock: makeAcquireSubmitLock(leader),
        preflight: async () => ({ route: 'unregistered' }),
        readConstants: async () => ({ feeWei: FEE_WEI, paused: false, proofValidityBlocks: 100, blockNumber: HEAD }),
        readBlockNumber: async () => HEAD,
        prove: async (input) => {
          proved.push(input.accountKey)
          return { call: APPLY_ACTIONS, proofFacts: ['0x11'], provingBlockId: input.provingBlockId }
        },
        submit: async (_url, body) => {
          submits.push(body)
          return { status: 200, body: { transactionHash: TX_HASH } }
        },
        confirm: async () => {},
      },
    )

    expect(result.ok).toBe(true)
    expect(proved).toEqual([loaded.ok && loaded.accountKey])
    // And it is still the same key on the next load — nothing about registering rotated it.
    expect(loadOrCreateAccountKey(store)).toMatchObject({ ok: true, created: false })
  })
})
