import { describe, it, expect } from 'vitest'
import { NET } from '../src/constants.js'
import { getProvider, withFallback } from '../src/rpc.js'

describe('getProvider', () => {
  // Shared instance, not just a shared URL: an Account built on it must see the same
  // nonce state as every other caller.
  it('caches one provider pointed at the first host', () => {
    expect(getProvider().channel.nodeUrl).toBe(NET.rpc[0])
    expect(getProvider()).toBe(getProvider())
  })
})

// No network: the callback decides success or failure, so these assert the fallback
// contract itself rather than whether any given host happens to be up today.
describe('withFallback', () => {
  it('tries every host in NET.rpc order until one succeeds', async () => {
    const tried: string[] = []
    const result = await withFallback(async (p) => {
      tried.push(p.channel.nodeUrl)
      if (tried.length < NET.rpc.length) throw new Error('host down')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(tried).toEqual([...NET.rpc])
  })

  it('stops at the first host that works', async () => {
    let calls = 0
    await withFallback(async () => {
      calls++
      return 'ok'
    })
    expect(calls).toBe(1)
  })

  it('throws only after every host has failed', async () => {
    let calls = 0
    await expect(
      withFallback(async () => {
        calls++
        throw new Error('host down')
      }),
    ).rejects.toThrow('all RPC hosts failed')
    expect(calls).toBe(NET.rpc.length)
  })
})
