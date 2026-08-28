//
// `POST /api/faucet`, end to end over a real socket.
//
// This route sends REAL STRK on mainnet, so the assertions below are less about "does the happy
// path work" and more about the four ways it could quietly become a drain: an unmetered route, a
// re-claimable address, a client-chosen amount, and a burn to the zero address that answers 200.
//
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Call } from 'starknet'

import { createRelayerServer, type RelayerServerOptions } from '../src/server.js'
import { SponsorshipLedger } from '../src/sponsorship.js'
import { MemorySponsorshipStore } from '../src/sponsorship-store.js'
import { DRIP_BUDGET_SPENT, DRIP_WEI } from '../src/faucet.js'
import { STRK_TOKEN } from '../../protocol/src/constants.js'

const JSON_HEADERS = { 'content-type': 'application/json' }
const T0 = Date.UTC(2026, 7, 28, 12, 0, 0)

function ledger(perVisitor = 10, daily = 10): SponsorshipLedger {
  return new SponsorshipLedger(
    { perVisitor, daily },
    new MemorySponsorshipStore(),
    T0,
    DRIP_BUDGET_SPENT,
  )
}

async function start(extra: Partial<RelayerServerOptions> = {}) {
  const sent: Call[][] = []
  const server = createRelayerServer({
    submit: async (calls) => {
      sent.push(calls as Call[])
      return '0xdripped'
    },
    resolveApproveCeiling: async () => 0n,
    ...extra,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { port, sent, close: () => new Promise<void>((r) => server.close(() => r())) }
}

function post(port: number, path: string, body: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: JSON_HEADERS },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null })
          } catch (e) {
            reject(new Error(`expected JSON from ${path}: ${String(e)}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

const ADDRESS = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7'

describe('the route does not exist without a ledger', () => {
  it('is 404 when no faucet ledger is configured', async () => {
    // The ledger is the ONLY thing bounding what this route gives away, so there must be no
    // configuration in which it runs without one. Default-off is that guarantee.
    const s = await start()
    try {
      const res = await post(s.port, '/api/faucet', { address: ADDRESS })
      expect(res.status).toBe(404)
      expect(s.sent).toHaveLength(0)
    } finally {
      await s.close()
    }
  })
})

describe('the happy path', () => {
  it('sends exactly one STRK transfer, built entirely by the server', async () => {
    const s = await start({ faucet: ledger() })
    try {
      const res = await post(s.port, '/api/faucet', { address: ADDRESS })
      expect(res.status).toBe(200)
      expect(res.body.txHash).toBe('0xdripped')
      expect(res.body.amountWei).toBe(DRIP_WEI.toString())

      // ONE call, to STRK, `transfer`. Not a batch, not the pool, not anything the client named.
      expect(s.sent).toHaveLength(1)
      expect(s.sent[0]).toHaveLength(1)
      expect(s.sent[0]![0]!.contractAddress).toBe(STRK_TOKEN)
      expect(s.sent[0]![0]!.entrypoint).toBe('transfer')
    } finally {
      await s.close()
    }
  })

  it('ignores everything in the body except `address`', async () => {
    // The whole security argument of this route: a hostile body cannot widen it. `amount`,
    // `calls` and `entrypoint` are the three fields somebody would try.
    const s = await start({ faucet: ledger() })
    try {
      const res = await post(s.port, '/api/faucet', {
        address: ADDRESS,
        amount: '999999999999999999999999',
        amountWei: '999999999999999999999999',
        calls: [{ contractAddress: '0xevil', entrypoint: 'transfer', calldata: ['0xevil'] }],
        entrypoint: 'transferFrom',
      })
      expect(res.status).toBe(200)

      const call = s.sent[0]![0]!
      expect(call.contractAddress).toBe(STRK_TOKEN)
      expect(call.entrypoint).toBe('transfer')
      // The amount is the constant, not the number in the body.
      expect(BigInt((call.calldata as string[])[1]!)).toBe(DRIP_WEI)
      expect(s.sent[0]).toHaveLength(1)
    } finally {
      await s.close()
    }
  })
})

describe('once per address, ever', () => {
  it('refuses a second drip to the same address', async () => {
    const s = await start({ faucet: ledger() })
    try {
      expect((await post(s.port, '/api/faucet', { address: ADDRESS })).status).toBe(200)
      const second = await post(s.port, '/api/faucet', { address: ADDRESS })
      expect(second.status).toBe(429)
      expect(s.sent).toHaveLength(1)
    } finally {
      await s.close()
    }
  })

  it('NORMALISES the address, so a leading zero is not a second claim', async () => {
    // The bug this pins: `tryClaim` is string-set membership, so `0x123` and `0x0123` would be
    // two claims on one account — a second drip for free, by adding a character.
    const s = await start({ faucet: ledger() })
    try {
      expect((await post(s.port, '/api/faucet', { address: '0x123' })).status).toBe(200)
      expect((await post(s.port, '/api/faucet', { address: '0x0123' })).status).toBe(429)
      expect((await post(s.port, '/api/faucet', { address: '0X00000123' })).status).toBe(429)
      expect(s.sent).toHaveLength(1)
    } finally {
      await s.close()
    }
  })
})

describe('the budget bounds the day', () => {
  it('refuses once the daily budget is spent, with the notice and no send', async () => {
    // Two different addresses, so the per-address claim is not what stops the second one.
    const s = await start({ faucet: ledger(10, 1) })
    try {
      expect((await post(s.port, '/api/faucet', { address: '0x111' })).status).toBe(200)
      const second = await post(s.port, '/api/faucet', { address: '0x222' })
      expect(second.status).toBe(429)
      expect(second.body.error).toBe(DRIP_BUDGET_SPENT)
      expect(s.sent).toHaveLength(1)
    } finally {
      await s.close()
    }
  })

  it('refuses when the relayer cannot pay, without naming our balance', async () => {
    const s = await start({ faucet: ledger(), relayerState: () => 'relayer-down' })
    try {
      const res = await post(s.port, '/api/faucet', { address: ADDRESS })
      expect(res.status).toBe(503)
      // FR-053: the ordinary refusal, never a distinct "we are out of STRK" string.
      expect(res.body.error).toBe(DRIP_BUDGET_SPENT)
      expect(s.sent).toHaveLength(0)
    } finally {
      await s.close()
    }
  })
})

describe('bad addresses never reach the chain', () => {
  it('REFUSES the zero address, which parses fine and would burn the STRK', async () => {
    // The one failure of this route that costs money and answers 200.
    const s = await start({ faucet: ledger() })
    try {
      const res = await post(s.port, '/api/faucet', { address: '0x0' })
      expect(res.status).toBe(400)
      expect(s.sent).toHaveLength(0)
    } finally {
      await s.close()
    }
  })

  it('refuses a missing, empty or non-string address', async () => {
    const s = await start({ faucet: ledger() })
    try {
      for (const body of [{}, { address: '' }, { address: 42 }, { address: null }, { address: ['0x1'] }]) {
        expect((await post(s.port, '/api/faucet', body)).status).toBe(400)
      }
      expect(s.sent).toHaveLength(0)
    } finally {
      await s.close()
    }
  })
})

describe('a failed transfer is reported honestly', () => {
  it('answers 503 and does not claim a hash it never got', async () => {
    const s = await start({
      faucet: ledger(),
      submit: async () => {
        throw new Error('sequencer said no')
      },
    })
    try {
      const res = await post(s.port, '/api/faucet', { address: ADDRESS })
      expect(res.status).toBe(503)
      expect(res.body.txHash).toBeUndefined()
    } finally {
      await s.close()
    }
  })
})
