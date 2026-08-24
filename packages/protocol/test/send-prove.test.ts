// The send prove leg, with the SDK mocked.
//
// Its own file because `vi.mock` of the SDK is module-wide, and the rest of the send suite
// drives an injected `prove` that must NOT be affected.
//
// This is also where the AC's POISONED FAKE SDK lives: a compiler that adds an action nobody
// planned is exactly what `autoSetup`/`autoRegister`/`autoSelectNotes` would do, and the only
// way to prove the pipeline refuses one before relaying is to hand it a compiler that does.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hash } from 'starknet'
import { AddressMap } from '@starkware-libs/starknet-privacy-sdk'

const createPrivateTransfers = vi.fn()
vi.mock('@starkware-libs/starknet-privacy-sdk', async () => {
  const actual = await vi.importActual<typeof import('@starkware-libs/starknet-privacy-sdk')>(
    '@starkware-libs/starknet-privacy-sdk',
  )
  return { ...actual, createPrivateTransfers: (params: unknown) => createPrivateTransfers(params) }
})

const { proveSend, planSend, CLIENT_ACTION_FELTS } = await import('../src/send.js')
type SendWalletData = import('../src/send.js').SendWalletData
type ExpectedSendAction = import('../src/send.js').ExpectedSendAction
const { NET, STRK_TOKEN } = await import('../src/constants.js')
const { CLIENT_ACTION } = await import('../src/message-book.js')
const { generateIdentity } = await import('../src/identity.js')

const COMPILE_ACTIONS = hash.getSelectorFromName('compile_actions')
const ACCOUNT_KEY = generateIdentity().privateKey
const SELF = '0x0123456789abcdef'
const RECIPIENT = '0x0fedcba987654321'
const RELAYER_FEE_ADDRESS = `0x${'a'.repeat(63)}1`
const BLOCK = 1_000_000
const FEE_WEI = 6_000_000_000_000_000_000n

const APPLY_ACTIONS = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: ['0xaa', '0xbb', '0x1'] }
const PROOF_OUTPUT = [NET.poolClassHash, '0xaa', '0xbb']

const WALLET: SendWalletData = {
  channels: [
    { address: SELF, publicKey: 0x77n, key: 0x88n, tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 3 }] },
    { address: RECIPIENT, publicKey: 0x99n, key: 0xaan, tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 1 }] },
  ],
  notes: [{ id: 0x11n, token: STRK_TOKEN, amount: 10n * FEE_WEI, witness: { channelKey: 0x55n, nonce: 0, r: 0x66n } }],
}

function planFor(over: Partial<Parameters<typeof planSend>[0]> = {}, wallet = WALLET) {
  const out = planSend(
    {
      kind: 'transfer', recipient: RECIPIENT, token: STRK_TOKEN, symbol: 'STRK',
      amount: 2n * FEE_WEI, mode: 'relayer', ...over,
    },
    wallet,
    SELF,
    { recipient: RELAYER_FEE_ADDRESS, feeWei: FEE_WEI },
  )
  if (!out.ok) throw new Error(`the fixture plan was refused: ${JSON.stringify(out.failure)}`)
  return out.plan
}

/** `[array_len=1, to, selector, inner_len, sender, viewingKey, ...span]`. */
function invocationCalldata(span: string[]): string[] {
  const inner = [SELF, '0x7', ...span]
  return ['0x1', NET.pool, COMPILE_ACTIONS, `0x${inner.length.toString(16)}`, ...inner]
}

/**
 * The span a faithful compiler would produce for these expected actions: every pinned field at
 * its planned value, every wildcard at zero — which is what a real compiler's randomness and
 * salts look like to an assertion that does not check them.
 *
 * `channelIndex` overrides the OpenChannel index, which the plan leaves wildcarded because
 * `assertChannelIndices` checks it against the LIVE count instead.
 */
function spanFor(expected: ExpectedSendAction[], channelIndex = 2): string[] {
  const out = [`0x${expected.length.toString(16)}`]
  for (const a of expected) {
    const fields = a.fields.map((f) => `0x${(f ?? 0n).toString(16)}`)
    if (a.variant === CLIENT_ACTION.OpenChannel) fields[1] = `0x${channelIndex.toString(16)}`
    out.push(`0x${a.variant.toString(16)}`, ...fields)
  }
  return out
}

/** One expected action with every field wildcarded — for the shape-only poison cases. */
const anyOf = (variant: number): ExpectedSendAction => ({
  variant,
  fields: Array<null>(CLIENT_ACTION_FELTS[variant]! - 1).fill(null),
})

/** Records how the SDK was configured and driven, so every guard can be asserted on. */
function mockSdk(
  over: {
    span?: string[]
    call?: { contractAddress: string; entrypoint: string; calldata: string[] }
    proofFacts?: string[]
    proofData?: string
    output?: string[]
    notes?: [string, { id: bigint }[]][]
  } = {},
) {
  const buildArgs: unknown[][] = []
  const driven: string[] = []
  const tokenCalls: Record<string, unknown[]> = {}
  const record = (what: string, ...args: unknown[]) => {
    driven.push(what)
    ;(tokenCalls[what] ??= []).push(args)
  }

  const tokenBuilder = {
    setup: (r: unknown) => (record('t.setup', r), tokenBuilder),
    inputs: (...notes: unknown[]) => (record('t.inputs', notes), tokenBuilder),
    transfer: (...o: unknown[]) => (record('t.transfer', o), tokenBuilder),
    withdraw: (...o: unknown[]) => (record('t.withdraw', o), tokenBuilder),
  }
  const invocation = {
    invocation: { calldata: invocationCalldata(over.span ?? spanFor(planFor().expectedActions)) },
    registry: {},
    warnings: [],
  }
  const builder = {
    setup: (r: unknown) => (record('setup', r), builder),
    surplusTo: (r: unknown) => (record('surplusTo', r), builder),
    with: (token: unknown) => (record('with', token), tokenBuilder),
    createProofInvocation: async (options: unknown) => (record('createProofInvocation', options), invocation),
  }
  // The REAL shape the SDK hands back: `PoolSimulator.updateRegistry` writes
  // `registry.notes.set(token, [...])` on an `AddressMap` keyed by TOKEN address
  // (`interfaces.d.ts` — "Notes by token address"; the compiler reads it as
  // `registry.notes.get(token)`). Built from the actual class rather than a hand-rolled
  // `{entries}` so this mock cannot drift from the container the production code walks.
  //
  // WHICH notes are in it is the pool simulator's rule, not ours: `handleCreateEncNote` tracks a
  // note only when `recipient_addr === this.userAddress` (both bigints — `AbstractPrivateTransfers`
  // does `this.user = toBigInt(userAddress)`), so the recipient's note never appears and only the
  // sender's own change and self-transfer notes do. That is exactly what `mintedNoteIds` claims.
  const notesAfter = new AddressMap<{ id: bigint }[]>(() => [])
  for (const [token, notes] of over.notes ?? [[STRK_TOKEN, [{ id: 0x999n }]]]) {
    notesAfter.set(token, notes)
  }
  const registryAfter = { channels: new AddressMap(), notes: notesAfter }
  const transfers = {
    build: (...args: unknown[]) => {
      buildArgs.push(args)
      return builder
    },
    executeWithInvocation: async () => ({
      callAndProof: {
        call: over.call ?? APPLY_ACTIONS,
        proof: { data: over.proofData ?? 'AQICsend-proof-blob', output: over.output ?? PROOF_OUTPUT, proofFacts: over.proofFacts ?? ['0x11', '0x22'] },
      },
      registry: registryAfter,
    }),
  }
  createPrivateTransfers.mockReturnValue(transfers)
  return { buildArgs, driven, tokenCalls }
}

const run = (plan = planFor(), channelCount = 2, wallet = WALLET) =>
  proveSend({
    accountKey: ACCOUNT_KEY,
    account: { address: SELF, signer: {} as never },
    provingBlockId: BLOCK,
    plan,
    wallet,
    channelCount,
  })

beforeEach(() => createPrivateTransfers.mockReset())

describe('proveSend wiring', () => {
  it('returns the pool call, the facts, the block, and the notes it minted', async () => {
    mockSdk()
    expect(await run()).toEqual({
      call: APPLY_ACTIONS,
      proofFacts: ['0x11', '0x22'],
      proof: 'AQICsend-proof-blob',
      provingBlockId: BLOCK,
      mintedNoteIds: [0x999n],
    })
  })

  // `{ registry }` and nothing else. Every other ExecuteOptions key is an auto-behaviour that
  // would change the compiled list away from the plan whose balance was checked for free.
  it('passes the registry to build() and no auto-options at all', async () => {
    const sdk = mockSdk()
    await run()
    expect(sdk.buildArgs).toHaveLength(1)
    const options = sdk.buildArgs[0]![0] as Record<string, unknown>
    expect(Object.keys(options)).toEqual(['registry'])
    expect(options.registry).toBeTruthy()
  })

  // The compiler short-circuits before it ever asks discovery when every recipient it needs is
  // already in the registry — and it is that discovery call, and only that one, which carries
  // the channel count. So the channel being opened has to be missing from the registry.
  it('leaves the channel it is opening OUT of the registry, so discovery is reached', async () => {
    const fresh: SendWalletData = { ...WALLET, channels: [WALLET.channels[0]!, { address: RECIPIENT, publicKey: 0x99n }] }
    const plan = planFor({}, fresh)
    const sdk = mockSdk({ span: spanFor(plan.expectedActions) })
    await run(plan, 2, fresh)

    expect(plan.openChannels).toEqual([RECIPIENT])
    const { registry } = sdk.buildArgs[0]![0] as {
      registry: { channels: { has: (a: bigint) => boolean } }
    }
    expect(registry.channels.has(BigInt(RECIPIENT))).toBe(false)
    expect(registry.channels.has(BigInt(SELF))).toBe(true)
  })

  it('drives the builder in the order the compiler emits: setup, surplus, then per-token', async () => {
    const sdk = mockSdk()
    await run()
    expect(sdk.driven.slice(0, 2)).toEqual(['surplusTo', 'with'])
    expect(sdk.tokenCalls['surplusTo']).toEqual([[SELF]])
    expect(sdk.tokenCalls['with']).toEqual([[STRK_TOKEN]])
  })

  it('hands the planned notes in as explicit inputs', async () => {
    const sdk = mockSdk()
    await run()
    const inputs = sdk.tokenCalls['t.inputs']![0] as [{ id: bigint; amount: bigint }[]]
    expect(inputs[0].map((n) => n.id)).toEqual([0x11n])
    expect(inputs[0][0]!.amount).toBe(10n * FEE_WEI)
  })

  it('folds the fee leg in as a Withdraw naming the advertised recipient', async () => {
    const sdk = mockSdk()
    await run()
    const withdraws = sdk.tokenCalls['t.withdraw'] as [unknown[]][]
    expect(withdraws).toHaveLength(1)
    expect(withdraws[0]![0]).toEqual([{ recipient: RELAYER_FEE_ADDRESS, amount: FEE_WEI }])
  })

  it('builds no fee leg at all in self mode', async () => {
    const plan = planSend(
      { kind: 'transfer', recipient: RECIPIENT, token: STRK_TOKEN, symbol: 'STRK', amount: 2n * FEE_WEI, mode: 'self' },
      WALLET, SELF, null,
    )
    if (!plan.ok) throw new Error('fixture refused')
    const sdk = mockSdk({ span: spanFor(plan.plan.expectedActions) })
    await run(plan.plan)
    expect(sdk.tokenCalls['t.withdraw']).toBeUndefined()
    expect(sdk.tokenCalls['t.transfer']).toEqual([[[{ recipient: RECIPIENT, amount: 2n * FEE_WEI }]]])
  })

  it('opens each planned channel through setup(), in the plan"s order', async () => {
    const fresh: SendWalletData = { ...WALLET, channels: [WALLET.channels[0]!, { address: RECIPIENT, publicKey: 0x99n }] }
    const plan = planFor({}, fresh)
    const sdk = mockSdk({ span: spanFor(plan.expectedActions) })
    await run(plan, 2, fresh)
    expect(sdk.tokenCalls['setup']).toEqual([[RECIPIENT]])
    expect(sdk.tokenCalls['t.setup']).toEqual([[RECIPIENT]])
  })

  it('turns OHTTP on against the pinned prover, chain and pool', async () => {
    mockSdk()
    await run()
    const params = createPrivateTransfers.mock.calls[0]![0] as {
      provingProvider: { url: string; chainId: string; ohttp: boolean }
      poolContractAddress: string
    }
    expect(params.provingProvider.ohttp).toBe(true)
    expect(params.provingProvider.url).toBe(NET.prover)
    expect(params.provingProvider.chainId).toBe(NET.chainId)
    expect(params.poolContractAddress).toBe(NET.pool)
  })

  it('derives the viewing key rather than taking one, bound to this chain and pool', async () => {
    mockSdk()
    await run()
    const params = createPrivateTransfers.mock.calls[0]![0] as {
      viewingKeyProvider: { getViewingKey: () => Promise<bigint> }
    }
    const { deriveViewingKey } = await import('../src/identity.js')
    expect(await params.viewingKeyProvider.getViewingKey())
      .toBe(deriveViewingKey(ACCOUNT_KEY, NET.chainId, NET.pool))
  })

  it('hands the SDK the shim, which answers channels and refuses everything else', async () => {
    mockSdk()
    await run(planFor(), 7)
    const params = createPrivateTransfers.mock.calls[0]![0] as {
      discoveryProvider: {
        discoverChannels: (a: bigint, v: bigint, r: unknown) => Promise<{ total?: number }>
        discoverNotes: () => Promise<unknown>
        discoverRequirement: () => Promise<unknown>
      }
    }
    expect((await params.discoveryProvider.discoverChannels(1n, 1n, 'total-only')).total).toBe(7)
    await expect(params.discoveryProvider.discoverNotes()).rejects.toThrow(/must not reach discovery/)
    await expect(params.discoveryProvider.discoverRequirement()).rejects.toThrow(/must not reach discovery/)
  })

  it('passes the proving block through and nothing else', async () => {
    const sdk = mockSdk()
    await run()
    expect(sdk.tokenCalls['createProofInvocation']).toEqual([[{ provingBlockId: BLOCK }]])
  })
})

// The AC, exercised end to end at the prove leg: a compiler that adds an action nobody planned
// must stop the pipeline before anything is relayed.
describe('proveSend refuses a poisoned compiler', () => {
  const planned = planFor().expectedActions

  it('refuses an autoRegister SetViewingKey the plan never asked for', async () => {
    mockSdk({ span: spanFor([anyOf(CLIENT_ACTION.SetViewingKey), ...planned]) })
    await expect(run()).rejects.toThrow(/planned as \d+/)
  })

  it('refuses an autoSetup OpenChannel', async () => {
    mockSdk({ span: spanFor([anyOf(CLIENT_ACTION.OpenChannel), ...planned]) })
    await expect(run()).rejects.toThrow(/planned as \d+/)
  })

  it('refuses an extra UseNote of the compiler"s own choosing', async () => {
    mockSdk({ span: spanFor([anyOf(CLIENT_ACTION.UseNote), ...planned]) })
    await expect(run()).rejects.toThrow(/planned as \d+/)
  })

  it('refuses a Deposit smuggled in at the planned count', async () => {
    mockSdk({ span: spanFor([anyOf(CLIENT_ACTION.Deposit), ...planned.slice(1)]) })
    await expect(run()).rejects.toThrow(/is Deposit/)
  })

  // The attacks that keep the planned shape and change what actually moves. A variants-only
  // assertion passes every one of these.
  it('refuses a rewritten fee-leg recipient', async () => {
    const poisoned = planned.map((a) =>
      a.variant === CLIENT_ACTION.Withdraw ? { ...a, fields: [0xbadn, a.fields[1]!, a.fields[2]!, null] } : a,
    )
    mockSdk({ span: spanFor(poisoned) })
    await expect(run()).rejects.toThrow(/field 0 is 2989/)
  })

  it('refuses an inflated fee-leg amount', async () => {
    const poisoned = planned.map((a) =>
      a.variant === CLIENT_ACTION.Withdraw ? { ...a, fields: [a.fields[0]!, a.fields[1]!, FEE_WEI * 10n, null] } : a,
    )
    mockSdk({ span: spanFor(poisoned) })
    await expect(run()).rejects.toThrow(/field 2 is/)
  })

  it('refuses a rewritten note recipient — the money would reach the wrong account', async () => {
    const poisoned = planned.map((a, i) =>
      i === planned.findIndex((x) => x.variant === CLIENT_ACTION.CreateEncNote)
        ? { ...a, fields: [0xbadn, ...a.fields.slice(1)] }
        : a,
    )
    mockSdk({ span: spanFor(poisoned) })
    await expect(run()).rejects.toThrow(/field 0 is 2989/)
  })

  it('refuses a substituted input note — a different note than the one selected', async () => {
    const poisoned = planned.map((a) =>
      a.variant === CLIENT_ACTION.UseNote ? { ...a, fields: [0xdeadn, a.fields[1]!, a.fields[2]!] } : a,
    )
    mockSdk({ span: spanFor(poisoned) })
    await expect(run()).rejects.toThrow(/field 0 is 57005/)
  })

  it('refuses a channel opened at any index but the live count', async () => {
    const fresh: SendWalletData = { ...WALLET, channels: [WALLET.channels[0]!, { address: RECIPIENT, publicKey: 0x99n }] }
    const plan = planFor({}, fresh)
    mockSdk({ span: spanFor(plan.expectedActions, 0) })
    await expect(run(plan, 2, fresh)).rejects.toThrow(/INDEX_NOT_SEQUENTIAL/)
  })

  it('refuses a proven call that is not apply_actions on the pool', async () => {
    mockSdk({ call: { ...APPLY_ACTIONS, entrypoint: 'privacy_invoke' } })
    await expect(run()).rejects.toThrow(/expected apply_actions on the pool/)
  })

  it('refuses a proof compiled against a class this build is not pinned to', async () => {
    mockSdk({ output: ['0xbeef', '0xaa', '0xbb'] })
    await expect(run()).rejects.toThrow(/pinned to/)
  })

  it('refuses a screening attestation on a batch that deposits nothing', async () => {
    mockSdk({ call: { ...APPLY_ACTIONS, calldata: ['0xaa', '0xbb', '0x0'] } })
    await expect(run()).rejects.toThrow(/UNEXPECTED_SCREENING/)
  })

  // Fail at the prove leg, where it is still free and still named correctly. Letting bad facts
  // through means discovering them as a relayer 400 that blames the relay leg.
  it('refuses an empty proofFacts array from the prover', async () => {
    mockSdk({ proofFacts: [] })
    await expect(run()).rejects.toThrow(/returned no proof facts/)
  })

  it('refuses proof facts that are not felts', async () => {
    mockSdk({ proofFacts: ['0x11', 'not-a-felt'] })
    await expect(run()).rejects.toThrow(/not a felt at index 1/)
  })

  // The sequencer takes proof_facts and proof together or not at all (story 1.13's
  // first real broadcast). A prove without the blob is not a submittable transaction.
  it('refuses a prover response whose proof blob is empty', async () => {
    mockSdk({ proofData: '' })
    await expect(run()).rejects.toThrow(/no proof blob alongside its facts/)
  })
})
