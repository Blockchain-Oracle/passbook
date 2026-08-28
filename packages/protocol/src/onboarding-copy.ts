//
// Every sentence the first-run conversion panel says.
//
// ── A LEAF THAT IMPORTS NOTHING, for the reason its siblings record ───────────────────────
//
// Sentences live apart from the components so a surface cannot quietly paraphrase one. This file
// imports nothing, so it stays loadable under plain Node type stripping the way `disclosure-copy.ts`
// and `linkability-copy.ts` do.
//
// ── MOST OF THIS IS SOURCED, NOT WRITTEN ──────────────────────────────────────────────────
//
// `context/11-product-experience.md` §1 is the ratified design and its five screens are quoted
// byte-exact below, because their claims are verified protocol facts rather than marketing:
//
//   · the key is generated locally and NEVER derived from a wallet signature — 46 of 51 measured
//     registrants are Ready smart accounts across two class versions, and a signature-derived key
//     would be orphaned by an account upgrade, permanently
//   · the key is written ONCE — all 45 deployed pool functions were enumerated and no rotate,
//     replace, revoke or delete exists
//   · the auditor escrow is not optional — every registration writes an encrypted copy on-chain
//   · the bootstrap deadlock is real — the fee is taken from a shielded balance, and nobody may
//     give a new account a shielded balance until it is registered
//
// Editing any of those to taste is how a claim drifts. `onboarding-copy.test.ts` pins them.
//
// ── AND TWO THINGS ARE BANNED UNTIL THEY ARE EARNED ───────────────────────────────────────
//
// NO DURATION, anywhere. §1 is explicit: durations do not render until one real proof has been
// timed against the hosted prover. So the trigger chip says `one transaction` and not "about 20
// seconds", and nothing below names a number of seconds.
//
// NO `your address never appears`. It is one of eight strings under a standing prohibition until
// the relayer's claim is proven on mainnet. The sanctioned sentence in its place is `POOL_SEES`
// from `disclosure-copy.ts`, which is reproduced rather than re-authored here.
//

/** The inline row that opens conversion. NOT a modal — see `useFirstRun`. */
export const TRIGGER_HEADLINE = 'You are reading a public account. Sending needs one of your own.'
export const TRIGGER_CTA = 'Create an account'
/**
 * The cost chip.
 *
 * `one transaction` rather than a duration, deliberately and per §1: no duration ships until
 * proving has been timed against StarkWare's hosted service, which is not ours to measure yet.
 */
export const TRIGGER_COST_CHIP = 'one transaction'

// ── Screen 1 — Name ───────────────────────────────────────────────────────────────────────

export const NAME_TITLE = 'Pick a name'
/** Sourced, §1 screen 1. */
export const NAME_CAPTION =
  'This is the address people send to. It is the only address this app will ever show you. The name resolves only inside this app.'
export const NAME_PLACEHOLDER = 'yourname'
export const NAME_CTA = 'Continue'
/**
 * Claiming the name in the directory is OPTIONAL and happens after registration.
 *
 * Separated from the local label because they are different acts with different exposure: a label
 * is private to this browser, and a claim is a public record somebody else can look up.
 */
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
/**
 * Why this screen cannot be skipped, said plainly.
 *
 * It gates REGISTRATION, not spending. A skipped backup here would create an unrecoverable account
 * with a sponsored transaction — somebody else's money spent on an account nobody can ever open.
 */
export const BACKUP_GATE_NOTE =
  'This is the one step you cannot skip. Everything after it is written on-chain and cannot be undone.'

// ── Screen 4 — The deadlock, named ────────────────────────────────────────────────────────

export const DEADLOCK_TITLE = 'Someone has to go first'

/**
 * Sourced, §1 screen 4 — with the fee as a PARAMETER.
 *
 * The brief's own governing rule: no STRK amount ever appears as a hardcoded string. The fee is
 * read from `get_fee_amount()` at render and passed in here, which is why this is a function and
 * its siblings are constants.
 */
export function deadlockBody(feeStrk: string | null): string {
  // A FAILED FEE READ OMITS THE NUMBER RATHER THAN GUESSING ONE. "We are paying it" is true
  // whether or not the RPC answered, and the rest of the paragraph — the deadlock itself — does not
  // depend on the amount. Inventing a figure to keep the sentence tidy would be exactly the
  // hardcoded fee the brief's governing rule bans, on the one screen where a stranger is deciding
  // whether to trust this app about money.
  const cost = feeStrk === null ? 'one pool transaction' : `one pool transaction — currently ~${feeStrk} STRK`
  return `Registering costs ${cost}. We are paying it. A new account cannot pay this fee itself: the fee is taken from a shielded balance, and nobody may give you a shielded balance until you are registered. Someone has to go first.`
}

/** The fee row, same rule: the app's name and the live fee are both parameters. */
export function deadlockFeeRow(appName: string, feeStrk: string | null): string {
  // Same rule. The row still names WHO is paying, which is the accountability half of it, and drops
  // only the half the chain would not tell us.
  return feeStrk === null
    ? `Submitted by ${appName} relayer · paid by us`
    : `Submitted by ${appName} relayer · ${feeStrk} STRK · paid by us`
}

/**
 * When an invite is covering it, the title becomes attribution.
 *
 * §2: "attribution is the accountability mechanism" — a named inviter is one of the five abuse
 * layers, so the person paying is named on the screen where the payment happens.
 */
export function deadlockInvitedTitle(inviter: string): string {
  return `${inviter} is covering your registration.`
}

// ── Screen 5 — Register ───────────────────────────────────────────────────────────────────

export const REGISTER_TITLE = 'Register your key'
export const REGISTER_CTA = 'Create your account'
/**
 * Registration mints no spendable note, so the pipeline has FOUR steps and no maturity stage.
 * Adding a fifth for symmetry would be waiting for something that is never coming.
 */
export const REGISTER_STEPS = ['Build', 'Prove', 'Relay', 'Confirmed'] as const

// ── Screen 6 — The starter STRK ───────────────────────────────────────────────────────────
//
// WHY THIS COMES AFTER REGISTRATION AND NOT BEFORE, which is the opposite of most wallets.
//
// Registration is sponsored — the relayer pays that fee — so an account reaches the pool needing
// nothing. What it cannot do is the NEXT thing: a swap, a bet, a send, all of which need gas the
// account does not have. So the drip is not a precondition for the flow, it is the removal of the
// wall the flow ends at. Running it earlier would spend real mainnet STRK on visitors who never
// reach screen five.
//
// AND IT IS THE LAST SCREEN BECAUSE IT IS THE ONLY ONE THAT MAY FAIL HARMLESSLY. Every other step
// gates the one after it; this one can be refused — a spent daily budget, a deployment with no
// faucet configured — and the account is still complete. The copy is written so that outcome
// reads as a detour rather than a failed setup.

export const FUND_TITLE = 'You’re in'

/** Said while the transfer is in flight. Never promises the amount before it has landed. */
export const FUND_PENDING = 'Sending you some STRK to get started…'

/** The success line. `amount` is rendered by the caller so the number is never hardcoded here. */
export function fundArrived(amount: string): string {
  return `${amount} STRK is on its way. It covers the gas for your first swaps, bets and sends.`
}

/**
 * The refusal wrapper.
 *
 * `because` is the relayer's own sentence, which already says which limit bound and what to do
 * instead. This adds the ONE thing the relayer cannot say: that the account is finished and works.
 * Without it a refused drip reads as a failed sign-up.
 */
export function fundRefused(because: string): string {
  return `Your account is ready and registered. ${because}`
}

export const FUND_CTA = 'Open my wallet'

// ── After ─────────────────────────────────────────────────────────────────────────────────

/** Sourced, §1 return. An empty wallet stated as two facts rather than as a failure. */
export const EMPTY_WALLET = 'You can receive now. You cannot send yet.'

/**
 * The eight strings under a standing build-time prohibition (§3).
 *
 * Exported so the test can assert none of the copy above trips one — the lint is a real gate and
 * this module is the highest-risk place for a slip, because onboarding copy is where the
 * temptation to oversell is strongest.
 */
export const BANNED_CLAIMS = [
  'end-to-end',
  'e2ee',
  'only you can',
  'zero-knowledge',
  'watch-only',
  'view-only',
  'read-only',
  'your address never appears',
  'amounts are private',
  'unlinkable across surfaces',
] as const
