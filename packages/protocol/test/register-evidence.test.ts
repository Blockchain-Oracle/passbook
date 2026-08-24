// The banked-registration evidence export (story 1.13 / FR-019).
//
// These tests hold the SHAPE of a record nothing can ever re-measure: the registration
// is write-once and the evidence guard refuses a second bank, so a corrupted literal
// here would go uncaught by any live path. What is checkable without a chain is that
// every hash is felt-shaped, every cost is a positive wei amount, the total is exactly
// its parts, and the provenance fields actually point at things.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SPONSORED_REGISTRATION_EVIDENCE } from '../src/register.js'
import { FELT_PRIME } from '../src/identity.js'

const E = SPONSORED_REGISTRATION_EVIDENCE

/** A hex felt: `0x` + hex, below the Stark field prime — not merely 64 nibbles long. */
function isFeltHash(value: string): boolean {
  return /^0x[0-9a-f]{1,64}$/.test(value) && BigInt(value) < FELT_PRIME
}

describe('SPONSORED_REGISTRATION_EVIDENCE (story 1.13)', () => {
  it('carries felt-shaped transaction hashes', () => {
    expect(isFeltHash(E.transactionHash)).toBe(true)
    expect(isFeltHash(E.accountDeployment.transactionHash)).toBe(true)
  })

  it('carries positive wei costs whose total is exactly its parts', () => {
    expect(E.poolFeeWei > 0n).toBe(true)
    expect(E.gasWei > 0n).toBe(true)
    expect(E.accountDeployment.feeWei > 0n).toBe(true)
    // The total is what the relayer wallet lost; anything other than fee + gas would
    // mean one of the three numbers was edited without the others.
    expect(E.totalWei).toBe(E.poolFeeWei + E.gasWei)
  })

  it('pins the registration to a real block, after the deployment it required', () => {
    expect(Number.isInteger(E.block) && E.block > 0).toBe(true)
    expect(Number.isInteger(E.accountDeployment.block) && E.accountDeployment.block > 0).toBe(true)
    // The prove leg needs the account deployed AT the proving block, so the deployment
    // cannot be later than the registration.
    expect(E.accountDeployment.block).toBeLessThan(E.block)
  })

  it('records a plausible prove time and a parseable timestamp', () => {
    expect(Number.isInteger(E.proveMs) && E.proveMs > 0).toBe(true)
    expect(Number.isNaN(Date.parse(E.measuredAt))).toBe(false)
  })

  it('points at an evidence record that exists and matches the export, field for field', () => {
    const record = JSON.parse(
      readFileSync(new URL(`../../../${E.record}`, import.meta.url), 'utf8'),
    ) as {
      registration: { transactionHash: string; block: number }
      cost: { poolFeeWei: string; gasWei: string; totalWei: string }
      timing: { proveMs: number }
      accountDeployment: {
        required: boolean
        deployTransactionHash: string
        deployBlock: number
        deployFeeWei: string
      }
      screeningImmunity: { confirmed: boolean }
      provenance: { createdAt: string }
    }
    expect(record.registration.transactionHash).toBe(E.transactionHash)
    expect(record.registration.block).toBe(E.block)
    expect(BigInt(record.cost.poolFeeWei)).toBe(E.poolFeeWei)
    expect(BigInt(record.cost.gasWei)).toBe(E.gasWei)
    expect(BigInt(record.cost.totalWei)).toBe(E.totalWei)
    expect(record.timing.proveMs).toBe(E.proveMs)
    expect(record.provenance.createdAt).toBe(E.measuredAt)
    // The deployment sub-record, whole: the two-transaction fact is only as credible as
    // the deployment transaction it cites.
    expect(record.accountDeployment.required).toBe(true)
    expect(record.accountDeployment.deployTransactionHash).toBe(E.accountDeployment.transactionHash)
    expect(record.accountDeployment.deployBlock).toBe(E.accountDeployment.block)
    expect(BigInt(record.accountDeployment.deployFeeWei)).toBe(E.accountDeployment.feeWei)
    // The export claims confirmed-in-practice; the record must actually say confirmed.
    expect(record.screeningImmunity.confirmed).toBe(true)
    expect(E.screeningImmunity).toMatch(/confirmed in practice/)
  })

  // The funding leg's record must be internally consistent — its befores were derived
  // from the receipt (the run that wrote it crashed post-broadcast and was recovered),
  // so the arithmetic IS the record's integrity check, not a tautology.
  it('the relayer-funding record reconciles: deployer paid amount + gas, relayer received amount', () => {
    const funding = JSON.parse(
      readFileSync(new URL('../../../evidence/relayer-funding.json', import.meta.url), 'utf8'),
    ) as {
      amountWei: string
      transferGasWei: string
      deployerBalanceBeforeWei: string
      deployerBalanceAfterWei: string
      relayerBalanceBeforeWei: string
      relayerBalanceAfterWei: string
    }
    const amount = BigInt(funding.amountWei)
    const gas = BigInt(funding.transferGasWei)
    expect(amount > 0n && gas > 0n).toBe(true)
    expect(BigInt(funding.deployerBalanceBeforeWei)).toBe(
      BigInt(funding.deployerBalanceAfterWei) + amount + gas,
    )
    expect(BigInt(funding.relayerBalanceAfterWei) - BigInt(funding.relayerBalanceBeforeWei)).toBe(
      amount,
    )
  })
})
