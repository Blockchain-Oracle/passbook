import { describe, it, expect } from 'vitest'
import {
  registerSponsored, readReceiptBlockNumber, confirmFromReceipt, RegistrationReverted,
} from '../src/register.js'
import {
  generateIdentity, createBackup, restoreBackup, readBackupHeader, reissueBackupHeader,
} from '../src/identity.js'
import { issueBackup, confirmPastedCode, markFileSaved, makeCanRegister } from '../src/backup-gate.js'

//
// The post-registration re-issue, end to end (AC4, Abu's provisional + re-issue ruling).
//
// The header field `registrationBlock` cannot be true at backup time — backup GATES
// registration, so the block does not exist yet — and a field may not hold a different thing
// than its label says. So the first file carries `null` and a second file is written once the
// number is real. `RegisterResult.registrationBlock` is the input, and it exists only because
// the confirm receipt was already being fetched and thrown away.
//

const CONTEXT = { ok: true as const, backupBlock: 13_779_000, auditorKeyAtBackupBlock: '0xa0d17012' }
const ADDRESS = '0x0000000000000000000000000000000000000000000000000000000000000042'

/** A pipeline harness whose every leg succeeds, with an injectable confirm. */
function harness(confirm: (hash: string) => Promise<number | null | void>) {
  return {
    canRegister: () => true,
    preflight: async () => ({ route: 'unregistered' as const }),
    readConstants: async () => ({
      feeWei: 6_000_000_000_000_000_000n, paused: false, proofValidityBlocks: 450,
      blockNumber: 13_780_000,
    }),
    readBlockNumber: async () => 13_780_000,
    prove: async () => ({
      call: { contractAddress: '0x1', entrypoint: 'apply_actions', calldata: [] },
      proofFacts: ['0x1'], provingBlockId: 13_779_990,
    }),
    submit: async () => ({ status: 200, body: { transactionHash: '0xdeadbeef' } }),
    confirm,
  }
}

async function register(confirm: (hash: string) => Promise<number | null | void>) {
  return registerSponsored(
    { accountKey: generateIdentity().privateKey, account: { address: ADDRESS, signer: {} as never } },
    harness(confirm),
  )
}

describe('readReceiptBlockNumber', () => {
  it('reads an integer block number off a loose receipt shape', () => {
    expect(readReceiptBlockNumber({ block_number: 13_780_499 })).toBe(13_780_499)
    expect(readReceiptBlockNumber({ block_number: 0 })).toBe(0)
  })

  it('accepts the camelCase spelling too', () => {
    // The RPC wire format is snake_case and that is what a raw receipt carries, but a caller
    // injecting `confirm` may hand back an object built from its own SDK's shape. Reading only
    // one spelling turns that into a silent null: registration succeeds, the re-issue never
    // gets its block, and nothing reports a problem.
    expect(readReceiptBlockNumber({ blockNumber: 13_780_499 })).toBe(13_780_499)
    expect(readReceiptBlockNumber({ blockNumber: 0 })).toBe(0)
    // snake_case wins when both are present and disagree — it is the wire format.
    expect(readReceiptBlockNumber({ block_number: 1, blockNumber: 2 })).toBe(1)
    // ...and the camelCase value is still used when the snake_case one is unusable.
    expect(readReceiptBlockNumber({ block_number: 'nope', blockNumber: 2 })).toBe(2)
  })

  it('answers null rather than guessing, for anything that is not one', () => {
    // The one thing this feeds is a header field that must be true or absent.
    for (const receipt of [
      undefined, null, {}, { block_number: '13780499' }, { block_number: 1.5 },
      { block_number: -1 }, { block_number: NaN }, { blockNumber: -1 },
      { blockNumber: 'seven' }, { block: 7 }, 'a string', 42,
    ]) {
      expect(readReceiptBlockNumber(receipt), JSON.stringify(receipt) ?? 'undefined').toBeNull()
    }
  })
})

describe('confirmFromReceipt — the production block-propagation path', () => {
  // Extracted from `defaultConfirm` so it can be tested at all: it was the ONLY production
  // source of `registrationBlock` and the only one no test ran, because the fetch and the
  // decision were fused into one function that needs a chain.
  it('returns the block of a receipt that did not revert', () => {
    expect(confirmFromReceipt({ execution_status: 'SUCCEEDED', block_number: 13_780_499 }))
      .toBe(13_780_499)
    // starknet's ReceiptTx Object.assigns the raw receipt onto itself, so a synthetic shape
    // is faithful to what `waitForTransaction` hands back.
    expect(confirmFromReceipt({ block_number: 13_780_499, transaction_hash: '0xabc' }))
      .toBe(13_780_499)
  })

  it('THROWS on a revert before it ever looks at the block', () => {
    // The ordering is the substance: a reverted transaction lands in a block like any other,
    // and reporting it would hand the re-issue a registration block for a registration that
    // did not happen.
    expect(() => confirmFromReceipt({ execution_status: 'REVERTED', revert_reason: 'NON_ZERO_VALUE', block_number: 5 }))
      .toThrow(RegistrationReverted)
    try {
      confirmFromReceipt({ execution_status: 'REVERTED', revert_reason: 'NON_ZERO_VALUE', block_number: 5 })
    } catch (e) {
      expect((e as RegistrationReverted).revertReason).toBe('NON_ZERO_VALUE')
    }
  })

  it('returns null for a successful receipt carrying no usable block', () => {
    expect(confirmFromReceipt({ execution_status: 'SUCCEEDED' })).toBeNull()
    expect(confirmFromReceipt({})).toBeNull()
    expect(confirmFromReceipt(null)).toBeNull()
  })
})

describe('RegisterResult.registrationBlock (additive)', () => {
  it('surfaces the block the confirm receipt reported', async () => {
    const result = await register(async () => 13_780_499)
    expect(result.ok).toBe(true)
    expect(result.ok && result.registrationBlock).toBe(13_780_499)
  })

  it('is null when the confirm reports no block — never a guess', async () => {
    for (const confirm of [
      async () => {},                       // the pre-existing void contract, still valid
      async () => null,
      async () => undefined,
    ]) {
      const result = await register(confirm)
      expect(result.ok).toBe(true)
      expect(result.ok && result.registrationBlock).toBeNull()
    }
  })

  it('SANITIZES what an injected confirm returns — garbage never reaches a header', async () => {
    // `confirm` is an injection point, so the number arriving here is whatever a caller's
    // implementation produced. The one thing it feeds is a header field that must be true or
    // absent, so anything that is not a block becomes null rather than being passed along.
    for (const bad of [NaN, -1, 1.5, Infinity, '13780499', {}, [], true]) {
      const result = await register(async () => bad as never)
      expect(result.ok, String(bad)).toBe(true)
      expect(result.ok && result.registrationBlock, String(bad)).toBeNull()
    }
    // Zero is a legal block and must survive, rather than being lost to a falsy check.
    const zero = await register(async () => 0)
    expect(zero.ok && zero.registrationBlock).toBe(0)
  })

  it('a reverted registration never reports a block, though the receipt has one', async () => {
    // A reverted transaction lands in a block like any other. Reporting it would give the
    // re-issue a registration block for a registration that did not happen.
    const result = await register(async () => { throw new RegistrationReverted('NON_ZERO_VALUE') })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('reverted')
    expect('registrationBlock' in result).toBe(false)
  })
})

describe('the re-issue round trip (AC4)', () => {
  it('goes ceremony → registration → re-issued header, and the old file still opens', async () => {
    const { privateKey } = generateIdentity()

    // 1. The ceremony, which must finish before registration is even attempted.
    let state = await issueBackup(privateKey, CONTEXT, ADDRESS)
    const original = state.backup
    expect(readBackupHeader(original.file)!.registrationBlock).toBeNull()

    const confirmed = confirmPastedCode(state, original.recoveryCode)
    const ready = markFileSaved(confirmed)
    expect(makeCanRegister(ready)()).toBe(true)

    // 2. Registration, gated on that ceremony, reporting the block it landed in.
    const result = await registerSponsored(
      { accountKey: privateKey, account: { address: ADDRESS, signer: {} as never } },
      { ...harness(async () => 13_780_499), canRegister: makeCanRegister(ready) },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.registrationBlock).toBe(13_780_499)

    // 3. The re-issue: both live values move forward together, the registration block is real.
    const reissuedHeader = reissueBackupHeader(state.header, {
      backupBlock: 13_780_500,
      auditorKeyAtBackupBlock: '0xa0d17012',
      registrationBlock: result.registrationBlock!,
    })
    const reissued = await createBackup(privateKey, reissuedHeader)

    expect(readBackupHeader(reissued.file)).toEqual({
      receiveAddress: ADDRESS,
      backupBlock: 13_780_500,
      auditorKeyAtBackupBlock: '0xa0d17012',
      registrationBlock: 13_780_499,
    })
    expect(reissued.filename).toBe('passbook-recovery-block-13780500-reissued.json')
    expect(reissued.filename).not.toBe(original.filename)

    // 4. NO REVOCATION, as an executable fact. The original file opens the same key with the
    //    same original code, and nothing about the re-issue changed that — which is precisely
    //    what BACKUP_REWRAP_NO_REVOCATION tells the user, and why it may not say otherwise.
    expect(await restoreBackup(original.file, original.recoveryCode)).toBe(privateKey)
    expect(await restoreBackup(reissued.file, reissued.recoveryCode)).toBe(privateKey)
  })

  it('keeps the receive address across a re-issue, and does not invent one', () => {
    const withAddress = reissueBackupHeader(
      { receiveAddress: ADDRESS, backupBlock: 1, auditorKeyAtBackupBlock: '0x1', registrationBlock: null },
      { backupBlock: 2, auditorKeyAtBackupBlock: '0x2', registrationBlock: 3 },
    )
    expect(withAddress.receiveAddress).toBe(ADDRESS)

    const without = reissueBackupHeader(
      { backupBlock: 1, auditorKeyAtBackupBlock: '0x1', registrationBlock: null },
      { backupBlock: 2, auditorKeyAtBackupBlock: '0x2', registrationBlock: 3 },
    )
    expect('receiveAddress' in without).toBe(false)
  })
})
