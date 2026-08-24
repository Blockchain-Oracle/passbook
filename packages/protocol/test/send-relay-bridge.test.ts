// The send pipeline's own relay hop, over real HTTP, and the three ways it can go wrong when
// nobody has injected a `submit` that politely resolves.
//
// WHY THIS FILE EXISTS SEPARATELY FROM send.test.ts. Every test there overrides `submit`, so
// `relay()`'s classification of a fetch that THREW — as opposed to one that answered — was
// unreachable: the `RelayDeliveryUnknown` branch, the branch that decides whether a user is told
// "nothing was sent" or "something may be in flight", had never executed. That distinction is
// the sharpest one in the module. A send commits notes; reporting a maybe-sent transaction as a
// clean refusal invites a retry that re-spends them, and the second one reverts on a nullifier
// the first already wrote — after the fee.
//
// Nothing is signed and nothing reaches a chain: the relayer's `submit` is a spy.
import { describe, it, expect, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Call } from 'starknet'
import { sendShielded, type SendDeps, type SendWalletData } from '../src/send.js'
import { RelayDeliveryUnknown, postSubmitToRelayer } from '../src/register.js'
import { NET, STRK_TOKEN } from '../src/constants.js'
import { generateIdentity } from '../src/identity.js'
import { approveCeiling } from '../../relayer/src/allowlist.js'
import { createRelayerServer, type SubmitCalls } from '../../relayer/src/server.js'
import { SponsorshipLedger, SEND_CAP_NOTICE } from '../../relayer/src/sponsorship.js'
import { MemorySponsorshipStore } from '../../relayer/src/sponsorship-store.js'

const FEE_WEI = 6_000_000_000_000_000_000n
const HEAD = 1_000_000
const PROOF_FACTS = ['0x50524f4f4631', '0xd204f0']
const PROOF_BLOB = 'AQICsend-bridge-proof-blob'
const SELF = '0x0123456789abcdef'
const RECIPIENT = '0x0fedcba987654321'
const RELAYER_FEE_ADDRESS = `0x${'a'.repeat(63)}1`
const ACCOUNT = { address: SELF, signer: {} as never }

const APPLY_ACTIONS: Call = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: ['0x1', '0x0'] }

const WALLET: SendWalletData = {
  channels: [
    { address: SELF, publicKey: 0x77n, key: 0x88n, tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 3 }] },
    { address: RECIPIENT, publicKey: 0x99n, key: 0xaan, tokens: [{ token: STRK_TOKEN, tokenIndex: 0, noteNonce: 1 }] },
  ],
  notes: [{ id: 0x11n, token: STRK_TOKEN, amount: 10n * FEE_WEI, witness: { channelKey: 0x55n, nonce: 0, r: 0x66n } }],
}

async function startRelayer(extra: Partial<Parameters<typeof createRelayerServer>[0]> = {}) {
  const submit = vi.fn<SubmitCalls>(async () => '0xbridged')
  const server = createRelayerServer({
    submit,
    resolveApproveCeiling: async () => approveCeiling(FEE_WEI),
    feeRecipient: RELAYER_FEE_ADDRESS,
    ...extra,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    submit,
    url: `http://127.0.0.1:${port}/submit`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

/** Everything injected EXCEPT `submit` — that is the hop under test. */
function deps(over: Partial<SendDeps> = {}): SendDeps {
  return {
    readHealth: async () => ({ state: 'ok', feeWei: FEE_WEI, proofValidityBlocks: 100, blockNumber: HEAD }),
    readBlockNumber: async () => HEAD,
    readRecipientKey: async () => 0x99n,
    readChannelCount: async () => 2,
    readFeeRecipient: async () => RELAYER_FEE_ADDRESS,
    prove: async (input) => ({
      call: APPLY_ACTIONS, proofFacts: PROOF_FACTS, proof: PROOF_BLOB, provingBlockId: input.provingBlockId, mintedNoteIds: [],
    }),
    confirm: async () => 4242,
    confirmNoteMature: async () => true,
    ...over,
  }
}

const run = (relayerUrl: string, over: Partial<SendDeps> = {}) =>
  sendShielded(
    {
      accountKey: generateIdentity().privateKey, account: ACCOUNT, relayerUrl,
      kind: 'transfer', recipient: RECIPIENT, token: STRK_TOKEN, symbol: 'STRK',
      amount: 2n * FEE_WEI, mode: 'relayer', wallet: WALLET,
    },
    deps(over),
  )

describe('the send relay hop, over real HTTP', () => {
  it('reaches a real relayer and comes back with its transaction hash', async () => {
    const relayer = await startRelayer()
    try {
      const result = await run(relayer.url)
      expect(result.ok).toBe(true)
      expect(result.ok && result.transactionHash).toBe('0xbridged')
      // The body the browser builds really is one this server accepts — including the absence of
      // the sponsored flag, which routes it to the send cap rather than the sponsorship budget.
      expect(relayer.submit).toHaveBeenCalledTimes(1)
      expect(relayer.submit.mock.calls[0]![1]).toEqual({ proofFacts: PROOF_FACTS, proof: PROOF_BLOB })
    } finally {
      await relayer.close()
    }
  })

  it('carries the real send-cap 403 through to the typed refusal and the self-submit offer', async () => {
    const sendBudget = new SponsorshipLedger(
      { perVisitor: 1, daily: 10 }, new MemorySponsorshipStore(), Date.now(), SEND_CAP_NOTICE,
    )
    const relayer = await startRelayer({ sendBudget })
    try {
      expect((await run(relayer.url)).ok).toBe(true)
      const refused = await run(relayer.url)
      expect(refused.ok).toBe(false)
      expect(!refused.ok && refused.failure.kind).toBe('send-cap-reached')
      const failure = !refused.ok && refused.failure.kind === 'send-cap-reached' ? refused.failure : null
      expect(failure?.notice).toBe(
        'Relayed sends are paused until 00:00 UTC. ' +
          'You can still submit this send from your own Starknet wallet.',
      )
      expect(failure?.selfSubmit.mode).toBe('self')
    } finally {
      await relayer.close()
    }
  })

  it('carries the real relayer-down 503 through, with the notice the server sent', async () => {
    const relayer = await startRelayer({ relayerState: () => 'relayer-down' })
    try {
      const result = await run(relayer.url)
      expect(!result.ok && result.failure.kind).toBe('relayer-down')
      const failure = !result.ok && result.failure.kind === 'relayer-down' ? result.failure : null
      expect(failure?.notice).toBe(
        'The relayer is not submitting right now. You can still submit from a funded Starknet wallet.',
      )
      // Nothing was signed: the gate is in front of the key.
      expect(relayer.submit).not.toHaveBeenCalled()
    } finally {
      await relayer.close()
    }
  })
})

// THE BRANCH THIS FILE WAS WRITTEN FOR. A send commits notes, so "nothing was sent" and
// "something may be in flight" have to stay different answers.
describe('a relay that never answered', () => {
  it('calls a refused connection a clean refusal — retrying it is free', async () => {
    // Bound and immediately closed, so the port is dead and the connect is REFUSED before any
    // byte leaves. Nothing can have been delivered.
    const probe = createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const { port } = probe.address() as AddressInfo
    await new Promise<void>((r) => probe.close(() => r()))

    const result = await run(`http://127.0.0.1:${port}/submit`)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('relay-refused')
    // Explicitly NOT the ambiguous one: a clean refusal is safe to retry, and saying otherwise
    // would strand a user who could simply try again.
    expect(!result.ok && result.failure.kind !== 'confirmation-unknown').toBe(true)
  })

  it('calls a hung relayer a transaction it cannot account for, never a refusal', async () => {
    // Accepts the connection and answers nothing. From here that is indistinguishable from a
    // relayer that signed, broadcast, and then failed to reply.
    const hung = createServer(() => {})
    await new Promise<void>((r) => hung.listen(0, '127.0.0.1', r))
    const { port } = hung.address() as AddressInfo
    try {
      const result = await run(`http://127.0.0.1:${port}/submit`, {
        // The real hop with a short deadline, so the real classification runs rather than a
        // reimplementation of it.
        submit: (url, body) => postSubmitToRelayer(url, body, 150),
      })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
      const failure = !result.ok && result.failure.kind === 'confirmation-unknown' ? result.failure : null
      // No hash: we never learned one, which is the worst case and must not be dressed up.
      expect(failure?.transactionHash).toBe('')
      expect(failure?.reason).toMatch(/may already be in flight/)
    } finally {
      await new Promise<void>((r) => hung.close(() => r()))
      hung.closeAllConnections?.()
    }
  })

  it('routes a RelayDeliveryUnknown from any submit implementation the same way', async () => {
    const result = await run('http://127.0.0.1:1/submit', {
      submit: async () => {
        throw new RelayDeliveryUnknown('the relayer did not answer; a transaction may already be in flight')
      },
    })
    expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
    expect(result.stages).toEqual(['build', 'prove', 'relay'])
  })
})
