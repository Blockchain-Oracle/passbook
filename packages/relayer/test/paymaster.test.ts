import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PoolConstants } from '../../protocol/src/pool.js'

// The chain read is mocked here on purpose. These are unit tests of fee-recipient
// wiring, and a real `readPoolConstants()` is four mainnet round-trips against
// vitest's 5 s default — the protocol package's live suite already owns that job
// with the 30 s budget it needs. Nothing about the live read goes uncovered.
vi.mock('../../protocol/src/pool.js', () => ({
  readPoolConstants: vi.fn(),
}))
const { readPoolConstants } = await import('../../protocol/src/pool.js')
const { RelayerPaymaster } = await import('../src/paymaster.js')

// Deliberately NOT the six STRK the pool charges today. It charged four earlier in
// its history and the upgrade delay is zero, so the fee is a variable, not a
// constant — a paymaster that hardcoded six would fail on this value alone.
const MOCK_FEE_WEI = 4_000_000_000_000_000_000n
const SIX_STRK_WEI = 6_000_000_000_000_000_000n

function mockPool(over: Partial<PoolConstants> = {}) {
  vi.mocked(readPoolConstants).mockResolvedValue({
    feeWei: MOCK_FEE_WEI,
    paused: false,
    proofValidityBlocks: 450,
    blockNumber: 13_650_965,
    ...over,
  })
}

describe('RelayerPaymaster', () => {
  // Call history accumulates across tests otherwise, which would let one test's
  // `toHaveBeenCalled` be satisfied by an earlier test's call.
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reimburses itself to the relayer address, never a hardcoded one', async () => {
    mockPool()
    const pm = new RelayerPaymaster({ relayerAddress: '0xRELAY', feeToken: '0xSTRK' })
    const built = await pm.buildTransaction({ actions: [] })
    const withdraw = built.feeAction
    expect(withdraw.type).toBe('withdraw')
    expect(withdraw.recipient).toBe('0xRELAY')
  })

  it('reads the fee live rather than hardcoding six STRK', async () => {
    mockPool()
    const pm = new RelayerPaymaster({ relayerAddress: '0xRELAY', feeToken: '0xSTRK' })
    const built = await pm.buildTransaction({ actions: [] })
    expect(built.feeAction.amount).toBeTypeOf('bigint')
    // The assertion carrying the requirement: the built amount is exactly what the
    // read returned, and is not the six STRK the pool happens to charge today.
    expect(built.feeAction.amount).toBe(MOCK_FEE_WEI)
    expect(built.feeAction.amount).not.toBe(SIX_STRK_WEI)
    expect(readPoolConstants).toHaveBeenCalled()
  })

  it('never exposes a credential to the caller', async () => {
    mockPool()
    const pm = new RelayerPaymaster({ relayerAddress: '0xRELAY', feeToken: '0xSTRK' })
    expect(JSON.stringify(pm)).not.toMatch(/PRIVATE_KEY|apiKey|secret/i)
  })

  // Beyond the three the plan specifies: the paused pool is a stated hard constraint,
  // and an error branch nobody exercises is an error branch nobody can trust.
  it('refuses to build while the pool is paused', async () => {
    mockPool({ paused: true })
    const pm = new RelayerPaymaster({ relayerAddress: '0xRELAY', feeToken: '0xSTRK' })
    await expect(pm.buildTransaction({ actions: [] })).rejects.toThrow(/paused/i)
  })
})
