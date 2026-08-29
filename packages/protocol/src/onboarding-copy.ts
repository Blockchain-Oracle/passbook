//
// Every sentence the first-run conversion panel says. A leaf that imports nothing.
//
// Most of it is sourced from `context/11-product-experience.md` §1 and quoted byte-exact, because
// each claim is a verified protocol fact: the key is generated locally and never derived from a
// wallet signature; it is written once and cannot be rotated; the auditor escrow is not optional;
// the bootstrap deadlock is real. No duration renders anywhere, and no STRK figure is ever a literal
// — the fee is read from `get_fee_amount()` at render and passed in.
//

// ── Screen 1 — Name ───────────────────────────────────────────────────────────────────────

export const NAME_TITLE = 'Pick a name'
/** Sourced, §1 screen 1. */
export const NAME_CAPTION =
  'This is the address people send to. It is the only address this app will ever show you. The name resolves only inside this app.'
export const NAME_PLACEHOLDER = 'yourname'
export const NAME_CTA = 'Continue'
/** Claiming the name publicly is optional and a different act: a label is private, a claim is a public record. */
export const NAME_CLAIM_OPT_IN = 'Also claim this name publicly, so people can find me by it'
export const NAME_CLAIM_NOTE =
  'A claimed name is public. Anyone can look it up and see the address it points at.'

// ── Screen 2 — Custody ────────────────────────────────────────────────────────────────────

export const CUSTODY_TITLE = 'Where your key comes from'
/** Sourced, §1 screen 2, byte-exact. Every clause is a verified protocol fact. */
export const CUSTODY_BODY =
  'Your key is made here, in this browser. It is not derived from a wallet signature — this protocol records your key once and never lets you change it, and a wallet upgrade would change the signature and orphan your funds permanently. The same key reads your history and signs your spending; there is no watch-only version. When you register, an encrypted copy is escrowed on-chain to StarkWare’s auditor. That is not optional.'
export const CUSTODY_CTA = 'Generate my key'

// ── Screen 3 — Backup ─────────────────────────────────────────────────────────────────────

export const BACKUP_TITLE = 'Save your key'
/** Sourced, §1 screen 3. The gate is the point; this sentence is its justification. */
export const BACKUP_BODY =
  'Save your key before we write anything on-chain. The key we register can never be replaced — the protocol writes it once.'
/** It gates registration, not spending: a skipped backup would create an unrecoverable account. */
export const BACKUP_GATE_NOTE =
  'This is the one step you cannot skip. Everything after it is written on-chain and cannot be undone.'

// ── Screen 4 — The deadlock, named ────────────────────────────────────────────────────────

export const DEADLOCK_TITLE = 'Someone has to go first'

/** Sourced, §1 screen 4, with the fee as a parameter. A failed fee read omits the number. */
export function deadlockBody(feeStrk: string | null): string {
  const cost = feeStrk === null ? 'one pool transaction' : `one pool transaction — currently ~${feeStrk} STRK`
  return `Registering costs ${cost}. A new account cannot pay it from nothing — the fee comes from real STRK, and nobody may give you a shielded balance until you are registered. Someone has to stake you first. That is the next screen: we send you the STRK, and your own account signs and pays its own way with it.`
}

/** The fee row names who stakes and who signs — the one-subsidy claim, written where payment happens. */
export function deadlockFeeRow(appName: string, feeStrk: string | null): string {
  return feeStrk === null
    ? `Staked by ${appName} · signed and paid by your own account`
    : `Staked by ${appName} · ${feeStrk} STRK · signed and paid by your own account`
}

// ── The ladder — creating the account ─────────────────────────────────────────────────────
//
// The drip is the ONLY gift and it arrives first, sized to stake the whole journey: the account
// deploys itself from it, registration is signed and paid by the user's own account, and what
// remains is the starter. Row titles live in `pipeline-stage.ts`; only the notes are here.

/** The per-stage note, shown only for the rung that is currently running. No amount is baked in. */
export const ONBOARDING_STAGE_NOTES = {
  drip: 'the faucet stakes this account — the receipt below is its record',
  deploy: 'your address goes live on Starknet',
  settle: 'the proof is checked a few blocks behind the head, so a fresh deploy waits for the chain to pass it',
  register: 'the account pays its own fee — nobody sponsors this',
  confirm: 'the pool accepts your viewing key',
} as const

/** The live settle note. Blocks are counted, never turned into seconds; `null` when the deploy block is unknown. */
export function settleNote(lag: number, blocksToGo: number | null): string {
  const why = `the proof is checked ${lag} blocks behind the head, so a fresh deploy waits for the chain to pass it`
  if (blocksToGo === null) return why
  if (blocksToGo <= 0) return 'the chain has passed your deploy — registering now'
  return `${why} — ${blocksToGo} more block${blocksToGo === 1 ? '' : 's'}`
}

/** Under the drip's receipt chip. Says whose money it was and that the record is keepable. */
export const DRIP_RECEIPT_SUB = 'faucet drip · the receipt is yours to keep'

/** Said while the drip is in flight. Never promises the amount before it has landed. */
export const FUND_PENDING = 'Sending the STRK that pays your way…'

/** The success line. `amount` is rendered by the caller so the number is never hardcoded here. */
export function fundArrived(amount: string): string {
  return (
    `${amount} STRK is on its way — give it a few seconds to land. It pays for your ` +
    'registration, signed by your own account, and what remains covers your first swaps, bets ' +
    'and sends.'
  )
}

/**
 * The refusal wrapper. `because` is the relayer's own sentence; this adds where the door is. It
 * does not promise a sponsor — the faucet gives once, and there is no second subsidy behind it.
 */
export function fundRefused(because: string): string {
  return `${because} Fund the account yourself from any wallet or exchange — the address is below, and this screen notices when it lands.`
}

export const FUND_CTA = 'Continue — register my key'

/** The register screen's blocker when the account cannot pay yet: say what is missing and where it goes. */
export const REGISTER_NEEDS_FUNDS =
  'This account holds no STRK yet, and registration is signed and paid from it — about 8 STRK ' +
  'covers the fee, the deploy and gas. Send it to your address below from any wallet or ' +
  'exchange; this screen notices when it lands.'

/** Above the copyable address, wherever the flow asks the user to fund it themselves. */
export const FUND_ADDRESS_HINT = 'Your address — send STRK here:'

/** The live line once outside funding lands. `amount` rendered by the caller, never baked. */
export function fundsArrived(amount: string): string {
  return `${amount} STRK is here — that covers it.`
}

// ── Create the account ────────────────────────────────────────────────────────────────────

/** The gate's own sentence, under a Create button that cannot yet be pressed. */
export const CREATE_BLOCKED = 'Save your key and confirm it, and Create unlocks.'

/** Two sentences because they are two facts: a claimed name is public, an unclaimed one never leaves this browser. */
export function namePreview(name: string, claimPublicly: boolean): string {
  return claimPublicly
    ? `You’ll be @${name} — anyone can pay you by typing it.`
    : `You’ll be @${name} — a private label, unless you claim it.`
}

/**
 * The fine print under Create. `feeStrk` is interpolated, never baked, and the last clause is the
 * honest door: the faucet drips once, and nothing quietly pays on the user's behalf after that.
 */
export function createFeeNote(feeStrk: string | null): string {
  const fee =
    feeStrk === null
      ? 'the pool’s registration fee'
      : `the pool’s ${feeStrk} STRK registration fee`
  return (
    `Account setup runs as an automatic ladder: one faucet drip, account deployment, ${fee}, and ` +
    'confirmation. Each submitted transaction keeps its own receipt and hash in Activity. The faucet ' +
    'gives once, enough for your first few transactions; after that the account pays its own way. ' +
    'If the faucet is dry you can fund the account yourself from any wallet — the address is on ' +
    'this screen.'
  )
}

// ── The terminal screen ───────────────────────────────────────────────────────────────────

/** The arrival title. The NAME is the subject, because the name is what was just made real. */
export function doneTitle(name: string): string {
  return `@${name} is yours`
}

/** Switches on the claim: one of these accounts is findable by strangers and the other is not. */
export function doneSub(claimedPublicly: boolean): string {
  const history =
    'The stake and your registration are the first two rows of your history — each with its hash.'
  return claimedPublicly
    ? `Anyone can now find this address by that name. ${history}`
    : `The name stays local to this browser. ${history}`
}

export const ENTER_CTA = 'Enter Passbook'

export const REGISTER_TITLE = 'Register your key'
export const REGISTER_CTA = 'Create your account'

/** The terminal state, rendered on the register screen once the write confirms. */
export const REGISTERED_TITLE = 'You’re in'
export const REGISTERED_BODY =
  'Registered, on-chain, and usable. Anything sent to you shows up in your record; your shielded ' +
  'balance is nobody else’s to read.'
