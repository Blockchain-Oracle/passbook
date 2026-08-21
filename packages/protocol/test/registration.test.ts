import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/pool.js', () => ({
  getPublicKey: vi.fn(),
}))
const { getPublicKey } = await import('../src/pool.js')
const { checkRegistration } = await import('../src/registration.js')

describe('checkRegistration', () => {
  it('reports Unregistered when the chain has no key', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0n)
    const r = await checkRegistration('0xabc', '0x111')
    expect(r.state).toBe('Unregistered')
  })

  it('reports Registered when the on-chain key is ours', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0x111n)
    const r = await checkRegistration('0xabc', '0x111')
    expect(r.state).toBe('Registered')
  })

  it('reports ForeignKey when a different key already occupies the address', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0x999n)
    const r = await checkRegistration('0xabc', '0x111')
    expect(r.state).toBe('ForeignKey')
    expect(r.onChainKey).toBe(0x999n)
  })

  it('throws rather than guessing when the RPC is unreachable', async () => {
    vi.mocked(getPublicKey).mockRejectedValue(new Error('all RPC hosts failed'))
    await expect(checkRegistration('0xabc', '0x111')).rejects.toThrow(/RPC/)
  })
})
