//
// Proof expiry, as a leaf (story 6.5, DESIGN §7.7 / EXPERIENCE §5).
//
// A proof is only valid for a window of blocks, and the window is a CHAIN READ
// (`readPoolHealth().proofValidityBlocks`, from `get_proof_validity_blocks`). It is 450 on the
// deployed class today. It is not 450 here, or anywhere else in shipped code, because a constant
// baked in becomes a claim about a block it was never read at — the same runtime-truth rule that
// makes the pool fee unhardcodable.
//
// ── WHY EXPIRY IS THREE STATES AND NOT A BOOLEAN ──────────────────────────────────────────
//
// `expiring` exists so the user finds out while they can still act. A proof that flips straight
// from valid to expired hands them a dead end they had no warning of, and the fix — regenerate —
// was available for the whole last stretch.
//

/** Valid, in its final stretch, or lapsed. */
export type ExpiryState = 'valid' | 'expiring' | 'expired'

/**
 * How much of the window is the warning stretch.
 *
 * DERIVED, NOT AUTHORED. EXPERIENCE §5 gives the pair "Block 400 of 450" for the expiring row, so
 * the warning stretch is the last 50 blocks. It is written as the difference rather than as "400"
 * because the total is a chain read: if the pool ever returns 300, a hardcoded 400 would mean the
 * warning fires after the proof already died.
 */
export const EXPIRING_WINDOW_BLOCKS = 50

export interface ExpiryInput {
  /** The block the proof was generated against. */
  provedAtBlock: number
  /** Head, as last read. */
  currentBlock: number
  /** `readPoolHealth().proofValidityBlocks` — never a literal. */
  validityBlocks: number
}

export interface ExpiryVerdict {
  state: ExpiryState
  /** Blocks left before expiry. Clamped at zero — a countdown never goes negative (§3 rule 7). */
  blocksRemaining: number
  /**
   * The head is BEHIND the proof's own block, which cannot happen on a chain that only moves
   * forward. It means the device's view of "now" is wrong, and §5 gives that its own sentence
   * rather than letting it render as an ordinary expiry the user would blame themselves for.
   */
  clockSkew: boolean
}

export function expiryState({
  provedAtBlock,
  currentBlock,
  validityBlocks,
}: ExpiryInput): ExpiryVerdict {
  //
  // A NUMBER WE CANNOT READ IS NOT A PROOF WE CAN VOUCH FOR. An unread chain value arriving as NaN
  // used to sail through every comparison below — all of them are false against NaN — and return
  // `valid` with `blocksRemaining: NaN`, which tells the user a proof is good on the strength of a
  // reading that never happened. Expired is the only safe direction to fail in: the cost is one
  // unnecessary regeneration, and the cost of the other answer is a submission that reverts.
  //
  if (![provedAtBlock, currentBlock, validityBlocks].every(Number.isFinite)) {
    return { state: 'expired', blocksRemaining: 0, clockSkew: false }
  }

  if (currentBlock < provedAtBlock) {
    return { state: 'expired', blocksRemaining: 0, clockSkew: true }
  }

  const remaining = validityBlocks - (currentBlock - provedAtBlock)

  if (remaining <= 0) return { state: 'expired', blocksRemaining: 0, clockSkew: false }

  //
  // THE WARNING STRETCH CANNOT SWALLOW THE WHOLE WINDOW. If the pool ever returns a validity of 50
  // or less, a fixed 50-block stretch would make every proof `expiring` from the block it was
  // built — a countdown that is always on, which is a countdown nobody reads. Half the window is
  // the floor: still a real warning, never the entire life of the proof.
  //
  const warningStretch = Math.min(EXPIRING_WINDOW_BLOCKS, Math.floor(validityBlocks / 2))
  if (remaining <= warningStretch) {
    return { state: 'expiring', blocksRemaining: remaining, clockSkew: false }
  }
  return { state: 'valid', blocksRemaining: remaining, clockSkew: false }
}

/**
 * The quiet countdown on an expiring proof, byte-exact from §5 minus its estimate.
 *
 * §5's full string is `Proof valid for 50 more blocks (~1 min 30s).` The parenthetical is duration
 * copy, banned until the proof-timing probe lands. The block count is a measurement and stays.
 */
export function expiringLabel(blocksRemaining: number): string {
  return blocksRemaining === 1
    ? 'Proof valid for 1 more block.'
    : `Proof valid for ${blocksRemaining} more blocks.`
}

/**
 * The re-consent row's sentence. Names the BLOCK it died at, because that is checkable — a user
 * can put that number into an explorer and see for themselves, which "your proof expired" does not
 * allow.
 */
export function expiredLabel(verdict: ExpiryVerdict, expiredAtBlock: number): string {
  if (verdict.clockSkew) return 'Proof expired immediately. Your device clock may be wrong.'
  return `Proof expired at block ${expiredAtBlock.toLocaleString('en-US')}`
}

/** The action beside it. A small secondary — regenerating is routine, not an alarm. */
export const REGENERATE_ACTION = 'Regenerate'
