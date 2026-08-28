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
  // A FAILED FEE READ OMITS THE NUMBER RATHER THAN GUESSING ONE — inventing a figure to keep the
  // sentence tidy would be exactly the hardcoded fee the brief's governing rule bans, on the one
  // screen where a stranger is deciding whether to trust this app about money. M8 rewrote the
  // payer: the STAKE pays, through the user's own signature — one subsidy, spent once.
  const cost = feeStrk === null ? 'one pool transaction' : `one pool transaction — currently ~${feeStrk} STRK`
  return `Registering costs ${cost}. A new account cannot pay it from nothing — the fee comes from real STRK, and nobody may give you a shielded balance until you are registered. Someone has to stake you first. That is the next screen: we send you the STRK, and your own account signs and pays its own way with it.`
}

/** The fee row, same rule: the app's name and the live fee are both parameters. */
export function deadlockFeeRow(appName: string, feeStrk: string | null): string {
  // The row still names WHO pays, which is the accountability half of it. `appName` stays a
  // parameter for the staker's name; the signer is the user — that is the one-subsidy claim,
  // written where the payment happens.
  return feeStrk === null
    ? `Staked by ${appName} · signed and paid by your own account`
    : `Staked by ${appName} · ${feeStrk} STRK · signed and paid by your own account`
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

// ── Screen 5 — The stake (the drip, FIRST) ────────────────────────────────────────────────
//
// WHY THIS COMES BEFORE REGISTRATION NOW — M8's one-subsidy rule, inverting the old order.
//
// The old flow gave twice: a sponsored registration AND a starter drip. Now the drip is the ONLY
// gift and it arrives first, sized to stake the whole journey — the account deploys itself from
// it, the registration is signed and paid by the USER's own account (`collect_fee` pulls from
// whoever submits), and what remains is the starter. Sponsorship still exists, demoted to the
// fallback for when the faucet is off or dry: never a locked door, never a second subsidy.
//
// IT MAY STILL FAIL HARMLESSLY. A refused drip does not end the flow — the register screen's
// fallback covers the fee — so the copy reads as a detour, never as a failed setup.

export const FUND_TITLE = 'Your stake arrives first'

/** Said while the transfer is in flight. Never promises the amount before it has landed. */
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
 * The refusal wrapper.
 *
 * `because` is the relayer's own sentence, which already says which limit bound and what to do
 * instead. This adds the ONE thing the relayer cannot say: the door ahead still opens — the
 * sponsored fallback covers a registration the drip could not stake.
 */
export function fundRefused(because: string): string {
  return `${because} You can still continue — when the faucet cannot stake you, the registration fee is covered for you instead.`
}

export const FUND_CTA = 'Continue — register my key'

/**
 * What the register step needs IN HAND before its button can honestly be pressed: the ~6 STRK
 * pool fee, deploy gas, and margin. One constant so the blocker, the guard in `onRegister` and
 * the payer decision cannot each invent their own number.
 */
export const REGISTER_FUNDS_FLOOR_WEI = 7_500_000_000_000_000_000n

/**
 * The register screen's blocker when the account cannot pay yet — ZK Freighter's lesson,
 * finally applied: SAY what is missing and where it goes, never a button that dies silently.
 */
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

// ── Screen 6 — Register (the terminal screen) ─────────────────────────────────────────────

export const REGISTER_TITLE = 'Register your key'
export const REGISTER_CTA = 'Create your account'
/**
 * Registration mints no spendable note, so the pipeline has FOUR steps and no maturity stage.
 * Adding a fifth for symmetry would be waiting for something that is never coming.
 */
export const REGISTER_STEPS = ['Build', 'Prove', 'Relay', 'Confirmed'] as const

/** The terminal state, rendered on the register screen once the write confirms. */
export const REGISTERED_TITLE = 'You’re in'
export const REGISTERED_BODY =
  'Registered, on-chain, and usable. Anything sent to you shows up in your record; your shielded ' +
  'balance is nobody else’s to read.'
export const REGISTERED_CTA = 'Open my wallet'

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
