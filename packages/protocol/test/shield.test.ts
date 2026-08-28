import { describe, expect, it } from 'vitest'

import { NET, STRK_TOKEN } from '../src/constants.js'
import { approveCeiling } from '../src/fee-ceiling.js'
import { CLIENT_ACTION } from '../src/message-book.js'
import {
  assertProvenShieldCall,
  assertShieldActionSpan,
  planShield,
  shieldApprovalCalls,
  shieldPoolModeForClassHash,
  type ShieldRequest,
} from '../src/shield.js'

const SELF = '0x1234'
const USDC = '0x5678'
const FEE = 6n * 10n ** 18n

const request = (over: Partial<ShieldRequest> = {}): ShieldRequest => ({
  accountKey: '0x1',
  account: { address: SELF, signer: {} as never },
  token: USDC,
  symbol: 'USDC',
  amount: 25_000_000n,
  publicTokenWei: 25_000_000n,
  publicStrkWei: approveCeiling(FEE),
  ...over,
})

const health = {
  state: 'ok' as const,
  feeWei: FEE,
  proofValidityBlocks: 100,
  blockNumber: 1000,
}

describe('shield planning', () => {
  it('builds separate USDC and STRK approvals', () => {
    const plan = planShield(request(), health)
    expect('kind' in plan).toBe(false)
    if ('kind' in plan) return
    expect(plan.approvalCalls.map((call) => call.contractAddress)).toEqual([USDC, STRK_TOKEN])
    expect(plan.feeCeilingWei).toBe(approveCeiling(FEE))
  })

  it('combines a STRK shield amount and fee ceiling in one approval', () => {
    const amount = 10n ** 18n
    const calls = shieldApprovalCalls(STRK_TOKEN, amount, approveCeiling(FEE))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.contractAddress).toBe(STRK_TOKEN)
    expect((calls[0]?.calldata as string[]).slice(-2)).toEqual([
      (amount + approveCeiling(FEE)).toString(),
      '0',
    ])
  })

  it('requires STRK amount plus the fee ceiling for a STRK shield', () => {
    const amount = 10n ** 18n
    const planned = planShield(
      request({
        token: STRK_TOKEN,
        symbol: 'STRK',
        amount,
        publicTokenWei: amount + approveCeiling(FEE) - 1n,
        publicStrkWei: amount + approveCeiling(FEE) - 1n,
      }),
      health,
    )
    expect(planned).toMatchObject({ kind: 'insufficient-public-token', symbol: 'STRK' })
  })

  it('requires public STRK for the fee when shielding USDC', () => {
    expect(planShield(request({ publicStrkWei: approveCeiling(FEE) - 1n }), health)).toMatchObject({
      kind: 'insufficient-public-strk',
    })
  })
})

describe('shield action assertions', () => {
  const deposit = [BigInt(CLIENT_ACTION.Deposit), BigInt(USDC), 25_000_000n]
  const note = [
    BigInt(CLIENT_ACTION.CreateEncNote),
    BigInt(SELF),
    99n,
    BigInt(USDC),
    25_000_000n,
    0n,
    77n,
  ]

  it('accepts exactly Deposit + encrypted note to self', () => {
    expect(() => assertShieldActionSpan([2n, ...deposit, ...note], request())).not.toThrow()
  })

  it('accepts only the necessary self-channel setup prefix', () => {
    const channel = [BigInt(CLIENT_ACTION.OpenChannel), BigInt(SELF), 0n, 1n, 2n]
    const subchannel = [
      BigInt(CLIENT_ACTION.OpenSubchannel),
      BigInt(SELF),
      99n,
      88n,
      0n,
      BigInt(USDC),
      3n,
    ]
    expect(() =>
      assertShieldActionSpan([4n, ...channel, ...subchannel, ...deposit, ...note], request()),
    ).not.toThrow()
  })

  it('rejects a withdraw or a note for another recipient', () => {
    const poisoned = [...note]
    poisoned[1] = 0x999n
    expect(() => assertShieldActionSpan([2n, ...deposit, ...poisoned], request())).toThrow(
      /not the reviewed note to self/,
    )
  })
})

describe('shield pool-version suffix', () => {
  it('classifies the pinned production pool as screening-capable', () => {
    expect(shieldPoolModeForClassHash(NET.poolClassHash)).toBe('screening')
  })

  it('requires a non-empty SDK attestation on the screening pool', () => {
    const proof = { output: [NET.poolClassHash, '0xaa', '0xbb'] }
    const valid = {
      contractAddress: NET.pool,
      entrypoint: 'apply_actions',
      calldata: ['0xaa', '0xbb', '0x0', '0x1', '0x2', '0x3'],
    }
    expect(() => assertProvenShieldCall(valid, proof as never, 'screening')).not.toThrow()
    expect(() =>
      assertProvenShieldCall({ ...valid, calldata: ['0xaa', '0xbb', '0x1'] }, proof as never, 'screening'),
    ).toThrow(/screening attestation/)
  })
})
