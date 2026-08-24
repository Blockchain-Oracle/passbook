import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CallData, cairo, hash, type Call } from 'starknet'
import {
  registerSponsored,
  assembleRegistrationCalls,
  assertLoneSetViewingKey,
  assertNotReverted,
  extractClientActionSpan,
  feeRowCopy,
  formatStrk,
  POOL_SEES_DISCLOSURE,
  PROVING_BLOCK_LAG,
  CONFIRM_TIMEOUT_MS,
  DEFAULT_APP_NAME,
  RegistrationReverted,
  type ProvedRegistration,
  type RegisterDeps,
  type RegistrationStage,
  type RelayResponse,
  type SubmitBody,
} from '../src/register.js'
import { NET, STRK_TOKEN } from '../src/constants.js'
import { CLIENT_ACTION } from '../src/message-book.js'
import { mapRegistrationError } from '../src/registration.js'
import { approveCeiling, assertSubmittable } from '../../relayer/src/allowlist.js'
import { BUDGET_EXHAUSTED_NOTICE } from '../../relayer/src/sponsorship.js'
import { generateIdentity } from '../src/identity.js'

const COMPILE_ACTIONS = hash.getSelectorFromName('compile_actions')

/** The module's own text, for the two invariants only a source read can hold down. */
const SOURCE = readFileSync(new URL('../src/register.ts', import.meta.url), 'utf8')

const FEE_WEI = 6_000_000_000_000_000_000n
const HEAD = 1_000_000
const VALIDITY = 100

const ACCOUNT_KEY = generateIdentity().privateKey
const ADDRESS = '0x0123456789abcdef'
const TX_HASH = '0xdeadbeef'

const APPLY_ACTIONS: Call = {
  contractAddress: NET.pool,
  entrypoint: 'apply_actions',
  calldata: ['0x1', '0x0'],
}
const PROOF_FACTS = ['0x11', '0x22']

/**
 * Fakes that COUNT. The pipeline's central promise is that a route decided for free
 * costs nothing, and the only way to assert that is to be able to say "the prover was
 * called zero times" rather than "the prover probably was not called".
 */
function harness(over: Partial<RegisterDeps> = {}) {
  const proveCalls: unknown[] = []
  const relayCalls: SubmitBody[] = []
  const stages: RegistrationStage[] = []

  const deps: RegisterDeps = {
    canRegister: () => true,
    preflight: async () => ({ route: 'unregistered' }),
    readConstants: async () => ({
      feeWei: FEE_WEI,
      paused: false,
      proofValidityBlocks: VALIDITY,
      blockNumber: HEAD,
    }),
    readBlockNumber: async () => HEAD,
    prove: async (input): Promise<ProvedRegistration> => {
      proveCalls.push(input)
      return { call: APPLY_ACTIONS, proofFacts: PROOF_FACTS, provingBlockId: input.provingBlockId }
    },
    submit: async (_url, body): Promise<RelayResponse> => {
      relayCalls.push(body)
      return { status: 200, body: { transactionHash: TX_HASH } }
    },
    confirm: async () => {},
    onStage: (s) => stages.push(s),
    ...over,
  }

  const account = { address: ADDRESS, signer: {} as never }
  return {
    deps,
    proveCalls,
    relayCalls,
    stages,
    run: () => registerSponsored({ accountKey: ACCOUNT_KEY, account }, deps),
  }
}

describe('registerSponsored — the happy path (AC2/AC3/AC5)', () => {
  it('reaches exactly build, prove, relay, confirmed — and never mature', async () => {
    const h = harness()
    const result = await h.run()

    expect(result.ok).toBe(true)
    expect(result.stages).toEqual(['build', 'prove', 'relay', 'confirmed'])
    expect(h.stages).toEqual(['build', 'prove', 'relay', 'confirmed'])
    expect(result.stages).not.toContain('mature')
  })

  it('returns the relayer transaction hash and a fee row built from the live read', async () => {
    const result = await harness().run()
    expect(result.ok && result.transactionHash).toBe(TX_HASH)
    expect(result.ok && result.feeRow).toEqual({
      submitter: 'Passbook',
      feeWei: FEE_WEI,
      paidByUs: true,
    })
  })

  it('proves against a block behind the head, inside the live validity window', async () => {
    const h = harness()
    await h.run()
    expect(h.proveCalls).toHaveLength(1)
    expect((h.proveCalls[0] as { provingBlockId: number }).provingBlockId).toBe(
      HEAD - PROVING_BLOCK_LAG,
    )
  })

  it('posts [approve, apply_actions] with the proof facts alongside', async () => {
    const h = harness()
    await h.run()
    expect(h.relayCalls).toHaveLength(1)
    const body = h.relayCalls[0]!
    expect(body.proofFacts).toEqual(PROOF_FACTS)
    expect(body.calls.map((c) => c.entrypoint)).toEqual(['approve', 'apply_actions'])
  })
})

describe('registerSponsored — the free gate spends nothing (AC4)', () => {
  it('refuses before the pre-flight when the backup is not confirmed', async () => {
    const h = harness({ canRegister: undefined })   // the real default: refuse
    const result = await h.run()
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('backup-not-confirmed')
    expect(result.stages).toEqual([])
    expect(h.proveCalls).toHaveLength(0)
    expect(h.relayCalls).toHaveLength(0)
  })

  it('a collision issues ZERO prover and ZERO relayer requests', async () => {
    const h = harness({ preflight: async () => ({ route: 'collision', onChainKey: 0x999n }) })
    const result = await h.run()
    expect(!result.ok && result.failure).toEqual({ kind: 'collision', onChainKey: 0x999n })
    expect(result.stages).toEqual([])
    expect(h.proveCalls).toHaveLength(0)
    expect(h.relayCalls).toHaveLength(0)
  })

  it('an already-registered address stops for free', async () => {
    const h = harness({
      preflight: async () => ({ route: 'already-registered', onChainKey: 0x777n }),
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('already-registered')
    expect(h.proveCalls).toHaveLength(0)
    expect(h.relayCalls).toHaveLength(0)
  })

  it('an unreadable chain fails closed rather than proceeding', async () => {
    const h = harness({
      preflight: async () => ({ route: 'blocked-rpc-unknown', reason: 'all RPC hosts failed' }),
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('blocked-rpc-unknown')
    expect(h.proveCalls).toHaveLength(0)
  })

  it('a zero fee is an unusable reading, not a free registration', async () => {
    const h = harness({
      readConstants: async () => ({
        feeWei: 0n, paused: false, proofValidityBlocks: VALIDITY, blockNumber: HEAD,
      }),
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('blocked-rpc-unknown')
    expect(h.proveCalls).toHaveLength(0)
  })

  it('a paused pool stops after build, before the prover is asked', async () => {
    const h = harness({
      readConstants: async () => ({
        feeWei: FEE_WEI, paused: true, proofValidityBlocks: VALIDITY, blockNumber: HEAD,
      }),
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('pool-paused')
    expect(result.stages).toEqual(['build'])
    expect(h.proveCalls).toHaveLength(0)
  })
})

describe('registerSponsored — failures keep their stage history', () => {
  it('a prover error is typed and preserves build+prove', async () => {
    const h = harness({ prove: async () => { throw new Error('prover 503') } })
    const result = await h.run()
    expect(result.stages).toEqual(['build', 'prove'])
    expect(!result.ok && result.failure.kind).toBe('prover-failed')
    expect(!result.ok && result.failure.kind === 'prover-failed' && result.failure.reason)
      .toMatch(/prover 503/)
    expect(h.relayCalls).toHaveLength(0)
  })

  it('a proof older than the live window is proof-expired, not an unexplained revert', async () => {
    const h = harness({ readBlockNumber: async () => HEAD + VALIDITY })
    const result = await h.run()
    expect(!result.ok && result.failure).toEqual({
      kind: 'proof-expired',
      provedAtBlock: HEAD - PROVING_BLOCK_LAG,
      currentBlock: HEAD + VALIDITY,
      validityBlocks: VALIDITY,
    })
    expect(h.relayCalls).toHaveLength(0)
  })

  it('a 403 sponsorship-paused becomes pay-your-own-way carrying the notice verbatim', async () => {
    const h = harness({
      submit: async () => ({
        status: 403,
        body: {
          error: 'sponsored submissions are paused',
          reason: 'sponsorship-paused',
          notice: BUDGET_EXHAUSTED_NOTICE,
        },
      }),
    })
    const result = await h.run()
    expect(result.stages).toEqual(['build', 'prove', 'relay'])
    // The fee row rides along, flipped to the self-funded payer: the screen that says
    // "fund this yourself" is exactly where the amount has to be visible.
    expect(!result.ok && result.failure).toEqual({
      kind: 'pay-your-own-way',
      notice: BUDGET_EXHAUSTED_NOTICE,
      feeRow: { submitter: 'Passbook', feeWei: FEE_WEI, paidByUs: false },
    })
    const failure = !result.ok && result.failure
    if (failure && failure.kind === 'pay-your-own-way') {
      expect(feeRowCopy(failure.feeRow).line).toMatch(/paid by you$/)
    }
  })

  it('any other relayer refusal is relay-refused, carrying the status', async () => {
    const h = harness({
      submit: async () => ({ status: 403, body: { error: 'refusing to sign transfer' } }),
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('relay-refused')
    expect(!result.ok && result.failure.kind === 'relay-refused' && result.failure.status).toBe(403)
  })

  it('a revert is mapped copy, never the raw pool code', async () => {
    const h = harness({
      confirm: async () => { throw new RegistrationReverted('NON_ZERO_VALUE') },
    })
    const result = await h.run()
    expect(result.stages).toEqual(['build', 'prove', 'relay'])   // never reaches confirmed
    expect(!result.ok && result.failure.kind === 'reverted' && result.failure.message)
      .toMatch(/already has a registered key/i)
  })

  // A dropped socket says NOTHING about the transaction. Calling it a revert would send
  // the user to re-register over their own pending write.
  it('a transport failure while confirming is confirmation-unknown, not reverted', async () => {
    const h = harness({ confirm: async () => { throw new Error('socket hang up') } })
    const result = await h.run()
    expect(!result.ok && result.failure).toEqual({
      kind: 'confirmation-unknown',
      transactionHash: TX_HASH,
      reason: 'Error: socket hang up',
    })
  })
})

describe('confirming against a real receipt (the reverted-reads-as-success bug)', () => {
  // starknet.js defaults errorStates to [] and decides success on FINALITY, and a reverted
  // transaction still reaches ACCEPTED_ON_L2 — so waitForTransaction RESOLVES on one. The
  // receipt is the only place the rollback appears, which is why this check exists.
  it('throws RegistrationReverted carrying the pool reason', () => {
    expect(() =>
      assertNotReverted({
        execution_status: 'REVERTED',
        finality_status: 'ACCEPTED_ON_L2',
        revert_reason: 'Error at pc=0:42: NON_ZERO_VALUE',
      }),
    ).toThrow(RegistrationReverted)

    try {
      assertNotReverted({ execution_status: 'REVERTED', revert_reason: 'NON_ZERO_VALUE' })
      expect.unreachable('a reverted receipt must not pass')
    } catch (e) {
      expect(e).toBeInstanceOf(RegistrationReverted)
      expect((e as RegistrationReverted).revertReason).toBe('NON_ZERO_VALUE')
      // The whole point of reading the receipt rather than letting errorStates throw:
      // this is the string mapRegistrationError needs, and errorStates drops it.
      expect(mapRegistrationError((e as RegistrationReverted).revertReason))
        .toMatch(/already has a registered key/i)
    }
  })

  it('says something honest when the receipt reverted but carried no reason', () => {
    expect(() => assertNotReverted({ execution_status: 'REVERTED' }))
      .toThrow(/carried no reason/)
  })

  it('passes a succeeded receipt, and a shape it does not recognise', () => {
    expect(() => assertNotReverted({ execution_status: 'SUCCEEDED' })).not.toThrow()
    expect(() => assertNotReverted(null)).not.toThrow()
    expect(() => assertNotReverted(undefined)).not.toThrow()
  })
})

describe('registerSponsored — the dependency seams', () => {
  it('takes the account key as a parameter and never reads it from storage', async () => {
    const h = harness()
    await h.run()
    expect((h.proveCalls[0] as { accountKey: string }).accountKey).toBe(ACCOUNT_KEY)
  })

  it('holds the injected submit lock across the paid steps and releases it on failure', async () => {
    let held = 0
    let maxHeld = 0
    let released = 0
    const h = harness({
      acquireSubmitLock: async () => {
        held += 1
        maxHeld = Math.max(maxHeld, held)
        return () => { held -= 1; released += 1 }
      },
      prove: async () => { throw new Error('prover 503') },
    })
    await h.run()
    expect(maxHeld).toBe(1)
    expect(released).toBe(1)
    expect(held).toBe(0)
  })

  it('runs without a lock at all — it is optional and defaults to a no-op', async () => {
    const result = await harness({ acquireSubmitLock: undefined }).run()
    expect(result.ok).toBe(true)
  })

  // The race the lock exists to prevent: two tabs both pre-flight to `unregistered`
  // before either takes the lock. Whichever gets in second must re-read and stop, or it
  // spends a sponsorship on a NON_ZERO_VALUE revert.
  it('re-runs the pre-flight INSIDE the lock and stops on an answer that changed', async () => {
    let reads = 0
    const h = harness({
      preflight: async () => {
        reads += 1
        // The other tab registered in the window between these two reads.
        return reads === 1
          ? { route: 'unregistered' }
          : { route: 'already-registered', onChainKey: 0x777n }
      },
    })
    const result = await h.run()
    expect(reads).toBe(2)
    expect(!result.ok && result.failure.kind).toBe('already-registered')
    expect(h.proveCalls).toHaveLength(0)
    expect(h.relayCalls).toHaveLength(0)
  })

  it('takes the lock BEFORE the second read, so the re-check is actually serialised', async () => {
    const order: string[] = []
    await harness({
      acquireSubmitLock: async () => { order.push('lock'); return () => order.push('unlock') },
      preflight: async () => { order.push('preflight'); return { route: 'unregistered' } },
    }).run()
    expect(order).toEqual(['preflight', 'lock', 'preflight', 'unlock'])
  })
})

describe('every seam failure is a typed result, never a rejected promise', () => {
  it('a throwing backup gate refuses and keeps the reason', async () => {
    const h = harness({ canRegister: () => { throw new Error('IndexedDB unavailable') } })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('backup-not-confirmed')
    expect(!result.ok && result.failure.kind === 'backup-not-confirmed' && result.failure.reason)
      .toMatch(/IndexedDB/)
  })

  it('a malformed account key is bad-input, not a rejection', async () => {
    // No `preflight` override, so this runs the real one — which derives before it reads,
    // so the derivation throws and no network call is ever attempted.
    const result = await registerSponsored(
      { accountKey: 'not-a-key', account: { address: ADDRESS, signer: {} as never } },
      { canRegister: () => true },
    )
    expect(!result.ok && result.failure.kind).toBe('bad-input')
  })

  it('a throwing pre-flight is bad-input', async () => {
    const h = harness({ preflight: async () => { throw new Error('boom') } })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('bad-input')
  })

  it('a lock that cannot be taken is lock-unavailable', async () => {
    const h = harness({ acquireSubmitLock: async () => { throw new Error('held by another tab') } })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('lock-unavailable')
    expect(h.proveCalls).toHaveLength(0)
  })
})

describe('the confirm leg cannot park the lock forever (R2)', () => {
  it('gives up at the deadline as confirmation-unknown, carrying the hash, and unlocks', async () => {
    let released = false
    let scheduledMs = 0
    // A hand-driven clock: the deadline fires the moment it is armed, so the five-minute
    // window is asserted on without any test waiting five minutes.
    const immediateTimer = {
      setTimeout(fn: () => void, ms: number) {
        scheduledMs = ms
        return setTimeout(fn, 0)
      },
      clearTimeout(h: unknown) {
        clearTimeout(h as ReturnType<typeof setTimeout>)
      },
    }
    const h = harness({
      acquireSubmitLock: async () => () => { released = true },
      confirm: () => new Promise<void>(() => {}),   // never settles, like a stalled RPC
      deadlineTimer: immediateTimer,
    })
    const result = await h.run()

    expect(scheduledMs).toBe(CONFIRM_TIMEOUT_MS)
    expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
    // The hash is KNOWN here — the relayer gave it to us — so it must be reported.
    expect(!result.ok && result.failure.kind === 'confirmation-unknown' && result.failure.transactionHash)
      .toBe(TX_HASH)
    expect(result.stages).toEqual(['build', 'prove', 'relay'])
    expect(released).toBe(true)
  })

  it('does not leave a timer armed after a confirmation that lands in time', async () => {
    let cleared = 0
    const countingTimer = {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (h: unknown) => {
        cleared += 1
        clearTimeout(h as ReturnType<typeof setTimeout>)
      },
    }
    const result = await harness({ deadlineTimer: countingTimer }).run()
    expect(result.ok).toBe(true)
    expect(cleared).toBe(1)
  })
})

describe('an observer or a lock that misbehaves cannot sink the pipeline (R10)', () => {
  it('ignores an onStage observer that throws', async () => {
    const seen: RegistrationStage[] = []
    const result = await harness({
      onStage: (s) => { seen.push(s); throw new Error('component unmounted') },
    }).run()
    expect(result.ok).toBe(true)
    expect(seen).toEqual(['build', 'prove', 'relay', 'confirmed'])
  })

  // A `finally` that throws REPLACES the result — including a success.
  it('ignores a release() that throws, preserving the successful result', async () => {
    const result = await harness({
      acquireSubmitLock: async () => () => { throw new Error('lock already gone') },
    }).run()
    expect(result.ok).toBe(true)
    expect(result.ok && result.transactionHash).toBe(TX_HASH)
  })
})

describe('the live validity window is sanity-checked too (R11)', () => {
  it('refuses a window no wider than the proving lag, before the prover is asked', async () => {
    const h = harness({
      readConstants: async () => ({
        feeWei: FEE_WEI, paused: false,
        proofValidityBlocks: PROVING_BLOCK_LAG, blockNumber: HEAD,
      }),
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('blocked-rpc-unknown')
    expect(!result.ok && result.failure.kind === 'blocked-rpc-unknown' && result.failure.reason)
      .toMatch(/already be expired/)
    expect(h.proveCalls).toHaveLength(0)
  })

  it('accepts the live mainnet window, which is far wider', async () => {
    const result = await harness({
      readConstants: async () => ({
        feeWei: FEE_WEI, paused: false, proofValidityBlocks: 450, blockNumber: HEAD,
      }),
    }).run()
    expect(result.ok).toBe(true)
  })
})

describe('the fee leg (AC2/AC6)', () => {
  it('prepends STRK.approve(pool, ceiling) to the proven call', () => {
    const calls = assembleRegistrationCalls(APPLY_ACTIONS, FEE_WEI)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.contractAddress).toBe(STRK_TOKEN)
    expect(calls[0]!.entrypoint).toBe('approve')
    expect(calls[1]).toBe(APPLY_ACTIONS)
  })

  // The pool's fee is mutable at zero upgrade delay, so an allowance of exactly the fee
  // is one admin transaction away from a revert we have already paid the gas for.
  it('approves with headroom, using the same ceiling the relayer enforces', () => {
    const calls = assembleRegistrationCalls(APPLY_ACTIONS, FEE_WEI)
    expect(calls[0]!.calldata)
      .toEqual(CallData.compile([NET.pool, cairo.uint256(approveCeiling(FEE_WEI))]))
    expect(approveCeiling(FEE_WEI)).toBeGreaterThan(FEE_WEI)
  })

  // The two sides must agree exactly: build above what the server signs and our own gate
  // refuses every real submission.
  it('is accepted at the exact ceiling the server derives — no daylight either way', () => {
    for (const fee of [FEE_WEI, 1n, 9_000_000_000_000_000_000n, 40_000_000_000_000_000_000n]) {
      expect(() =>
        assertSubmittable(assembleRegistrationCalls(APPLY_ACTIONS, fee), {
          maxApproveWei: approveCeiling(fee),
        }),
      ).not.toThrow()
    }
  })

  it('produces a batch the relayer allowlist already accepts unchanged', () => {
    // The investigation's claim, held down by a test: `[approve, apply_actions]` needs no
    // allowlist change. The ceiling is the one the server itself derives from the live fee.
    expect(() =>
      assertSubmittable(assembleRegistrationCalls(APPLY_ACTIONS, FEE_WEI), {
        maxApproveWei: approveCeiling(FEE_WEI),
      }),
    ).not.toThrow()
  })

  it('refuses to approve a zero fee', () => {
    expect(() => assembleRegistrationCalls(APPLY_ACTIONS, 0n)).toThrow(/refusing to approve/)
  })
})

describe('the compiled action list is a lone SetViewingKey (AC2)', () => {
  const span = (...felts: bigint[]) => felts

  /** A well-formed proof invocation, with one field at a time made wrong. */
  function executeCalldata(over: { to?: string; selector?: string } = {}): string[] {
    // [array_len=1, to, selector, inner_len, sender, viewingKey, count, variant, random]
    return [
      '0x1', over.to ?? NET.pool, over.selector ?? COMPILE_ACTIONS,
      '0x5', ADDRESS, '0x7', '0x1', '0x0', '0x2a',
    ]
  }

  it('accepts [count=1, SetViewingKey, random]', () => {
    expect(() => assertLoneSetViewingKey(span(1n, BigInt(CLIENT_ACTION.SetViewingKey), 42n)))
      .not.toThrow()
  })

  it('refuses a second action — this is what catches an autoSetup OpenChannel', () => {
    expect(() =>
      assertLoneSetViewingKey(
        span(2n, BigInt(CLIENT_ACTION.SetViewingKey), 42n, BigInt(CLIENT_ACTION.OpenChannel)),
      ),
    ).toThrow(/lone SetViewingKey/)
  })

  it('refuses a Deposit compiled in place of the registration', () => {
    expect(() => assertLoneSetViewingKey(span(1n, BigInt(CLIENT_ACTION.Deposit), 42n)))
      .toThrow(/expected SetViewingKey/)
  })

  it('refuses a zero random, in a sentence rather than a bare pool code', () => {
    expect(() => assertLoneSetViewingKey(span(1n, 0n, 0n)))
      .toThrow(/refusing to prove a registration whose encryption randomness is zero/)
  })

  it('reads the span back out of an __execute__ proof invocation', () => {
    expect(extractClientActionSpan(executeCalldata())).toEqual([1n, 0n, 42n])
  })

  it('refuses an invocation carrying more than one call', () => {
    expect(() => extractClientActionSpan(['0x2', NET.pool, COMPILE_ACTIONS, '0x0']))
      .toThrow(/exactly one compile_actions/)
  })

  // Reading a span out of a call to something else would assert on one thing while the
  // prover works on another: the check passes and proves nothing.
  it('refuses an invocation aimed at a contract that is not the pool', () => {
    expect(() => extractClientActionSpan(executeCalldata({ to: '0xdead' })))
      .toThrow(/expected the pool/)
  })

  it('refuses an invocation of an entrypoint that is not compile_actions', () => {
    expect(() => extractClientActionSpan(executeCalldata({ selector: '0xbeef' })))
      .toThrow(/expected compile_actions/)
  })

  it('refuses trailing felts nobody inspected', () => {
    expect(() => extractClientActionSpan([...executeCalldata(), '0x99']))
      .toThrow(/went uninspected/)
  })

  it('refuses calldata too short to be an __execute__ at all', () => {
    expect(() => extractClientActionSpan(['0x1', NET.pool])).toThrow(/too short/)
  })

  it('refuses an inner calldata with no room for even (sender, viewingKey)', () => {
    expect(() => extractClientActionSpan(['0x1', NET.pool, COMPILE_ACTIONS, '0x1', ADDRESS]))
      .toThrow(/too few/)
  })
})

describe('the fee row copy (AC6)', () => {
  it('assembles the submitter line from live data in one place', () => {
    expect(feeRowCopy({ submitter: 'Passbook', feeWei: FEE_WEI, paidByUs: true }).line)
      .toBe('Submitted by Passbook relayer · 6 STRK · paid by us')
  })

  it('falls back to the app name when appName is blank or only whitespace', async () => {
    for (const appName of ['', '   ', undefined]) {
      const result = await registerSponsored(
        { accountKey: ACCOUNT_KEY, account: { address: ADDRESS, signer: {} as never }, appName },
        harness().deps,
      )
      expect(result.ok && result.feeRow.submitter).toBe(DEFAULT_APP_NAME)
      expect(result.ok && feeRowCopy(result.feeRow).line)
        .toBe(`Submitted by ${DEFAULT_APP_NAME} relayer · 6 STRK · paid by us`)
    }
  })

  it('says "paid by you" on the self-funded path rather than going quiet', () => {
    expect(feeRowCopy({ submitter: 'Passbook', feeWei: FEE_WEI, paidByUs: false }).line)
      .toMatch(/paid by you$/)
  })

  it('ships the disclosure line byte-exact', () => {
    expect(POOL_SEES_DISCLOSURE).toBe('The pool sees this transaction, not your notes.')
    expect(feeRowCopy({ submitter: 'Passbook', feeWei: FEE_WEI, paidByUs: true }).disclosure)
      .toBe(POOL_SEES_DISCLOSURE)
  })

  it('formats wei without trailing-zero noise', () => {
    expect(formatStrk(6_000_000_000_000_000_000n)).toBe('6')
    expect(formatStrk(1_500_000_000_000_000_000n)).toBe('1.5')
    expect(formatStrk(1n)).toBe('0.000000000000000001')
    expect(formatStrk(0n)).toBe('0')
  })

  // bigint division truncates toward zero and the remainder keeps the sign, so an
  // unguarded negative renders as the garbage string `0.-00…001` in the one row a user
  // reads to see what they are being charged.
  it('refuses a negative amount rather than rendering a corrupted one', () => {
    expect(() => formatStrk(-1n)).toThrow(/negative amount/)
  })

  it('hardcodes no fee anywhere in the module', () => {
    // Every cost is a live read (`readPoolConstants().feeWei`). A wei-scale literal in this
    // file would be a number that stops being true the next time the pool's fee moves — it
    // was 4 STRK earlier in this pool's history, at zero upgrade delay.
    //
    // Decimal only, and only outside hex: `\d{15,}` alone false-positives on any long
    // `0x…` literal that happens to be all digits.
    const withoutHex = SOURCE.replace(/0x[0-9a-fA-F]+/g, '')
    expect(withoutHex).not.toMatch(/\b\d[\d_]{14,}\b/)
  })
})

describe('the stage vocabulary', () => {
  it('is exactly the four stages, exhaustively', () => {
    // Matches to the statement terminator rather than to the end of the line, so wrapping
    // the union across several lines does not quietly make this assertion vacuous.
    const union = SOURCE.match(/export type RegistrationStage\s*=([\s\S]*?)(?:\n\s*\n|\n(?=\S))/)?.[1] ?? ''
    expect(union).toBeTruthy()
    expect(union.match(/'[a-z-]+'/g)).toEqual(["'build'", "'prove'", "'relay'", "'confirmed'"])
  })

  it('names no ripening stage in the vocabulary or in the prose describing it', () => {
    // Scoped to whole words, so 'maturity'/'premature' in an explanation are fine — the
    // thing being banned is a FIFTH STAGE, not a discussion of why there isn't one. Note
    // this reads the .ts source, which holds only while tests run against source rather
    // than against a build output.
    expect(SOURCE).not.toMatch(/\bmature\b/i)
    expect(SOURCE).not.toMatch(/['"`]mature['"`]/i)
  })
})

describe('no paid network call escapes the unit suite', () => {
  it('never touches global fetch — the relayer POST is injected', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    await harness().run()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
