// The prove leg, with the SDK mocked.
//
// Its own file because `vi.mock` of the SDK is module-wide, and the rest of the pipeline
// suite drives an injected `prove` that must NOT be affected. Everything asserted here
// was previously covered only by a probe someone had to remember to run by hand.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hash } from 'starknet'

const createPrivateTransfers = vi.fn()
vi.mock('@starkware-libs/starknet-privacy-sdk', () => ({
  createPrivateTransfers: (params: unknown) => createPrivateTransfers(params),
}))

const { proveRegistration } = await import('../src/register.js')
const { NET } = await import('../src/constants.js')
const { generateIdentity } = await import('../src/identity.js')

const COMPILE_ACTIONS = hash.getSelectorFromName('compile_actions')
const ACCOUNT_KEY = generateIdentity().privateKey
const ACCOUNT = { address: '0x0123456789abcdef', signer: {} as never }
const BLOCK = 1_000_000

/** `[array_len=1, to, selector, inner_len, sender, viewingKey, ...span]`. */
function invocationCalldata(span: string[]): string[] {
  const inner = [ACCOUNT.address, '0x7', ...span]
  return ['0x1', NET.pool, COMPILE_ACTIONS, `0x${inner.length.toString(16)}`, ...inner]
}

const LONE_SET_VIEWING_KEY = ['0x1', '0x0', '0x2a']
const APPLY_ACTIONS = {
  contractAddress: NET.pool,
  entrypoint: 'apply_actions',
  calldata: ['0x1', '0x0'],
}

/** Captures how the SDK was configured and driven, so the guards can be asserted on. */
function mockSdk(
  over: {
    span?: string[]
    call?: { contractAddress: string; entrypoint: string; calldata: string[] }
    proofFacts?: string[]
    proofData?: string
  } = {},
) {
  const buildArgs: unknown[][] = []
  const createProofInvocationArgs: unknown[] = []
  const invocation = {
    invocation: { calldata: invocationCalldata(over.span ?? LONE_SET_VIEWING_KEY) },
    registry: {},
    warnings: [],
  }
  const builder = {
    register: () => builder,
    createProofInvocation: async (options: unknown) => {
      createProofInvocationArgs.push(options)
      return invocation
    },
  }
  const transfers = {
    build: (...args: unknown[]) => {
      buildArgs.push(args)
      return builder
    },
    executeWithInvocation: async () => ({
      callAndProof: {
        call: over.call ?? APPLY_ACTIONS,
        proof: {
          data: over.proofData ?? 'AQICtest-proof-blob',
          output: [],
          proofFacts: over.proofFacts ?? ['0x11', '0x22'],
        },
      },
    }),
  }
  createPrivateTransfers.mockReturnValue(transfers)
  return { buildArgs, createProofInvocationArgs }
}

const run = () =>
  proveRegistration({ accountKey: ACCOUNT_KEY, account: ACCOUNT, provingBlockId: BLOCK })

beforeEach(() => createPrivateTransfers.mockReset())

describe('proveRegistration wiring (AC2)', () => {
  it('returns the pool call, the proof facts, the proof blob, and the block it bound to', async () => {
    mockSdk()
    expect(await run()).toEqual({
      call: APPLY_ACTIONS,
      proofFacts: ['0x11', '0x22'],
      proof: 'AQICtest-proof-blob',
      provingBlockId: BLOCK,
    })
  })

  // `autoSetup`/`autoRegister` silently append an OpenChannel. Passing no argument is
  // stronger than passing `false`, and this is the assertion that keeps it that way.
  it('calls build() with NO options object at all', async () => {
    const sdk = mockSdk()
    await run()
    expect(sdk.buildArgs).toEqual([[]])
  })

  it('passes the proving block through to createProofInvocation and nothing else', async () => {
    const sdk = mockSdk()
    await run()
    expect(sdk.createProofInvocationArgs).toEqual([{ provingBlockId: BLOCK }])
  })

  it('turns OHTTP on, against the pinned prover and chain', async () => {
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

  it('derives the viewing key rather than taking one — and binds it to this pool', async () => {
    mockSdk()
    await run()
    const params = createPrivateTransfers.mock.calls[0]![0] as {
      viewingKeyProvider: { getViewingKey: () => Promise<bigint> }
    }
    const { deriveViewingKey } = await import('../src/identity.js')
    expect(await params.viewingKeyProvider.getViewingKey())
      .toBe(deriveViewingKey(ACCOUNT_KEY, NET.chainId, NET.pool))
  })

  // Registration compiles without an indexer. A stub that returned empties would hide the
  // day that stops being true; these throw so it would be loud.
  it('hands the SDK a discovery provider that refuses every call', async () => {
    mockSdk()
    await run()
    const params = createPrivateTransfers.mock.calls[0]![0] as {
      discoveryProvider: Record<string, () => Promise<unknown>>
    }
    for (const method of ['discoverNotes', 'discoverChannels', 'discoverRequirement']) {
      await expect(params.discoveryProvider[method]!()).rejects.toThrow(/must not reach discovery/)
    }
  })
})

describe('proveRegistration refuses what it should never prove', () => {
  it('refuses a compiled list with a second action — the autoSetup OpenChannel case', async () => {
    mockSdk({ span: ['0x2', '0x0', '0x2a', '0x1'] })
    await expect(run()).rejects.toThrow(/lone SetViewingKey/)
  })

  it('refuses a proven call that is not apply_actions', async () => {
    mockSdk({ call: { ...APPLY_ACTIONS, entrypoint: 'privacy_invoke' } })
    await expect(run()).rejects.toThrow(/expected apply_actions on the pool/)
  })

  it('refuses a proven call aimed somewhere other than the pool', async () => {
    mockSdk({ call: { ...APPLY_ACTIONS, contractAddress: '0xdead' } })
    await expect(run()).rejects.toThrow(/expected apply_actions on the pool/)
  })

  // Fail at the prove leg, where it is still free and still named correctly. Letting bad
  // facts through means discovering them as a relayer 400 that blames the relay leg —
  // after a sponsorship slot has been spent getting there.
  it('refuses an empty proofFacts array from the prover', async () => {
    mockSdk({ proofFacts: [] })
    await expect(run()).rejects.toThrow(/returned no proof facts/)
  })

  it('refuses proof facts that are not felts', async () => {
    mockSdk({ proofFacts: ['0x11', 'not-a-felt'] })
    await expect(run()).rejects.toThrow(/not a felt at index 1/)
  })

  // The sequencer takes proof_facts and proof together or not at all — verified live on
  // the first real broadcast (story 1.13). A prove that came back without the blob has
  // not produced a submittable transaction, and the refusal must land here, where the
  // failure is still `prover-failed` and free, not at a signed, paid-for broadcast.
  it('refuses a prover response whose proof blob is empty', async () => {
    mockSdk({ proofData: '' })
    await expect(run()).rejects.toThrow(/no proof blob alongside its facts/)
  })
})
