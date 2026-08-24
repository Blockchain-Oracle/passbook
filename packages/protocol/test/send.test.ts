import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CallData, cairo, type Call } from 'starknet'
import {
  sendShielded,
  planSend,
  plannedVariants,
  planToValidatableActions,
  preflightRecipient,
  assertSendSpan,
  assertChannelIndices,
  assertProvenSendCall,
  expectedSpanFelts,
  makeSendDiscovery,
  makeNoteMatureWatcher,
  buildSendRegistry,
  toSdkChannel,
  mapSendError,
  sendFeeRowCopy,
  selfSubmitApprove,
  readFeeRecipient,
  RelayerMisconfigured,
  DOOR_A_INVITE,
  MAX_INPUT_NOTES,
  SELF_SUBMIT_GAS_LOSS,
  SELF_SUBMIT_DISCLOSURE,
  CLIENT_ACTION_FELTS,
  notEnoughShielded,
  type ExpectedSendAction,
  type ProvedSend,
  type SendDeps,
  type SendPlan,
  type SendStage,
  type SendWalletData,
} from '../src/send.js'
import { NET, STRK_TOKEN } from '../src/constants.js'
import { CLIENT_ACTION, EXPECTED_POOL_CLASS_HASH, ACTION_LIST_EVIDENCE } from '../src/message-book.js'
import { POOL_SEES_DISCLOSURE, RegistrationReverted, type RelayResponse, type SubmitBody } from '../src/register.js'
import { approveCeiling } from '../src/fee-ceiling.js'
import { assertSubmittable } from '../../relayer/src/allowlist.js'
import { RELAYER_DOWN_NOTICE } from '../../relayer/src/funding-monitor.js'
import { SEND_CAP_NOTICE } from '../../relayer/src/sponsorship.js'
import { generateIdentity } from '../src/identity.js'

/** The module's own text, for the invariants only a source read can hold down. */
const SOURCE = readFileSync(new URL('../src/send.ts', import.meta.url), 'utf8')

const FEE_WEI = 6_000_000_000_000_000_000n
const HEAD = 1_000_000
const VALIDITY = 100

const ACCOUNT_KEY = generateIdentity().privateKey
const SELF = '0x0123456789abcdef'
const RECIPIENT = '0x0fedcba987654321'
const RELAYER_FEE_ADDRESS = `0x${'a'.repeat(63)}1`
const TX_HASH = '0xdeadbeef'
const USDC = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8'

const APPLY_ACTIONS: Call = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: ['0x1', '0x0'] }
const PROOF_FACTS = ['0x11', '0x22']
const MINTED = [0x111n]

function note(amount: bigint, token = STRK_TOKEN, id = amount) {
  return { id, token, amount, witness: { channelKey: 0x55n, nonce: 0, r: 0x66n } }
}

/** A clock the test advances by hand, so no test waits on a real one. */
function virtualClock(step = 1_000) {
  let t = 0
  return { now: () => t, advance: () => { t += step } }
}

/**
 * A timer that fires ONLY the zero-delay poll sleep, never a deadline.
 *
 * The distinction is load-bearing now that the maturity watcher deadlines each poll round
 * through the same injected timer: a fake that fires every delay synchronously would make the
 * round deadline beat every read, so a watcher that should succeed on the third look would loop
 * forever instead. The poll interval these tests pass is 0 and every round deadline is at
 * least 1, which is what separates them.
 */
function pollOnlyTimer(advance: () => void = () => {}) {
  return {
    setTimeout: (fn: () => void, ms: number) => {
      if (ms === 0) { advance(); fn() }
      return 0
    },
    clearTimeout: () => {},
  }
}

/** Fires every delay — for the one test where the round deadline is the thing under test. */
function everyDelayTimer(advance: () => void) {
  return {
    setTimeout: (fn: () => void) => { advance(); fn(); return 0 },
    clearTimeout: () => {},
  }
}

/** A wallet whose channels are all open, so a plain send opens nothing. */
function wallet(over: Partial<SendWalletData> = {}): SendWalletData {
  return {
    channels: [
      { address: SELF, publicKey: 0x77n, key: 0x88n, tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 3 }] },
      { address: RECIPIENT, publicKey: 0x99n, key: 0xaan, tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 1 }] },
    ],
    notes: [note(10n * FEE_WEI)],
    ...over,
  }
}

/**
 * Fakes that COUNT. The pipeline's central promise is that a route decided for free costs
 * nothing, and the only way to assert that is to be able to say "the prover was called zero
 * times" rather than "the prover probably was not called".
 */
function harness(over: Partial<SendDeps> = {}, input: Partial<Parameters<typeof sendShielded>[0]> = {}) {
  const proveCalls: unknown[] = []
  const relayCalls: SubmitBody[] = []
  const selfCalls: { calls: Call[]; details: { proofFacts: string[] } }[] = []
  const stages: SendStage[] = []
  const matureCalls: readonly bigint[][] = []

  const deps: SendDeps = {
    readHealth: async () => ({
      state: 'ok', feeWei: FEE_WEI, proofValidityBlocks: VALIDITY, blockNumber: HEAD,
    }),
    readBlockNumber: async () => HEAD,
    readRecipientKey: async () => 0x99n,
    readChannelCount: async () => 2,
    readFeeRecipient: async () => RELAYER_FEE_ADDRESS,
    prove: async (i): Promise<ProvedSend> => {
      proveCalls.push(i)
      return { call: APPLY_ACTIONS, proofFacts: PROOF_FACTS, provingBlockId: i.provingBlockId, mintedNoteIds: MINTED }
    },
    submit: async (_url, body): Promise<RelayResponse> => {
      relayCalls.push(body)
      return { status: 200, body: { transactionHash: TX_HASH } }
    },
    selfSubmit: async (calls, details) => {
      selfCalls.push({ calls, details })
      return TX_HASH
    },
    confirm: async () => 4242,
    confirmNoteMature: async (ids) => {
      ;(matureCalls as bigint[][]).push([...ids])
      return true
    },
    onStage: (s) => stages.push(s),
    ...over,
  }

  const account = { address: SELF, signer: {} as never }
  return {
    deps, proveCalls, relayCalls, selfCalls, stages, matureCalls,
    run: () =>
      sendShielded(
        {
          accountKey: ACCOUNT_KEY, account, kind: 'transfer', recipient: RECIPIENT,
          token: STRK_TOKEN, symbol: 'STRK', amount: 2n * FEE_WEI, mode: 'relayer',
          wallet: wallet(), ...input,
        },
        deps,
      ),
  }
}

// ── The happy paths (I/O matrix rows 1 and 2) ─────────────────────────────────────────────

describe('sendShielded — the relayer default', () => {
  it('reaches exactly build, prove, relay, mature, confirmed', async () => {
    const h = harness()
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(result.stages).toEqual(['build', 'prove', 'relay', 'mature', 'confirmed'])
    expect(h.stages).toEqual(['build', 'prove', 'relay', 'mature', 'confirmed'])
  })

  it('folds the fee leg at the advertised recipient and the LIVE fee', async () => {
    const h = harness()
    await h.run()
    const plan = (h.proveCalls[0] as { plan: SendPlan }).plan
    expect(plan.fee).toEqual({ recipient: RELAYER_FEE_ADDRESS, feeWei: FEE_WEI })
    // Two withdraws would be the user's leg plus the fee; a transfer has only the fee leg.
    expect(plannedVariants(plan).filter((v) => v === CLIENT_ACTION.Withdraw)).toHaveLength(1)
  })

  it('reports the relayer as the submitter and carries the fee row', async () => {
    const result = await harness().run()
    expect(result.ok && result.submittedBy).toBe('relayer')
    expect(result.ok && result.feeRow).toEqual({ submitter: 'Passbook', feeWei: FEE_WEI, paidByUs: true })
    expect(result.ok && result.selfSubmitted).toBeUndefined()
  })

  // A send is NOT a sponsorship: the fee comes back out of the user's own notes.
  it('never flags the submission sponsored', async () => {
    const h = harness()
    await h.run()
    expect(h.relayCalls).toHaveLength(1)
    expect(h.relayCalls[0]).not.toHaveProperty('sponsored')
    expect(Object.keys(h.relayCalls[0]!).sort()).toEqual(['calls', 'proofFacts'])
  })

  it('submits [approve, apply_actions] — the batch its own relayer allowlist accepts', async () => {
    const h = harness()
    await h.run()
    const calls = h.relayCalls[0]!.calls
    expect(calls.map((c) => c.entrypoint)).toEqual(['approve', 'apply_actions'])
    expect(calls[0]!.calldata).toEqual(
      CallData.compile([NET.pool, cairo.uint256(approveCeiling(FEE_WEI))]),
    )
    expect(() => assertSubmittable(calls, { maxApproveWei: approveCeiling(FEE_WEI) })).not.toThrow()
  })

  it('proves against a block behind the head, inside the live validity window', async () => {
    const h = harness()
    await h.run()
    expect((h.proveCalls[0] as { provingBlockId: number }).provingBlockId).toBe(HEAD - 10)
  })

  it('waits on the notes the send minted, and reports them', async () => {
    const h = harness()
    const result = await h.run()
    expect(h.matureCalls).toEqual([MINTED])
    expect(result.ok && result.maturedNoteIds).toEqual(MINTED)
    expect(result.ok && result.sendBlock).toBe(4242)
  })
})

describe('sendShielded — degraded self-submit', () => {
  const selfMode = { mode: 'self' as const }

  it('submits through the injected executor and never touches the relayer', async () => {
    const h = harness({}, selfMode)
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(result.stages).toEqual(['build', 'prove', 'relay', 'mature', 'confirmed'])
    expect(h.relayCalls).toHaveLength(0)
    expect(h.selfCalls).toHaveLength(1)
    expect(h.selfCalls[0]!.details).toEqual({ proofFacts: PROOF_FACTS })
    expect(h.selfCalls[0]!.calls.map((c) => c.entrypoint)).toEqual(['approve', 'apply_actions'])
  })

  it('builds NO fee leg — the user pays the pool directly through their own approve', async () => {
    const h = harness({}, selfMode)
    await h.run()
    const plan = (h.proveCalls[0] as { plan: SendPlan }).plan
    expect(plan.fee).toBeNull()
    expect(plannedVariants(plan)).not.toContain(CLIENT_ACTION.Withdraw)
  })

  it('never asks the relayer for a fee recipient it is not going to use', async () => {
    const readFee = vi.fn(async () => RELAYER_FEE_ADDRESS)
    await harness({ readFeeRecipient: readFee }, selfMode).run()
    expect(readFee).not.toHaveBeenCalled()
  })

  it('tags the result selfSubmitted, permanently, on success and on failure', async () => {
    const okResult = await harness({}, selfMode).run()
    expect(okResult.selfSubmitted).toBe(true)
    expect(okResult.ok && okResult.submittedBy).toBe('self')

    const failed = await harness(
      { selfSubmit: async () => { throw new Error('user rejected') } },
      selfMode,
    ).run()
    expect(failed.selfSubmitted).toBe(true)
    expect(failed.ok).toBe(false)
  })

  // Byte-exact and written out in full rather than compared to the constant it came from: a
  // failed self-submission really did cost the user gas, and an edit to this sentence has to be
  // made twice and show up in a diff.
  it('says the gas was spent, in exactly those words', async () => {
    const result = await harness(
      { selfSubmit: async () => { throw new Error('reverted') } },
      selfMode,
    ).run()
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('self-submit-failed')
    expect(!result.ok && result.failure.kind === 'self-submit-failed' && result.failure.gasLine)
      .toBe('Your wallet paid network gas for the failed attempt.')
    expect(SELF_SUBMIT_GAS_LOSS).toBe('Your wallet paid network gas for the failed attempt.')
  })

  it('refuses by default rather than pretending to submit', async () => {
    const result = await sendShielded(
      {
        accountKey: ACCOUNT_KEY, account: { address: SELF, signer: {} as never },
        kind: 'transfer', recipient: RECIPIENT, token: STRK_TOKEN, symbol: 'STRK',
        amount: 2n * FEE_WEI, mode: 'self', wallet: wallet(),
      },
      {
        readHealth: async () => ({ state: 'ok', feeWei: FEE_WEI, proofValidityBlocks: VALIDITY, blockNumber: HEAD }),
        readBlockNumber: async () => HEAD,
        readRecipientKey: async () => 0x99n,
        readChannelCount: async () => 2,
        prove: async (i) => ({ call: APPLY_ACTIONS, proofFacts: PROOF_FACTS, provingBlockId: i.provingBlockId, mintedNoteIds: [] }),
      },
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('self-submit-failed')
    expect(!result.ok && result.failure.kind === 'self-submit-failed' && result.failure.reason)
      .toMatch(/no self-submit executor/)
  })

  it('treats an executor that returns no hash as a transaction it cannot account for', async () => {
    const result = await harness({ selfSubmit: async () => '   ' }, selfMode).run()
    expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
  })
})

// ── The pre-flight, all of it free (I/O matrix rows 3–6) ──────────────────────────────────

describe('the pre-flight spends nothing', () => {
  it('routes an unregistered recipient to Door A with zero prover and relayer calls', async () => {
    const h = harness({ readRecipientKey: async () => 0n })
    const result = await h.run()
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('unregistered-recipient')
    expect(!result.ok && result.failure.kind === 'unregistered-recipient' && result.failure.door)
      .toEqual(DOOR_A_INVITE)
    expect(h.proveCalls).toHaveLength(0)
    expect(h.relayCalls).toHaveLength(0)
    expect(result.stages).toEqual([])
  })

  // Byte-exact: the transform replaces a form, so the sentence is the whole screen.
  it('ships the Door A copy verbatim', () => {
    expect(DOOR_A_INVITE.message).toBe(
      'This address has no account on this protocol. Private funds cannot reach it — ' +
        'the protocol rejects transfers to an unregistered key.',
    )
    expect(DOOR_A_INVITE.primaryAction).toBe('Send them an invite')
    expect(DOOR_A_INVITE.secondaryAction).toBe('we pay their registration')
  })

  it('fails closed when the recipient read throws — never "unregistered"', async () => {
    const h = harness({ readRecipientKey: async () => { throw new Error('rpc down') } })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('blocked-rpc-unknown')
    expect(h.proveCalls).toHaveLength(0)
  })

  it('does not check registration for a WITHDRAW — a public address needs none', async () => {
    const readKey = vi.fn(async () => 0n)
    const h = harness({ readRecipientKey: readKey }, { kind: 'withdraw' })
    const result = await h.run()
    expect(readKey).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })

  it('refuses a paused pool, an upgraded pool and an unreachable one, each in its own words', async () => {
    for (const [health, kind] of [
      [{ state: 'paused' as const }, 'pool-paused'],
      [{ state: 'upgraded' as const, pinned: 'a', onchain: 'b' }, 'pool-upgraded'],
      [{ state: 'unreachable' as const }, 'blocked-rpc-unknown'],
    ] as const) {
      const h = harness({ readHealth: async () => health })
      const result = await h.run()
      expect(!result.ok && result.failure.kind, JSON.stringify(health)).toBe(kind)
      expect(h.proveCalls).toHaveLength(0)
    }
  })

  it('names the shortfall when the notes do not cover the amount', async () => {
    const h = harness({}, { wallet: wallet({ notes: [note(FEE_WEI)] }) })
    const result = await h.run()
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure).toEqual({
      kind: 'insufficient-balance',
      token: STRK_TOKEN,
      symbol: 'STRK',
      neededWei: 3n * FEE_WEI,   // 2 to send + 1 fee, same token
      haveWei: FEE_WEI,
      shortfallWei: 2n * FEE_WEI,
      notice: 'Not enough shielded STRK',
    })
    expect(h.proveCalls).toHaveLength(0)
    expect(h.relayCalls).toHaveLength(0)
  })

  // A DIFFERENT failure, because it has a different fix: self-submission needs no shielded STRK.
  it('separates a missing fee balance from a missing send balance', async () => {
    const h = harness(
      {},
      {
        token: USDC, symbol: 'USDC', amount: 5n,
        wallet: wallet({
          channels: [
            { address: SELF, publicKey: 0x77n, key: 0x88n, tokens: [
              { token: USDC, tokenIndex: 0, noteNonce: 0 }, { token: STRK_TOKEN, tokenIndex: 1, noteNonce: 0 },
            ] },
            { address: RECIPIENT, publicKey: 0x99n, key: 0xaan, tokens: [{ token: USDC, tokenIndex: 0, noteNonce: 0 }] },
          ],
          notes: [note(5n, USDC, 1n)],   // enough USDC, no STRK at all
        }),
      },
    )
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('insufficient-fee-balance')
    expect(!result.ok && result.failure.kind === 'insufficient-fee-balance' && result.failure.notice)
      .toBe('Not enough shielded STRK')
    expect(h.proveCalls).toHaveLength(0)
  })

  it('relabels by symbol rather than saying "insufficient funds"', () => {
    expect(notEnoughShielded('USDC')).toBe('Not enough shielded USDC')
    expect(notEnoughShielded('STRK')).toBe('Not enough shielded STRK')
  })
})

// ── The relayer branches that are not dead ends (I/O matrix rows 7 and 8) ──────────────────

describe('a closed relayer branch always offers the other door', () => {
  it('carries the send-cap notice and the self-submit offer, never registration copy', async () => {
    const h = harness({
      submit: async () => ({
        status: 403,
        body: { error: 'relayed sends are paused', reason: 'send-cap-reached', notice: SEND_CAP_NOTICE },
      }),
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('send-cap-reached')
    const failure = !result.ok && result.failure.kind === 'send-cap-reached' ? result.failure : null
    expect(failure?.notice).toBe(SEND_CAP_NOTICE)
    expect(failure?.notice).not.toMatch(/registration|account/i)
    expect(failure?.selfSubmit.mode).toBe('self')
    expect(failure?.selfSubmit.feeRow).toEqual({ submitter: 'Passbook', feeWei: FEE_WEI, paidByUs: false })
    expect(failure?.selfSubmit.gasNotice).toBe(SELF_SUBMIT_GAS_LOSS)
    expect(result.stages).toEqual(['build', 'prove', 'relay'])
  })

  // The relayer's own sentence, not a second one that would drift from it. The body here is
  // the one the server actually sends — `packages/relayer/test/hardening.test.ts` pins that
  // shape from the other side, so neither half can change it alone.
  it('passes the relayer-down notice through byte-for-byte', async () => {
    const h = harness({
      submit: async () => ({
        status: 503,
        body: {
          error: 'the relayer is not accepting submissions right now',
          reason: 'relayer-down',
          notice: RELAYER_DOWN_NOTICE,
        },
      }),
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('relayer-down')
    const failure = !result.ok && result.failure.kind === 'relayer-down' ? result.failure : null
    expect(failure?.notice).toBe(RELAYER_DOWN_NOTICE)
    expect(failure?.notice).toBe(
      'The relayer is not submitting right now. You can still submit from a funded Starknet wallet.',
    )
    expect(failure?.selfSubmit.disclosure).toBe(SELF_SUBMIT_DISCLOSURE)
  })

  it('reports a 200 it cannot read as a transaction in flight, never as a refusal', async () => {
    const result = await harness({
      submit: async () => ({ status: 200, body: {}, bodyUnreadable: true }),
    }).run()
    expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
  })

  it('reports an ordinary refusal as one, with the status attached', async () => {
    const result = await harness({
      submit: async () => ({ status: 400, body: { error: 'malformed' } }),
    }).run()
    expect(!result.ok && result.failure).toEqual({ kind: 'relay-refused', status: 400, reason: 'malformed' })
  })

  // A send never asks for sponsorship, so this answer means the relayer is metering it against
  // the wrong budget. It used to fall through to `relay-refused` carrying the registration
  // notice as its reason — a send surface would have rendered account-creation copy.
  it('gives sponsorship-paused its own branch instead of leaking registration copy', async () => {
    const result = await harness({
      submit: async () => ({
        status: 403,
        body: {
          error: 'sponsored submissions are paused',
          reason: 'sponsorship-paused',
          notice: 'Sponsored registrations are paused until 00:00 UTC. You can still create an account from a funded Starknet wallet.',
        },
      }),
    }).run()
    expect(!result.ok && result.failure.kind).toBe('sponsorship-paused')
    const failure = !result.ok && result.failure.kind === 'sponsorship-paused' ? result.failure : null
    expect(failure?.selfSubmit.mode).toBe('self')
    // The notice is carried verbatim for an operator to read, but the BRANCH is what a surface
    // renders from — and it is not the send-cap one, so no send screen shows registration copy.
    expect(failure?.notice).toMatch(/Sponsored registrations/)
  })

  // A blank notice renders as empty space where an explanation belongs.
  it('substitutes an honest sentence when the relayer sends no notice at all', async () => {
    for (const body of [
      { reason: 'send-cap-reached' },
      { reason: 'send-cap-reached', notice: '   ' },
    ]) {
      const result = await harness({ submit: async () => ({ status: 403, body }) }).run()
      const failure = !result.ok && result.failure.kind === 'send-cap-reached' ? result.failure : null
      expect(failure?.notice).toBe(
        'The relayer is not taking this send right now. You can still submit it from your own wallet.',
      )
    }
  })
})

describe('a relayer that is wired wrong is not a relayer that is down', () => {
  it('routes a missing fee recipient to its own branch with the self-submit offer', async () => {
    const h = harness({
      readFeeRecipient: async () => { throw new RelayerMisconfigured('the relayer did not advertise a fee recipient (503)') },
    })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('relayer-misconfigured')
    const failure = !result.ok && result.failure.kind === 'relayer-misconfigured' ? result.failure : null
    expect(failure?.selfSubmit.gasNotice).toBe(SELF_SUBMIT_GAS_LOSS)
    // Nothing was proved: the refusal is above the prove stage.
    expect(h.proveCalls).toHaveLength(0)
    expect(result.stages).toEqual([])
  })

  it('still calls an unreachable relayer blocked-rpc-unknown, which IS worth retrying', async () => {
    const result = await harness({
      readFeeRecipient: async () => { throw new Error('fetch failed') },
    }).run()
    expect(!result.ok && result.failure.kind).toBe('blocked-rpc-unknown')
  })
})

// The fee is mutable at ZERO upgrade delay, and the reimbursement leg is frozen into the proof.
describe('the fee is re-read under the lock', () => {
  const risen = { state: 'ok' as const, feeWei: FEE_WEI * 2n, proofValidityBlocks: VALIDITY, blockNumber: HEAD }
  const first = { state: 'ok' as const, feeWei: FEE_WEI, proofValidityBlocks: VALIDITY, blockNumber: HEAD }

  it('refuses rather than under-reimbursing when the fee rose mid-flight', async () => {
    let reads = 0
    const h = harness({ readHealth: async () => (++reads === 1 ? first : risen) })
    const result = await h.run()
    expect(!result.ok && result.failure).toEqual({
      kind: 'fee-moved', foldedWei: FEE_WEI, currentWei: FEE_WEI * 2n,
    })
    expect(result.stages).toEqual(['build'])
    expect(h.proveCalls).toHaveLength(0)
  })

  // A fall lands in the relayer's favour and hurts nobody, so it is not a refusal.
  it('proceeds when the fee FELL — the leg over-reimburses, which harms no one', async () => {
    let reads = 0
    const fallen = { ...first, feeWei: FEE_WEI / 2n }
    const result = await harness({ readHealth: async () => (++reads === 1 ? first : fallen) }).run()
    expect(result.ok).toBe(true)
  })

  it('does not re-read at all in self mode — there is no leg to under-pay', async () => {
    let reads = 0
    const result = await harness(
      { readHealth: async () => { reads += 1; return first } },
      { mode: 'self' },
    ).run()
    expect(result.ok).toBe(true)
    expect(reads).toBe(1)
  })
})

// ── Confirmation and maturity (I/O matrix rows 11 and 12) ─────────────────────────────────

describe('confirmation and maturity', () => {
  it('maps a revert to copy and keeps the stages it reached', async () => {
    const result = await harness({
      confirm: async () => { throw new RegistrationReverted('NOTE_NOT_FOUND') },
    }).run()
    expect(!result.ok && result.failure.kind).toBe('reverted')
    expect(!result.ok && result.failure.kind === 'reverted' && result.failure.message)
      .toBe('One of the notes in this send is no longer in the pool. Refresh and try again.')
    expect(!result.ok && result.failure.kind === 'reverted' && result.failure.transactionHash).toBe(TX_HASH)
    expect(result.stages).toEqual(['build', 'prove', 'relay'])
  })

  // "We stopped watching" and "it failed" are different sentences about different facts.
  it('stops at mature and says so, rather than calling an unripe note a failure', async () => {
    const result = await harness({ confirmNoteMature: async () => false }).run()
    expect(result.stages).toEqual(['build', 'prove', 'relay', 'mature'])
    expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
    const failure = !result.ok && result.failure.kind === 'confirmation-unknown' ? result.failure : null
    expect(failure?.transactionHash).toBe(TX_HASH)
    expect(failure?.reason).toMatch(/stopped watching/)
    expect(failure?.reason).not.toMatch(/failed/i)
  })

  it('enters mature even when the send minted nothing for the sender', async () => {
    const h = harness({
      prove: async (i) => ({ call: APPLY_ACTIONS, proofFacts: PROOF_FACTS, provingBlockId: i.provingBlockId, mintedNoteIds: [] }),
      confirmNoteMature: makeNoteMatureWatcher(async () => false),
    })
    const result = await h.run()
    expect(result.ok).toBe(true)
    expect(result.stages).toEqual(['build', 'prove', 'relay', 'mature', 'confirmed'])
  })

  it('polls get_note until the pool holds every minted note', async () => {
    let looks = 0
    const watcher = makeNoteMatureWatcher(async () => ++looks >= 3, pollOnlyTimer(), 0)
    expect(await watcher([1n])).toBe(true)
    expect(looks).toBe(3)
  })

  it('gives up watching at the deadline and answers false, not an exception', async () => {
    const clock = virtualClock()
    const watcher = makeNoteMatureWatcher(
      async () => false, pollOnlyTimer(clock.advance), 0, 2_500, clock.now,
    )
    expect(await watcher([1n])).toBe(false)
  })

  // Without a per-round deadline, one RPC that accepts the connection and never answers parks
  // the Promise.all forever — the overall deadline is only consulted between rounds, so it is
  // never reached, and the submit lock this runs under is held for the life of the tab.
  it('gives up on a hung read instead of holding the submit lock forever', async () => {
    const clock = virtualClock()
    const watcher = makeNoteMatureWatcher(
      () => new Promise<boolean>(() => {}),          // accepts, never answers
      everyDelayTimer(clock.advance),
      0,
      2_500,
      clock.now,
    )
    expect(await watcher([1n])).toBe(false)
  })

  it('keeps watching through a failed read — a broken read is not a missing note', async () => {
    let looks = 0
    const watcher = makeNoteMatureWatcher(
      async () => {
        looks += 1
        if (looks === 1) throw new Error('rpc blip')
        return true
      },
      pollOnlyTimer(),
      0,
    )
    expect(await watcher([1n])).toBe(true)
    expect(looks).toBe(2)
  })
})

// ── The lock ──────────────────────────────────────────────────────────────────────────────

describe('the submit lock', () => {
  it('reports an unavailable lock as its own failure, before proving', async () => {
    const h = harness({ acquireSubmitLock: async () => { throw new Error('ACCOUNT_OPEN_IN_ANOTHER_TAB') } })
    const result = await h.run()
    expect(!result.ok && result.failure.kind).toBe('lock-unavailable')
    expect(!result.ok && result.failure.kind === 'lock-unavailable' && result.failure.reason)
      .toMatch(/ACCOUNT_OPEN_IN_ANOTHER_TAB/)
    expect(h.proveCalls).toHaveLength(0)
  })

  it('releases on success and on failure', async () => {
    const release = vi.fn()
    await harness({ acquireSubmitLock: async () => release }).run()
    expect(release).toHaveBeenCalledTimes(1)

    const release2 = vi.fn()
    await harness({
      acquireSubmitLock: async () => release2,
      prove: async () => { throw new Error('prover down') },
    }).run()
    expect(release2).toHaveBeenCalledTimes(1)
  })

  // A finally that throws REPLACES the result, including a success.
  it('does not let a failing release erase a send that already happened', async () => {
    const result = await harness({
      acquireSubmitLock: async () => () => { throw new Error('release exploded') },
    }).run()
    expect(result.ok).toBe(true)
  })

  it('takes the lock BEFORE reading the channel count, so the index cannot go stale first', async () => {
    const order: string[] = []
    await harness({
      acquireSubmitLock: async () => { order.push('lock'); return () => order.push('release') },
      readChannelCount: async () => { order.push('channels'); return 2 },
    }).run()
    expect(order.slice(0, 2)).toEqual(['lock', 'channels'])
  })
})

// ── planSend, pure and free ───────────────────────────────────────────────────────────────

describe('planSend', () => {
  const relayerFee = { recipient: RELAYER_FEE_ADDRESS, feeWei: FEE_WEI }
  const transfer = { kind: 'transfer' as const, recipient: RECIPIENT, token: STRK_TOKEN, symbol: 'STRK', amount: 2n * FEE_WEI, mode: 'relayer' as const }

  it('plans a plain transfer as UseNote, two CreateEncNotes and the fee Withdraw', () => {
    const out = planSend(transfer, wallet(), SELF, relayerFee)
    expect(out.ok).toBe(true)
    expect(out.ok && plannedVariants(out.plan)).toEqual([
      CLIENT_ACTION.UseNote,        // the note being spent
      CLIENT_ACTION.CreateEncNote,  // the recipient's note
      CLIENT_ACTION.CreateEncNote,  // change back to us
      CLIENT_ACTION.Withdraw,       // the relayer's reimbursement
    ])
    expect(out.ok && out.plan.change).toEqual([{ token: STRK_TOKEN, amount: 7n * FEE_WEI }])
  })

  it('adds an OpenChannel and an OpenSubchannel when the recipient is new', () => {
    const fresh = wallet({
      channels: [
        { address: SELF, publicKey: 0x77n, key: 0x88n, tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 3 }] },
        { address: RECIPIENT, publicKey: 0x99n },   // registered, but no channel from us yet
      ],
    })
    const out = planSend(transfer, fresh, SELF, relayerFee)
    expect(out.ok && out.plan.openChannels).toEqual([RECIPIENT])
    expect(out.ok && out.plan.openSubchannels).toEqual([{ recipient: RECIPIENT, token: STRK_TOKEN }])
    expect(out.ok && plannedVariants(out.plan)).toEqual([
      CLIENT_ACTION.OpenChannel, CLIENT_ACTION.OpenSubchannel,
      CLIENT_ACTION.UseNote, CLIENT_ACTION.CreateEncNote, CLIENT_ACTION.CreateEncNote,
      CLIENT_ACTION.Withdraw,
    ])
  })

  it('plans a withdraw as a user leg plus the fee leg — the double-Withdraw shape', () => {
    const out = planSend({ ...transfer, kind: 'withdraw' }, wallet(), SELF, relayerFee)
    expect(out.ok && plannedVariants(out.plan)).toEqual([
      CLIENT_ACTION.UseNote,
      CLIENT_ACTION.CreateEncNote,   // change only; a withdraw creates no recipient note
      CLIENT_ACTION.Withdraw,        // the user's leg
      CLIENT_ACTION.Withdraw,        // the relayer's reimbursement
    ])
  })

  it('omits the fee leg entirely in self mode', () => {
    const out = planSend({ ...transfer, mode: 'self' }, wallet(), SELF, null)
    expect(out.ok && out.plan.fee).toBeNull()
    expect(out.ok && plannedVariants(out.plan)).not.toContain(CLIENT_ACTION.Withdraw)
  })

  it('produces a list that satisfies both protocol invariants', () => {
    const out = planSend(transfer, wallet(), SELF, relayerFee)
    expect(out.ok).toBe(true)
    // The balance is what the pool squashes to zero; a plan that does not is a paid revert.
    expect(() => planToValidatableActions((out as { plan: SendPlan }).plan)).not.toThrow()
  })

  it('refuses a zero or negative amount, a zero recipient, and a malformed address', () => {
    const cases: [string, Partial<typeof transfer>][] = [
      ['a zero amount', { amount: 0n }],
      ['a negative amount', { amount: -1n }],
      ['the zero address', { recipient: '0x0' }],
      ['a malformed address', { recipient: 'not-a-felt' }],
    ]
    for (const [label, over] of cases) {
      const out = planSend({ ...transfer, ...over }, wallet(), SELF, relayerFee)
      expect(out.ok, label).toBe(false)
      expect(!out.ok && out.failure.kind, label).toBe('bad-input')
    }
  })

  it('refuses relayer mode with no advertised fee recipient rather than guessing one', () => {
    const out = planSend(transfer, wallet(), SELF, null)
    expect(!out.ok && out.failure.kind).toBe('bad-input')
  })

  it('refuses a recipient it has no channel data for', () => {
    const out = planSend(transfer, wallet({ channels: [
      { address: SELF, publicKey: 0x77n, key: 0x88n, tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 3 }] },
    ] }), SELF, relayerFee)
    expect(!out.ok && out.failure.kind).toBe('bad-input')
  })

  it('needs no change note when the notes cover the outputs exactly', () => {
    const exact = wallet({ notes: [note(3n * FEE_WEI)] })
    const out = planSend(transfer, exact, SELF, relayerFee)
    expect(out.ok && out.plan.change).toEqual([])
    expect(out.ok && plannedVariants(out.plan)).toEqual([
      CLIENT_ACTION.UseNote, CLIENT_ACTION.CreateEncNote, CLIENT_ACTION.Withdraw,
    ])
  })
})

// Spending every note the wallet holds would make each send a full consolidation: fifty dust
// notes, fifty nullifier writes and one enormous proof, to move three STRK.
describe('planSend selects coins rather than sweeping the wallet', () => {
  const relayerFee = { recipient: RELAYER_FEE_ADDRESS, feeWei: FEE_WEI }
  const transfer = { kind: 'transfer' as const, recipient: RECIPIENT, token: STRK_TOKEN, symbol: 'STRK', amount: 2n * FEE_WEI, mode: 'relayer' as const }

  it('takes only as many notes as the amount plus the fee needs', () => {
    const many = wallet({ notes: [note(FEE_WEI, STRK_TOKEN, 1n), note(FEE_WEI, STRK_TOKEN, 2n), note(FEE_WEI, STRK_TOKEN, 3n), note(FEE_WEI, STRK_TOKEN, 4n), note(FEE_WEI, STRK_TOKEN, 5n)] })
    const out = planSend(transfer, many, SELF, relayerFee)
    // Three notes cover 2 to send + 1 fee exactly; the other two stay unspent.
    expect(out.ok && out.plan.spend[0]!.notes).toHaveLength(3)
    expect(out.ok && out.plan.change).toEqual([])
  })

  // Largest-first is the SDK's own strategy, and it is what stops someone raising the cost of
  // every future send by mailing a wallet dust.
  it('takes the largest notes first', () => {
    const mixed = wallet({ notes: [note(1n, STRK_TOKEN, 1n), note(9n * FEE_WEI, STRK_TOKEN, 2n), note(2n, STRK_TOKEN, 3n)] })
    const out = planSend(transfer, mixed, SELF, relayerFee)
    expect(out.ok && out.plan.spend[0]!.notes.map((n) => n.id)).toEqual([2n])
  })

  it('refuses a send that would need more input notes than the cap', () => {
    const dust = Array.from({ length: MAX_INPUT_NOTES + 1 }, (_, i) => note(FEE_WEI, STRK_TOKEN, BigInt(i + 1)))
    const out = planSend({ ...transfer, amount: BigInt(MAX_INPUT_NOTES) * FEE_WEI }, wallet({ notes: dust }), SELF, relayerFee)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.failure.kind).toBe('bad-input')
    expect(!out.ok && out.failure.kind === 'bad-input' && out.failure.reason).toMatch(/Consolidate first/)
  })

  it('refuses a duplicated note id — a note can only be spent once', () => {
    const doubled = wallet({ notes: [note(10n * FEE_WEI, STRK_TOKEN, 7n), note(10n * FEE_WEI, STRK_TOKEN, 7n)] })
    const out = planSend(transfer, doubled, SELF, relayerFee)
    expect(!out.ok && out.failure.kind).toBe('bad-input')
    expect(!out.ok && out.failure.kind === 'bad-input' && out.failure.reason).toMatch(/more than once/)
  })

  it('refuses a mode outside the union rather than defaulting to a fee-leg-less relayer batch', () => {
    const out = planSend({ ...transfer, mode: 'whatever' as never }, wallet(), SELF, relayerFee)
    expect(!out.ok && out.failure.kind).toBe('bad-input')
    expect(!out.ok && out.failure.kind === 'bad-input' && out.failure.reason).toMatch(/submit mode/)
  })

  it('turns a malformed felt anywhere in the caller data into a typed refusal, never a throw', () => {
    const cases: [string, SendWalletData][] = [
      ['a note token', wallet({ notes: [{ ...note(10n * FEE_WEI), token: 'nope' }] })],
      ['a channel address', wallet({ channels: [{ address: 'nope', publicKey: 1n, key: 2n }] })],
      ['a channel token', wallet({ channels: [
        { address: SELF, publicKey: 0x77n, key: 0x88n, tokens: [{ token: 'nope', tokenIndex: 0, noteNonce: 0 }] },
      ] })],
    ]
    for (const [label, w] of cases) {
      const out = planSend(transfer, w, SELF, relayerFee)
      expect(out.ok, label).toBe(false)
      expect(!out.ok && out.failure.kind, label).toBe('bad-input')
    }
  })

  it('refuses an advertised fee recipient of zero, exactly as it refuses a zero user recipient', () => {
    const out = planSend(transfer, wallet(), SELF, { recipient: '0x0', feeWei: FEE_WEI })
    expect(!out.ok && out.failure.kind).toBe('bad-input')
    expect(!out.ok && out.failure.kind === 'bad-input' && out.failure.reason).toMatch(/burn the reimbursement/)
  })
})

// The compiler emits phase-grouped, not token-grouped (compiler.js:154-164 declares the buckets,
// :377-379 flattens them in that order), so a two-token send interleaves by phase.
describe('planSend across two tokens — a USDC send with a STRK fee leg', () => {
  const relayerFee = { recipient: RELAYER_FEE_ADDRESS, feeWei: FEE_WEI }
  const twoToken: SendWalletData = {
    channels: [
      { address: SELF, publicKey: 0x77n, key: 0x88n, tokens: [
        { token: USDC, tokenIndex: 0, noteNonce: 2 }, { token: STRK_TOKEN, tokenIndex: 1, noteNonce: 5 },
      ] },
      { address: RECIPIENT, publicKey: 0x99n, key: 0xaan, tokens: [{ token: USDC, tokenIndex: 0, noteNonce: 1 }] },
    ],
    notes: [note(50n, USDC, 1n), note(10n * FEE_WEI, STRK_TOKEN, 2n)],
  }
  const request = { kind: 'transfer' as const, recipient: RECIPIENT, token: USDC, symbol: 'USDC', amount: 20n, mode: 'relayer' as const }

  it('plans one phase-grouped span across both tokens', () => {
    const out = planSend(request, twoToken, SELF, relayerFee)
    expect(out.ok).toBe(true)
    expect(out.ok && plannedVariants(out.plan)).toEqual([
      CLIENT_ACTION.UseNote,        // the USDC note
      CLIENT_ACTION.UseNote,        // the STRK note for the fee
      CLIENT_ACTION.CreateEncNote,  // 20 USDC to the recipient
      CLIENT_ACTION.CreateEncNote,  // 30 USDC change
      CLIENT_ACTION.CreateEncNote,  // 9 fees' worth of STRK change
      CLIENT_ACTION.Withdraw,       // the relayer's reimbursement, in STRK
    ])
  })

  it('spends each token from its own notes, in the order the builder is driven', () => {
    const out = planSend(request, twoToken, SELF, relayerFee)
    expect(out.ok && out.plan.spend.map((s) => s.token)).toEqual([USDC, STRK_TOKEN])
    expect(out.ok && out.plan.change).toEqual([
      { token: USDC, amount: 30n },
      { token: STRK_TOKEN, amount: 9n * FEE_WEI },
    ])
  })

  it('pins the values on every action, token by token', () => {
    const out = planSend(request, twoToken, SELF, relayerFee)
    if (!out.ok) throw new Error('fixture refused')
    const withdraw = out.plan.expectedActions.at(-1)!
    expect(withdraw.variant).toBe(CLIENT_ACTION.Withdraw)
    expect(withdraw.fields[0]).toBe(BigInt(RELAYER_FEE_ADDRESS))
    expect(withdraw.fields[1]).toBe(BigInt(STRK_TOKEN))
    expect(withdraw.fields[2]).toBe(FEE_WEI)
    const recipientNote = out.plan.expectedActions[2]!
    expect(recipientNote.fields[0]).toBe(BigInt(RECIPIENT))
    expect(recipientNote.fields[2]).toBe(BigInt(USDC))
    expect(recipientNote.fields[3]).toBe(20n)
  })
})

// ── The span assertions (AC2) ─────────────────────────────────────────────────────────────

/** One expected action with every field wildcarded — for the shape-only cases. */
const anyOf = (variant: number): ExpectedSendAction => ({
  variant,
  fields: Array<null>(CLIENT_ACTION_FELTS[variant]! - 1).fill(null),
})

/** `[count, ...items]`, each item `[variant, ...fields]`, `null` fields filled with 0n. */
function span(...expected: ExpectedSendAction[]): bigint[] {
  const out = [BigInt(expected.length)]
  for (const a of expected) out.push(BigInt(a.variant), ...a.fields.map((f) => f ?? 0n))
  return out
}

describe('assertSendSpan refuses anything the plan did not ask for', () => {
  const planned = [CLIENT_ACTION.UseNote, CLIENT_ACTION.CreateEncNote, CLIENT_ACTION.Withdraw].map(anyOf)

  it('accepts the exact planned sequence', () => {
    expect(() => assertSendSpan(span(...planned), planned)).not.toThrow()
  })

  // The three the SDK's auto-options would silently add.
  it('refuses an autoRegister SetViewingKey', () => {
    expect(() => assertSendSpan(span(anyOf(CLIENT_ACTION.SetViewingKey), ...planned), planned))
      .toThrow(/planned as 3/)
  })

  it('refuses an autoSetup OpenChannel', () => {
    expect(() => assertSendSpan(span(anyOf(CLIENT_ACTION.OpenChannel), ...planned), planned))
      .toThrow(/planned as 3/)
  })

  it('refuses an autoSelectNotes extra UseNote', () => {
    expect(() => assertSendSpan(span(anyOf(CLIENT_ACTION.UseNote), ...planned), planned))
      .toThrow(/planned as 3/)
  })

  it('refuses a Deposit that nobody planned, even at the right count', () => {
    const poisoned = [CLIENT_ACTION.Deposit, CLIENT_ACTION.CreateEncNote, CLIENT_ACTION.Withdraw].map(anyOf)
    expect(() => assertSendSpan(span(...poisoned), planned)).toThrow(/action 0 is Deposit/)
  })

  it('refuses an invoke-phase action outright — a send never carries one', () => {
    // Hand-built, because InvokeExternal has no fixed width to build from.
    const poisoned = [3n, BigInt(CLIENT_ACTION.UseNote), 0n, 0n, 0n, BigInt(CLIENT_ACTION.CreateEncNote), 0n, 0n, 0n, 0n, 0n, 0n, BigInt(CLIENT_ACTION.InvokeExternal), 0n, 0n]
    const withInvoke = [
      anyOf(CLIENT_ACTION.UseNote),
      anyOf(CLIENT_ACTION.CreateEncNote),
      { variant: CLIENT_ACTION.InvokeExternal, fields: [] },
    ]
    expect(() => assertSendSpan(poisoned, withInvoke)).toThrow(/no fixed felt width/)
  })

  it('refuses felts nobody looked at, even when every variant matched', () => {
    expect(() => assertSendSpan([...span(...planned), 0n], planned)).toThrow(/went uninspected/)
  })

  it('refuses a span that ends mid-action', () => {
    expect(() => assertSendSpan(span(...planned).slice(0, -2), planned)).toThrow(/uninspected|mid-action/)
  })

  it('refuses an empty span', () => {
    expect(() => assertSendSpan([], planned)).toThrow(/no action count/)
  })
})

// A variant sequence alone is not a check on what MOVES. These are the attacks that keep the
// planned shape and change the money.
describe('assertSendSpan pins the values, not only the shape', () => {
  const WITHDRAW = (to: bigint, token: bigint, amount: bigint): ExpectedSendAction => ({
    variant: CLIENT_ACTION.Withdraw,
    fields: [to, token, amount, null],   // to_addr, token, amount, random
  })
  const planned = [WITHDRAW(0xfeen, 0x99n, 100n)]

  it('accepts a span whose pinned fields all match', () => {
    expect(() => assertSendSpan(span(...planned), planned)).not.toThrow()
  })

  it('refuses a rewritten Withdraw recipient — same variants, different address', () => {
    const poisoned = span(WITHDRAW(0xbadn, 0x99n, 100n))
    expect(() => assertSendSpan(poisoned, planned)).toThrow(/field 0 is 2989/)
  })

  it('refuses an inflated Withdraw amount', () => {
    const poisoned = span(WITHDRAW(0xfeen, 0x99n, 999n))
    expect(() => assertSendSpan(poisoned, planned)).toThrow(/field 2 is 999/)
  })

  it('refuses a substituted token', () => {
    const poisoned = span(WITHDRAW(0xfeen, 0xdeadn, 100n))
    expect(() => assertSendSpan(poisoned, planned)).toThrow(/field 1 is 57005/)
  })

  // The compiler's own randomness and salts cannot be predicted, so those fields are wildcards —
  // and a wildcard has to actually let a different value through, or every real prove would fail.
  it('lets a null field carry whatever the compiler generated', () => {
    const compiled = span(...planned)
    compiled[compiled.length - 1] = 0x5a17_c0ffeen   // the `random` field, whatever it came out as
    expect(() => assertSendSpan(compiled, planned)).not.toThrow()
  })

  it('refuses a plan whose field list disagrees with the ABI', () => {
    const wrong = [{ variant: CLIENT_ACTION.Withdraw, fields: [1n, 2n] }]
    expect(() => assertSendSpan(span(...planned), wrong)).toThrow(/its ABI has 4/)
  })

  it('counts the felts the ABI says each variant occupies', () => {
    expect(expectedSpanFelts([CLIENT_ACTION.UseNote])).toBe(5)
    expect(expectedSpanFelts([CLIENT_ACTION.OpenChannel, CLIENT_ACTION.CreateEncNote])).toBe(13)
    expect(CLIENT_ACTION_FELTS[CLIENT_ACTION.Withdraw]).toBe(5)
  })
})

describe('assertChannelIndices', () => {
  /** OpenChannel is `[variant, recipient, index, random, salt]`. */
  const withIndex = (...indices: number[]) => {
    const out = [BigInt(indices.length)]
    for (const i of indices) out.push(BigInt(CLIENT_ACTION.OpenChannel), 0n, BigInt(i), 0n, 0n)
    return out
  }

  it('accepts a channel opened at the live count', () => {
    expect(() => assertChannelIndices(withIndex(2), 2)).not.toThrow()
  })

  // Live: `[SetViewingKey, OpenChannel(1)]` on a sender with no channels → INDEX_NOT_SEQUENTIAL.
  it('refuses a channel opened anywhere else, naming the revert it would earn', () => {
    expect(() => assertChannelIndices(withIndex(0), 2)).toThrow(/INDEX_NOT_SEQUENTIAL/)
    expect(() => assertChannelIndices(withIndex(3), 2)).toThrow(/INDEX_NOT_SEQUENTIAL/)
  })

  it('requires consecutive indices when a batch opens more than one', () => {
    expect(() => assertChannelIndices(withIndex(2, 3), 2)).not.toThrow()
    expect(() => assertChannelIndices(withIndex(2, 4), 2)).toThrow(/INDEX_NOT_SEQUENTIAL/)
  })

  it('is a no-op on a span that opens nothing', () => {
    expect(() => assertChannelIndices(span(anyOf(CLIENT_ACTION.UseNote)), 7)).not.toThrow()
  })

  // In `proveSend` this is unreachable, because `assertSendSpan` refuses an invoke first. Called
  // standalone it used to return quietly, which is a silent pass on a span it cannot walk.
  it('throws rather than passing quietly on a variant it cannot measure', () => {
    const withInvoke = [1n, BigInt(CLIENT_ACTION.InvokeExternal), 0n, 0n]
    expect(() => assertChannelIndices(withInvoke, 0)).toThrow(/no fixed felt width/)
  })
})

describe('assertProvenSendCall', () => {
  const proof = (over: Partial<{ output: string[] }> = {}) => ({
    data: '', proofFacts: PROOF_FACTS, output: over.output ?? [NET.poolClassHash, '0xaa', '0xbb'],
  })
  const call = (calldata: string[]): Call => ({ contractAddress: NET.pool, entrypoint: 'apply_actions', calldata })

  it('accepts apply_actions on the pinned class with a None screening Option', () => {
    expect(() => assertProvenSendCall(call(['0xaa', '0xbb', '0x1']), proof() as never)).not.toThrow()
  })

  it('refuses a call that is not apply_actions on the pool', () => {
    expect(() => assertProvenSendCall({ ...call(['0xaa', '0xbb', '0x1']), entrypoint: 'privacy_invoke' }, proof() as never))
      .toThrow(/expected apply_actions/)
    expect(() => assertProvenSendCall({ ...call(['0xaa', '0xbb', '0x1']), contractAddress: '0xdead' }, proof() as never))
      .toThrow(/expected apply_actions/)
  })

  // The proof's payload starts with the class hash of the pool it was compiled against, so this
  // is how we learn the pool did not move under the pin between the pin and this proof.
  it('refuses a proof compiled against a class this build was not pinned to', () => {
    expect(() => assertProvenSendCall(call(['0xaa', '0xbb', '0x1']), proof({ output: ['0xbeef', '0xaa', '0xbb'] }) as never))
      .toThrow(/pinned to/)
  })

  it('refuses a Some attestation — the pool rejects one on a batch with no deposit', () => {
    expect(() => assertProvenSendCall(call(['0xaa', '0xbb', '0x0']), proof() as never))
      .toThrow(/UNEXPECTED_SCREENING/)
  })

  it('refuses calldata whose length does not match the proven server actions', () => {
    expect(() => assertProvenSendCall(call(['0xaa', '0x1']), proof() as never)).toThrow(/server-action felts/)
  })

  it('is pinned to the class the evidence table was measured against', () => {
    expect(NET.poolClassHash).toBe(EXPECTED_POOL_CLASS_HASH)
  })
})

// ── The shim and the registry ─────────────────────────────────────────────────────────────

describe('the discovery shim', () => {
  it('answers channels from caller data and carries the live channel count', async () => {
    const shim = makeSendDiscovery(wallet(), 7)
    const answer = await shim.discoverChannels(BigInt(SELF), 1n, [BigInt(RECIPIENT)])
    expect(answer.total).toBe(7)
    expect(answer.channels?.get(BigInt(RECIPIENT))?.publicKey).toBe(0x99n)
  })

  it('reports the count even when the compiler asks for nothing else', async () => {
    const shim = makeSendDiscovery(wallet(), 7)
    expect((await shim.discoverChannels(BigInt(SELF), 1n, 'total-only')).total).toBe(7)
  })

  // A silently empty stub would let the compiler build a different transaction than the one
  // that was planned. These throw so the day 1.9 is genuinely needed is loud.
  it('throws on discoverNotes and discoverRequirement', async () => {
    const shim = makeSendDiscovery(wallet(), 0)
    await expect(shim.discoverNotes(1n, 1n)).rejects.toThrow(/must not reach discovery/)
    await expect(shim.discoverRequirement(1n, 1n, 1n, 1n)).rejects.toThrow(/must not reach discovery/)
  })
})

describe('the hand-assembled registry', () => {
  it('leaves out the channel the plan is about to open, so discovery is reached', () => {
    const registry = buildSendRegistry(wallet(), [RECIPIENT])
    expect(registry.channels.has(BigInt(RECIPIENT))).toBe(false)
    expect(registry.channels.has(BigInt(SELF))).toBe(true)
  })

  it('leaves out a channel that has no key — it is not context the compiler can use', () => {
    const registry = buildSendRegistry(
      wallet({ channels: [{ address: RECIPIENT, publicKey: 0x99n }] }),
      [],
    )
    expect(registry.channels.has(BigInt(RECIPIENT))).toBe(false)
  })

  // The SDK defaults a token it does not know to `{tokenIndex: 0, noteNonce: 0}`, which for an
  // existing subchannel writes the new note at an index that is already taken.
  it('carries the subchannel nonces the caller supplied rather than defaulting them', () => {
    const channel = toSdkChannel({
      address: SELF, publicKey: 0x77n, key: 0x88n,
      tokens: [{ token: STRK_TOKEN, tokenIndex: 2, noteNonce: 9 }],
    })
    expect(channel.tokens.get(STRK_TOKEN)).toEqual({ tokenIndex: 2, noteNonce: 9 })
  })
})

// ── Copy, and the invariants only a source read holds down ────────────────────────────────

describe('copy and fee rows', () => {
  // Derived from the row alone: a separate `mode` argument could disagree with `paidByUs` and
  // render "Submitted by you" over a row that says the relayer paid.
  it('keeps the pool disclosure ceiling and adds the sender-address one for self-submit', () => {
    expect(sendFeeRowCopy({ submitter: 'Passbook', feeWei: FEE_WEI, paidByUs: true }))
      .toEqual({
        line: 'Submitted by Passbook relayer · 6 STRK · reimbursed from your notes',
        disclosure: POOL_SEES_DISCLOSURE,
      })
    expect(sendFeeRowCopy({ submitter: 'Passbook', feeWei: FEE_WEI, paidByUs: false }))
      .toEqual({
        line: 'Submitted by you · 6 STRK · paid from your wallet',
        disclosure: SELF_SUBMIT_DISCLOSURE,
      })
    expect(SELF_SUBMIT_DISCLOSURE).toContain(POOL_SEES_DISCLOSURE)
  })

  it('builds the self-submit approve from the shared ceiling, never a forked one', () => {
    expect(selfSubmitApprove(FEE_WEI).calldata)
      .toEqual(CallData.compile([NET.pool, cairo.uint256(approveCeiling(FEE_WEI))]))
    expect(selfSubmitApprove(FEE_WEI).contractAddress).toBe(STRK_TOKEN)
  })

  it('maps the pool codes a send can actually hit, and passes unknown ones through', () => {
    expect(mapSendError('FINAL_BALANCE_MUST_BE_ZERO')).toMatch(/every wei/)
    expect(mapSendError('NEGATIVE_INTERMEDIATE_BALANCE')).toMatch(/spends more/)
    expect(mapSendError('RECIPIENT_NOT_REGISTERED')).toMatch(/invite/)
    expect(mapSendError('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('routes a registered recipient with their key', async () => {
    expect(await preflightRecipient(RECIPIENT, async () => 0x99n))
      .toEqual({ route: 'registered', publicKey: 0x99n })
  })
})

describe('the invariants a source read holds down', () => {
  // A hardcoded fee, duration, count or address would each be a claim about a mutable number.
  it('hardcodes no fee, no maturity duration and no relayer address', () => {
    expect(SOURCE).not.toMatch(/6 STRK|6n \* 10n|6_000_000_000_000_000_000/)
    // The only bare felt literal permitted is the STRK token, and it is imported rather than
    // written here. Nothing that looks like a relayer or pool address may appear.
    const felts = SOURCE.match(/0x[0-9a-fA-F]{20,}/g) ?? []
    expect(felts).toEqual([])
  })

  // Registration has four stages and no ripening step, and that has to stay true.
  it('leaves registration"s stage union alone', () => {
    const register = readFileSync(new URL('../src/register.ts', import.meta.url), 'utf8')
    expect(register).not.toMatch(/'mature'/)
  })

  it('turns OHTTP on and passes no auto-options to the SDK', () => {
    expect(SOURCE).toMatch(/ohttp: true/)
    for (const option of ['autoRegister', 'autoSetup', 'autoSelectNotes', 'autoDiscover']) {
      // Named in prose, never passed. A `false` here would be a key a later edit could flip.
      expect(SOURCE).not.toMatch(new RegExp(`${option}\\s*:`))
    }
  })

  it('banks the send probe rows as evidence', () => {
    const group = ACTION_LIST_EVIDENCE.find((g) => g.group.startsWith('send:'))
    expect(group).toBeTruthy()
    const rows = group!.rows.map((r) => r.join(' '))
    expect(rows.some((r) => r.includes('DOUBLE-WITHDRAW FEE FOLD COMPILES'))).toBe(true)
    expect(rows.some((r) => r.includes('NO_REPLAY_PROTECTION'))).toBe(true)
    expect(rows.some((r) => r.includes('FINAL_BALANCE_MUST_BE_ZERO'))).toBe(true)
  })
})

// ── The fee-recipient read ────────────────────────────────────────────────────────────────

describe('readFeeRecipient', () => {
  const withFetch = async (impl: typeof fetch, run: () => Promise<unknown>) => {
    const real = globalThis.fetch
    globalThis.fetch = impl
    try {
      return await run()
    } finally {
      globalThis.fetch = real
    }
  }

  it('reads the advertised address off the relayer', async () => {
    const seen: string[] = []
    const got = await withFetch(
      (async (url: string) => {
        seen.push(url)
        return { status: 200, json: async () => ({ feeRecipient: RELAYER_FEE_ADDRESS }) }
      }) as never,
      () => readFeeRecipient('/api/submit'),
    )
    expect(got).toBe(RELAYER_FEE_ADDRESS)
    expect(seen).toEqual(['/api/fee-recipient'])
  })

  it('throws rather than defaulting when the relayer advertises none', async () => {
    await expect(
      withFetch(
        (async () => ({ status: 503, json: async () => ({ error: 'no fee recipient' }) })) as never,
        () => readFeeRecipient('/api/submit'),
      ),
    ).rejects.toThrow(RelayerMisconfigured)
  })

  // `"0"` and `"0x0"` are perfectly well-formed felts. Sending a reimbursement there burns it,
  // so the value is checked as well as the shape.
  it.each(['not-a-felt', '', '   ', '0', '0x0'])(
    'refuses an advertised recipient of %s',
    async (feeRecipient) => {
      await expect(
        withFetch(
          (async () => ({ status: 200, json: async () => ({ feeRecipient }) })) as never,
          () => readFeeRecipient('/api/submit'),
        ),
      ).rejects.toThrow(RelayerMisconfigured)
    },
  )

  it('refuses a relayer URL it cannot derive the endpoint from, rather than GETting /submit', async () => {
    const fetched: string[] = []
    await expect(
      withFetch(
        (async (url: string) => { fetched.push(url); return { status: 200, json: async () => ({}) } }) as never,
        () => readFeeRecipient('https://relayer.example/v2/send'),
      ),
    ).rejects.toThrow(/does not end in \/submit/)
    expect(fetched).toEqual([])
  })

  it('gives up on a hung relayer instead of parking the send forever', async () => {
    const never = new Promise<never>(() => {})
    await expect(
      withFetch(
        (() => never) as never,
        () => readFeeRecipient('/api/submit', { setTimeout: (fn) => { fn(); return 0 }, clearTimeout: () => {} }, 5),
      ),
    ).rejects.toThrow(/timed out/)
  })
})
