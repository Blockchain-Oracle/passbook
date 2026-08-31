//
// The shielded starter, sent BY the relayer.
//
// The recipient signs nothing and proves nothing. This process is the depositor — its own STRK
// balance is what the pool checks — and the note is created in the recipient's name. See
// `protocol/starter-drip.ts` for the two mainnet receipts that made this the only shape that works.
//
// ── IT IS NOT A SPONSORED TRANSACTION, AND IT NEVER TOUCHES THAT BUDGET ───────────────────
//
// A sponsored transaction is us paying so someone can do something THEY wanted. This is a gift of
// principal, so it goes nowhere near `/submit`, spends no sponsorship unit, and moves no counter a
// user is watching. What bounds it is the once-per-account claim, the requirement that the
// recipient already be registered (which is itself metered), and the wallet's own funding floor.
//
import type { PrivateTransfersUser } from '@starkware-libs/starknet-privacy-sdk'
import type { Call } from 'starknet'

import { PROVING_BLOCK_LAG } from '../../protocol/src/constants.js'
import { getPublicKey, readPoolConstants } from '../../protocol/src/pool.js'
import { assembleRegistrationCalls } from '../../protocol/src/register-prove.js'
import { proveStarterDrip } from '../../protocol/src/starter-drip.js'
import type { ResourceBounds } from './allowlist.js'

export interface StarterDeps {
  /** The DEPOSITOR: this relayer's own key and account. */
  accountKey: string
  account: PrivateTransfersUser
  amountWei: bigint
  submit: (calls: Call[], details?: { proofFacts: string[]; proof: string; resourceBounds?: ResourceBounds }) => Promise<string>
  resolveResourceBounds: () => Promise<ResourceBounds>
}

export type StarterOutcome =
  | { ok: true; transactionHash: string }
  /** `keepClaim` says whether the account's one chance was really used. False gives it back. */
  | { ok: false; because: string; keepClaim: boolean }

/**
 * Every refusal is a SENTENCE. Nothing from a node, a prover or the pool reaches a screen
 * unedited — a caller gets what happened, and the detail goes to our own logs.
 */
function refuse(because: string, keepClaim = false): StarterOutcome {
  return { ok: false, because, keepClaim }
}

/** Mints one shielded note for `recipient`, funded by this relayer's public STRK. */
export async function sendShieldedStarter(recipient: string, deps: StarterDeps): Promise<StarterOutcome> {
  // Registered FIRST. A note needs an owner the pool knows, and a channel can only be opened to a
  // key that exists — this is the check whose absence cost two reverts.
  let key: bigint
  try {
    key = await getPublicKey(recipient)
  } catch (e) {
    console.warn(`starter: could not read the recipient's key: ${String(e)}`)
    return refuse('The pool could not be read just now. Try again in a moment.')
  }
  if (key === 0n) return refuse('This account is not registered with the pool yet.')

  let live: Awaited<ReturnType<typeof readPoolConstants>>
  try {
    live = await readPoolConstants()
  } catch (e) {
    console.warn(`starter: could not read pool constants: ${String(e)}`)
    return refuse('The pool could not be read just now. Try again in a moment.')
  }
  if (live.paused) return refuse('The pool is paused by its operator. This can be claimed once it resumes.')
  if (live.feeWei <= 0n) return refuse('The pool fee could not be read. Try again in a moment.')

  const provingBlockId = Math.max(0, live.blockNumber - PROVING_BLOCK_LAG)
  let proved: Awaited<ReturnType<typeof proveStarterDrip>>
  try {
    proved = await proveStarterDrip({
      accountKey: deps.accountKey,
      account: deps.account,
      recipient,
      amountWei: deps.amountWei,
      provingBlockId,
    })
  } catch (e) {
    console.warn(`starter: the proof could not be built: ${String(e)}`)
    return refuse('The proof for this starting balance could not be built. Nothing was spent — try again.')
  }

  let calls: Call[]
  try {
    // The approve must cover the fee AND the deposit: both are pulled from this wallet, and
    // `assembleRegistrationCalls` refuses a starter the ceiling cannot hold.
    calls = assembleRegistrationCalls(proved.call, live.feeWei, deps.amountWei)
  } catch (e) {
    console.warn(`starter: the calls could not be assembled: ${String(e)}`)
    return refuse('This starting balance could not be prepared. Nothing was spent.')
  }

  let resourceBounds: ResourceBounds
  try {
    resourceBounds = await deps.resolveResourceBounds()
  } catch (e) {
    console.warn(`starter: resource bounds could not be built: ${String(e)}`)
    return refuse('The network fee could not be read just now. Try again in a moment.')
  }

  try {
    const transactionHash = await deps.submit(calls, {
      proofFacts: proved.proofFacts,
      proof: proved.proof,
      resourceBounds,
    })
    return { ok: true, transactionHash }
  } catch (e) {
    // A throw here MAY still have broadcast. Keep the claim: the revert watch reads the receipt
    // and releases it if the transaction actually failed, which is the only evidence worth acting
    // on. Releasing it now on a maybe is how one account mints two notes.
    console.warn(`starter: the submission failed: ${String(e)}`)
    return refuse('This may have been sent. Check the balance in a minute rather than claiming again.', true)
  }
}
