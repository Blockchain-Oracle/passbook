import { describe, it, expect, vi } from 'vitest'
import { ec } from 'starknet'

vi.mock('../src/pool.js', () => ({
  getPublicKey: vi.fn(),
}))
const { getPublicKey } = await import('../src/pool.js')
const { checkRegistrationState, preflightRegistration, deriveRegisteredPublicKey } =
  await import('../src/registration.js')
const { deriveViewingKey, deriveIdentityPublicKey, generateIdentity } =
  await import('../src/identity.js')
const { NET } = await import('../src/constants.js')

const ACCOUNT_KEY = generateIdentity().privateKey
const OURS = deriveRegisteredPublicKey(ACCOUNT_KEY)
const A_STRANGER = 0x999n

// A GOLDEN VECTOR, computed once on 24 Aug 2026 and pinned by hand.
//
// Every other assertion here checks the derivation against its own expression, which
// means a starknet.js or SDK change that altered `sign`, Poseidon or `getStarkKey` would
// move both sides together and recreate the 1.7 defect with a green suite. These three
// numbers do not move. They encode the semantics the SDK's own pool simulator implements
// (`internal/pool-simulator.js` `handleSetViewingKey` → `derivePublicKey(viewingKey)`),
// against SN_MAIN and the pinned mainnet pool. If this test fails, the derivation
// changed — do NOT re-record these values without establishing which side is now wrong,
// because the pool's copy of the key is written once and cannot be corrected.
const GOLDEN = {
  accountKey: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80',
  viewingKey: 0x3cbcc690e1ce1ee8182722587fbf81ca94483aa723d000658d50fe5970c6420n,
  registeredPublicKey: 0x440f789f9b3b794bf12f311763c8da5575015088e6830220cf62e61e37921a8n,
  chainId: '0x534e5f4d41494e',
  pool: '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
}

describe('deriveRegisteredPublicKey — the key the pool actually stores (1.7 defect)', () => {
  it('matches the pinned golden vector', () => {
    // Guards the vector itself: it is only meaningful while the app targets this pool.
    expect(NET.chainId).toBe(GOLDEN.chainId)
    expect(NET.pool).toBe(GOLDEN.pool)

    expect(deriveViewingKey(GOLDEN.accountKey, NET.chainId, NET.pool)).toBe(GOLDEN.viewingKey)
    expect(deriveRegisteredPublicKey(GOLDEN.accountKey)).toBe(GOLDEN.registeredPublicKey)
  })

  it('is getStarkKey of the VIEWING key, bound to this chain and pool', () => {
    const viewingKey = deriveViewingKey(ACCOUNT_KEY, NET.chainId, NET.pool)
    const hex = viewingKey.toString(16)
    expect(OURS).toBe(
      BigInt(ec.starkCurve.getStarkKey(`0x${hex.padStart(hex.length + (hex.length % 2), '0')}`)),
    )
  })

  // Odd-length hex is the classic way a byte-decoding path drops a leading nibble, and it
  // happens for roughly one key in sixteen — the worst possible failure rate, because it
  // is rare enough to ship and common enough to strand someone's account.
  it('is stable across many keys, including odd-length viewing-key hex', () => {
    let sawOddLength = false
    for (let i = 0; i < 64; i++) {
      const key = generateIdentity().privateKey
      const viewingKey = deriveViewingKey(key, NET.chainId, NET.pool)
      if (viewingKey.toString(16).length % 2 === 1) sawOddLength = true
      const derived = deriveRegisteredPublicKey(key)
      expect(derived).toBeGreaterThan(0n)
      expect(derived).toBe(deriveRegisteredPublicKey(key))
    }
    expect(sawOddLength).toBe(true)   // otherwise this test proved nothing
  })

  it('is NOT the account key\'s own public key — the derivation 1.7 compared against', () => {
    // The regression this exists to hold down: while these two were confused, every
    // correct paste on the collision screen was rejected as a stranger's key.
    expect(OURS).not.toBe(BigInt(deriveIdentityPublicKey(ACCOUNT_KEY)))
  })

  it('is deterministic for one account key', () => {
    expect(deriveRegisteredPublicKey(ACCOUNT_KEY)).toBe(OURS)
  })

  it('differs for a different pool — one pool cannot read another\'s registration', () => {
    const other = deriveViewingKey(ACCOUNT_KEY, NET.chainId, '0x1234')
    expect(BigInt(ec.starkCurve.getStarkKey(`0x${other.toString(16)}`))).not.toBe(OURS)
  })
})

describe('checkRegistrationState', () => {
  it('reports Unregistered when the chain has no key', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0n)
    expect((await checkRegistrationState(ACCOUNT_KEY, '0xabc')).state).toBe('Unregistered')
  })

  it('reports Registered when the on-chain key is the one this account key derives', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(OURS)
    expect((await checkRegistrationState(ACCOUNT_KEY, '0xabc')).state).toBe('Registered')
  })

  it('reports ForeignKey when a different key already occupies the address', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(A_STRANGER)
    const r = await checkRegistrationState(ACCOUNT_KEY, '0xabc')
    expect(r.state).toBe('ForeignKey')
    expect(r.onChainKey).toBe(A_STRANGER)
  })

  it('throws rather than guessing when the RPC is unreachable', async () => {
    vi.mocked(getPublicKey).mockRejectedValue(new Error('all RPC hosts failed'))
    await expect(checkRegistrationState(ACCOUNT_KEY, '0xabc')).rejects.toThrow(/RPC/)
  })

  // The derivation runs up front, so it runs on the branch that does not need it too.
  // Otherwise a malformed key reads back as a cheerful "Unregistered" — the one answer
  // that sends the caller on to spend money.
  it('throws on a malformed account key even when the address is unregistered', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0n)
    await expect(checkRegistrationState('not-a-key', '0xabc')).rejects.toThrow()
  })
})

describe('preflightRegistration — the free gate in front of the pipeline (AC4)', () => {
  it('routes a fresh address to unregistered', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0n)
    expect(await preflightRegistration(ACCOUNT_KEY, '0xabc')).toEqual({ route: 'unregistered' })
  })

  it('routes our own key to already-registered', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(OURS)
    expect(await preflightRegistration(ACCOUNT_KEY, '0xabc')).toEqual({
      route: 'already-registered',
      onChainKey: OURS,
    })
  })

  it('routes a foreign key to collision, carrying the on-chain key', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(A_STRANGER)
    expect(await preflightRegistration(ACCOUNT_KEY, '0xabc')).toEqual({
      route: 'collision',
      onChainKey: A_STRANGER,
    })
  })

  it('routes an unreadable chain to blocked-rpc-unknown, never to "free to register"', async () => {
    vi.mocked(getPublicKey).mockRejectedValue(new Error('all RPC hosts failed'))
    const r = await preflightRegistration(ACCOUNT_KEY, '0xabc')
    expect(r.route).toBe('blocked-rpc-unknown')
    expect(r.route === 'blocked-rpc-unknown' && r.reason).toMatch(/RPC/)
  })
})
