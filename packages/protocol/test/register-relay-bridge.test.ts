// The one production hop nothing else exercises: registerSponsored's own `postSubmit`
// talking over real HTTP to a real relayer server.
//
// Every other test injects `submit`, which means the fetch call, the JSON body shape, the
// server's body schema and the felt validation were each tested against an assumption
// about the other side rather than against the other side. This boots the actual server
// with a fake signer and drives the actual pipeline at it. Nothing is signed and nothing
// reaches a chain — `submit` is where the real key would be, and here it is a spy.
import { describe, it, expect, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Call } from 'starknet'
import {
  registerSponsored,
  postSubmitToRelayer,
  type RegisterDeps,
} from '../src/register.js'
import { NET, STRK_TOKEN } from '../src/constants.js'
import { generateIdentity } from '../src/identity.js'
import { approveCeiling } from '../../relayer/src/allowlist.js'
import { createRelayerServer, type SubmitCalls } from '../../relayer/src/server.js'
import { SponsorshipLedger } from '../../relayer/src/sponsorship.js'
import { MemorySponsorshipStore } from '../../relayer/src/sponsorship-store.js'

const FEE_WEI = 6_000_000_000_000_000_000n
const HEAD = 1_000_000
const PROOF_FACTS = ['0x50524f4f4631', '0xd204f0']
const ACCOUNT = { address: '0x0123456789abcdef', signer: {} as never }

const APPLY_ACTIONS: Call = {
  contractAddress: NET.pool,
  entrypoint: 'apply_actions',
  calldata: ['0x1', '0x0'],
}

async function startRelayer(extra: Partial<Parameters<typeof createRelayerServer>[0]> = {}) {
  const submit = vi.fn<SubmitCalls>(async () => '0xbridged')
  const server = createRelayerServer({
    submit,
    resolveApproveCeiling: async () => approveCeiling(FEE_WEI),
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
function deps(): RegisterDeps {
  return {
    canRegister: () => true,
    preflight: async () => ({ route: 'unregistered' }),
    readConstants: async () => ({
      feeWei: FEE_WEI, paused: false, proofValidityBlocks: 100, blockNumber: HEAD,
    }),
    readBlockNumber: async () => HEAD,
    prove: async (input) => ({
      call: APPLY_ACTIONS, proofFacts: PROOF_FACTS, provingBlockId: input.provingBlockId,
    }),
    confirm: async () => {},
  }
}

const run = (relayerUrl: string, over: RegisterDeps = {}) =>
  registerSponsored(
    { accountKey: generateIdentity().privateKey, account: ACCOUNT, relayerUrl },
    { ...deps(), ...over },
  )

describe('registerSponsored → relayer, over real HTTP', () => {
  it('delivers [approve, apply_actions] and the proof facts all the way to the signer', async () => {
    const relayer = await startRelayer()
    try {
      const result = await run(relayer.url)
      expect(result.ok).toBe(true)
      expect(result.ok && result.transactionHash).toBe('0xbridged')
      expect(result.stages).toEqual(['build', 'prove', 'relay', 'confirmed'])

      expect(relayer.submit).toHaveBeenCalledTimes(1)
      const [calls, details] = relayer.submit.mock.calls[0]!
      expect(calls.map((c) => c.entrypoint)).toEqual(['approve', 'apply_actions'])
      expect(calls[0]!.contractAddress).toBe(STRK_TOKEN)
      expect(calls[1]).toEqual(APPLY_ACTIONS)
      // The facts survived JSON, the body schema and the felt gate unchanged.
      expect(details).toEqual({ proofFacts: PROOF_FACTS })
    } finally {
      await relayer.close()
    }
  })

  it('carries a real 403 sponsorship-paused back as pay-your-own-way with the server notice', async () => {
    // A ledger with nothing left, so the refusal is the server's own, not a stub of it.
    const relayer = await startRelayer({
      sponsorship: new SponsorshipLedger(
        { perVisitor: 0, daily: 0 }, new MemorySponsorshipStore(),
      ),
    })
    try {
      const result = await run(relayer.url)
      expect(!result.ok && result.failure.kind).toBe('pay-your-own-way')
      expect(!result.ok && result.failure.kind === 'pay-your-own-way' && result.failure.notice)
        .toMatch(/00:00 UTC/)
      expect(relayer.submit).not.toHaveBeenCalled()
    } finally {
      await relayer.close()
    }
  })

  // The felt gate is the server's; this proves the pipeline's own output passes it and
  // that a violation comes back as a typed failure rather than an exception.
  it('surfaces a server refusal of malformed facts as relay-refused', async () => {
    const relayer = await startRelayer()
    try {
      const result = await run(relayer.url, {
        prove: async (input) => ({
          call: APPLY_ACTIONS,
          proofFacts: ['not-a-felt'],
          provingBlockId: input.provingBlockId,
        }),
      })
      expect(!result.ok && result.failure.kind).toBe('relay-refused')
      expect(!result.ok && result.failure.kind === 'relay-refused' && result.failure.status)
        .toBe(400)
      expect(relayer.submit).not.toHaveBeenCalled()
    } finally {
      await relayer.close()
    }
  })

  // ECONNREFUSED is the one shape we can be SURE about: the connection was rejected, so
  // nothing was delivered and retrying is free.
  it('returns a typed relay-refused when nothing is listening, rather than rejecting', async () => {
    const result = await run('http://127.0.0.1:59321/submit')
    expect(!result.ok && result.failure.kind).toBe('relay-refused')
    expect(!result.ok && result.failure.kind === 'relay-refused' && result.failure.status).toBe(0)
  })

  // The fail-safe default, and the reason the pre-send list is short: an error nobody has
  // classified must be treated as possibly-delivered, because that is the answer that
  // refuses to retry. `port 1` is one — undici rejects it as a "bad port" with no code.
  it('treats an unclassified fetch failure as possibly-delivered, not as a refusal', async () => {
    const result = await run('http://127.0.0.1:1/submit')
    expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
    expect(!result.ok && result.failure.kind === 'confirmation-unknown' && result.failure.reason)
      .toMatch(/may already be in flight/)
  })

  // R3(a): a server that accepts the socket and never answers. The relay hop has to give
  // up on its own deadline, report ambiguity, and — critically — release the lock.
  it('abandons a hung relayer at the deadline and reports it as possibly-delivered', async () => {
    const hung = createServer(() => { /* accept, read, never respond */ })
    await new Promise<void>((r) => hung.listen(0, '127.0.0.1', r))
    const { port } = hung.address() as AddressInfo
    let released = false
    try {
      const result = await run(`http://127.0.0.1:${port}/submit`, {
        acquireSubmitLock: async () => () => { released = true },
        // The REAL relay hop, with its own tiny deadline: RELAY_TIMEOUT_MS is a minute
        // and this test is not. Everything else about the path is production code.
        submit: (url, body) => postSubmitToRelayer(url, body, 150),
      })
      expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
      expect(released).toBe(true)
    } finally {
      hung.closeAllConnections()
      await new Promise<void>((r) => hung.close(() => r()))
    }
  })

  // R3(b): a relayer answering the four bytes `null`. `JSON.parse` yields null, not an
  // error, so an unguarded `.reason` read would be a TypeError from inside the client.
  it('survives a body of literal null with a typed failure', async () => {
    const nullish = createServer((_req, res) => {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end('null')
    })
    await new Promise<void>((r) => nullish.listen(0, '127.0.0.1', r))
    const { port } = nullish.address() as AddressInfo
    try {
      const result = await run(`http://127.0.0.1:${port}/submit`)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.failure.kind).toBe('relay-refused')
    } finally {
      await new Promise<void>((r) => nullish.close(() => r()))
    }
  })

  // A 200 with an unparseable body is the worst case: the server sends 200 only WITH a
  // hash, so a transaction exists and we have lost its id. It must not read as refused.
  it('treats a 200 whose body cannot be read as possibly-delivered', async () => {
    const garbled = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('<not json>')
    })
    await new Promise<void>((r) => garbled.listen(0, '127.0.0.1', r))
    const { port } = garbled.address() as AddressInfo
    try {
      const result = await run(`http://127.0.0.1:${port}/submit`)
      expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
      expect(!result.ok && result.failure.kind === 'confirmation-unknown' && result.failure.reason)
        .toMatch(/could not be read/)
    } finally {
      await new Promise<void>((r) => garbled.close(() => r()))
    }
  })

  it('treats a 200 carrying no usable hash as possibly-delivered', async () => {
    const empty = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ transactionHash: '   ' }))
    })
    await new Promise<void>((r) => empty.listen(0, '127.0.0.1', r))
    const { port } = empty.address() as AddressInfo
    try {
      const result = await run(`http://127.0.0.1:${port}/submit`)
      expect(!result.ok && result.failure.kind).toBe('confirmation-unknown')
      expect(!result.ok && result.failure.kind === 'confirmation-unknown' && result.failure.reason)
        .toMatch(/without a usable transaction hash/)
    } finally {
      await new Promise<void>((r) => empty.close(() => r()))
    }
  })
})
