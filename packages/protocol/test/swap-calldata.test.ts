import { describe, it, expect } from 'vitest'
import { hash, transaction } from 'starknet'

import { KNOWN_SELECTORS, invokeCalldata } from '../src/swap-calldata.js'
import { buildSwap, type SwapCall } from '../src/quote.js'

//
// THE PINS THAT MAKE THE HAND-ROLLED SERIALISER SAFE.
//
// `swap-calldata.ts` reimplements Cairo 1's `Span<Call>` layout and hardcodes its selectors,
// because `starknet.js` is banned from the browser bundle. This file is the other half of that
// trade: it runs in Node, where the library costs nothing, and holds the reimplementation to the
// real one. If they ever disagree, this fails rather than a mainnet transaction doing so.
//

describe('the selectors are the real ones', () => {
  for (const [name, pinned] of Object.entries(KNOWN_SELECTORS)) {
    it(`${name} matches starknet.js`, () => {
      expect(pinned).toBe(`0x${hash.starknetKeccak(name).toString(16)}`)
    })
  }

  it('covers exactly the entrypoints an AVNU private route uses', () => {
    // Measured live on a STRK -> USDC route: approve, then multi_route_swap. A third entrypoint
    // appearing means the venue changed the shape, and the serialiser must refuse until it is read.
    expect(Object.keys(KNOWN_SELECTORS).sort()).toEqual(['approve', 'multi_route_swap'])
  })
})

describe('the serialisation matches starknet.js byte for byte', () => {
  const calls: SwapCall[] = [
    {
      contractAddress: '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      entrypoint: 'approve',
      calldata: ['0x4270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f', '0xde0b6b3a7640000', '0x0'],
    },
    {
      contractAddress: '0x4270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f',
      entrypoint: 'multi_route_swap',
      calldata: ['0x1', '0x2', '0x3', '0x4', '0x5'],
    },
  ]

  it('produces the identical Span<Call> body', () => {
    const result = invokeCalldata({ buyToken: '0xabc', calls, openNoteId: '0xdef' })
    expect(result.state).toBe('ready')
    if (result.state !== 'ready') return

    // The reference implementation, from the library the browser cannot have.
    const reference = transaction
      .fromCallsToExecuteCalldata_cairo1(
        calls.map((call) => ({
          contractAddress: call.contractAddress,
          entrypoint: call.entrypoint,
          calldata: [...call.calldata],
        })),
      )
      .map((felt) => `0x${BigInt(felt).toString(16)}`)

    // Ours is the reference with the buy token in front and the note id behind — which is exactly
    // the executor's `privacy_invoke(buy_token, calls, note_id)` signature.
    expect(result.calldata).toEqual(['0xabc', ...reference, '0xdef'])
  })

  it('puts the buy token first and the note id last', () => {
    const result = invokeCalldata({ buyToken: '0x111', calls, openNoteId: '0x222' })
    if (result.state !== 'ready') throw new Error('expected calldata')
    expect(result.calldata[0]).toBe('0x111')
    expect(result.calldata[result.calldata.length - 1]).toBe('0x222')
  })

  it('normalises decimal and hex felts to one spelling', () => {
    // The venue mixes the two. `"1000"` decimal and `0x1000` are different numbers, and a reader
    // that guesses which is which is a reader that sends the wrong amount.
    const decimal = invokeCalldata({
      buyToken: '4095',
      calls: [{ ...calls[0]!, calldata: ['255'] }],
      openNoteId: '16',
    })
    if (decimal.state !== 'ready') throw new Error('expected calldata')
    expect(decimal.calldata[0]).toBe('0xfff')
    expect(decimal.calldata).toContain('0xff')
    expect(decimal.calldata[decimal.calldata.length - 1]).toBe('0x10')
  })
})

describe('what it refuses to serialise', () => {
  const good: SwapCall = { contractAddress: '0x1', entrypoint: 'approve', calldata: ['0x2'] }

  it('refuses an entrypoint it has not verified', () => {
    // THE SAFETY PROPERTY. These calls execute against a contract holding withdrawn funds, and
    // they arrive over HTTP from a third party.
    const result = invokeCalldata({
      buyToken: '0x1',
      calls: [{ ...good, entrypoint: 'drain_everything' }],
      openNoteId: '0x1',
    })
    expect(result.state).toBe('refused')
    if (result.state !== 'refused') return
    expect(result.because).toContain('drain_everything')
  })

  it('refuses an empty route', () => {
    expect(invokeCalldata({ buyToken: '0x1', calls: [], openNoteId: '0x1' }).state).toBe('refused')
  })

  it('refuses values that are not numbers', () => {
    expect(invokeCalldata({ buyToken: 'nope', calls: [good], openNoteId: '0x1' }).state).toBe('refused')
    expect(invokeCalldata({ buyToken: '0x1', calls: [good], openNoteId: 'nope' }).state).toBe('refused')
    expect(
      invokeCalldata({
        buyToken: '0x1',
        calls: [{ ...good, calldata: ['not a felt'] }],
        openNoteId: '0x1',
      }).state,
    ).toBe('refused')
  })

  it('never throws', () => {
    for (const bad of ['', '0x', 'ZZZ', '-1']) {
      expect(() => invokeCalldata({ buyToken: bad, calls: [good], openNoteId: bad })).not.toThrow()
    }
  })
})

describe('buildSwap', () => {
  const built = {
    executorAddress: '0x426dcd1ab5fa2f852f138d07cb37708b00a4db999677fe2d0c9a440702dbe5e',
    calls: [
      { contractAddress: '0x1', entrypoint: 'approve', calldata: ['0x2'] },
      { contractAddress: '0x3', entrypoint: 'multi_route_swap', calldata: [] },
    ],
  }

  it('converts basis points to the venue fraction in ONE place', async () => {
    // 100 bps is 0.01. `1` would be a hundred percent, and the mistake would be invisible.
    let sent: Record<string, unknown> | null = null
    await buildSwap('q', 100, {
      postJson: async (_url, body) => {
        sent = body as Record<string, unknown>
        return built
      },
    })
    expect(sent!.slippage).toBe(0.01)
    expect(sent!.private).toBe(true)
    expect(sent!.quoteId).toBe('q')
  })

  it('carries the executor the venue named', async () => {
    const result = await buildSwap('q', 100, { postJson: async () => built })
    expect(result.state).toBe('built')
    if (result.state !== 'built') return
    expect(result.plan.executorAddress).toBe(built.executorAddress)
    expect(result.plan.calls).toHaveLength(2)
  })

  it('REFUSES a response with no executor rather than remembering one', async () => {
    // Falling back to a known address would send funds to a contract the venue did not name for
    // this route.
    const result = await buildSwap('q', 100, { postJson: async () => ({ calls: built.calls }) })
    expect(result.state).toBe('failed')
  })

  it('refuses a malformed or empty call list', async () => {
    expect((await buildSwap('q', 100, { postJson: async () => ({ ...built, calls: [] }) })).state).toBe('failed')
    expect(
      (await buildSwap('q', 100, { postJson: async () => ({ ...built, calls: [{ entrypoint: 'approve' }] }) }))
        .state,
    ).toBe('failed')
  })

  it('degrades rather than throwing when the endpoint fails', async () => {
    const result = await buildSwap('q', 100, {
      postJson: async () => {
        throw new Error('502')
      },
    })
    expect(result.state).toBe('failed')
    if (result.state !== 'failed') return
    expect(result.because).toContain('Nothing was submitted')
  })

  it('refuses an unusable slippage before it reaches the venue', async () => {
    let asked = false
    const result = await buildSwap('q', 10_000, {
      postJson: async () => {
        asked = true
        return built
      },
    })
    expect(asked).toBe(false)
    expect(result.state).toBe('failed')
  })
})
