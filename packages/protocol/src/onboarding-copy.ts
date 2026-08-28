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

// ── Step 2's ladder — creating the account ────────────────────────────────────────────────
//
// WHY THE DRIP COMES FIRST — M8's one-subsidy rule, inverting the old order.
//
// The old flow gave twice: a sponsored registration AND a starter drip. Now the drip is the ONLY
// gift and it arrives first, sized to stake the whole journey — the account deploys itself from
// it, the registration is signed and paid by the USER's own account (`collect_fee` pulls from
// whoever submits), and what remains is the starter. Sponsorship still exists, demoted to the
// fallback for when the faucet is off or dry: never a locked door, never a second subsidy.
//
// ── AND IT IS NOT A BUTTON, WHICH IS A REVERSAL WORTH RECORDING ──────────────────────────
//
// A `Claim faucet` button briefly lived here, on the reading that a faucet nobody can see is a
// faucet nobody believes in. The observation was right and the remedy was wrong. The prototype's
// answer — Abu's ruling, 2026-08-28 — is that the drip is the FIRST RUNG OF THE LADDER, announced
// by name and leaving a receipt with a transaction hash:
//
//     {label:'Drip lands', note:'9.6 STRK from the faucet — the receipt above is its record'}
//
// The faucet was never missing. It was silent. A named rung that reports its own hash is visible
// in the way that matters, and it does not ask somebody to press a button to be given something
// nobody would decline.

// The row TITLES are not here. They live in `pipeline-stage.ts`'s `STAGE_TITLES` beside every
// other stage title in the app, because that table exists precisely so one stage cannot be spelled
// two ways in two files. Only the notes below are copy.

/**
 * The per-stage note, shown ONLY for the rung that is currently running.
 *
 * That restraint is the prototype's (`noteOn: regOn && i===reg`) and it is what keeps the ladder a
 * ladder: four notes on screen at once is a paragraph with bullet points, and the eye has nowhere
 * to land. One note, on the live rung, reads as narration.
 *
 * NO AMOUNT IS BAKED INTO `drip`. The prototype writes "9.6 STRK from the faucet" because a mockup
 * knows what its faucet gives; this build does not until the relayer answers, and the file's
 * governing rule is that no STRK figure is ever a literal here. The amount arrives with the
 * receipt — see `dripReceipt`.
 */
export const ONBOARDING_STAGE_NOTES = {
  drip: 'the faucet stakes this account — the receipt below is its record',
  deploy: 'your address goes live on Starknet',
  register: 'the account pays its own fee — nobody sponsors this',
  confirm: 'the pool accepts your viewing key',
} as const

/** Under the drip's receipt chip. Says whose money it was and that the record is keepable. */
export const DRIP_RECEIPT_SUB = 'faucet drip · the receipt is yours to keep'

/** The same line when an invite staked it instead. `inviter` is named — attribution is §2's rule. */
export function dripReceiptSubInvited(inviter: string): string {
  return `staked by @${inviter} · the receipt is yours to keep`
}

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
 * The refusal wrapper.
 *
 * `because` is the relayer's own sentence, which already says which limit bound and what to do
 * instead. This adds the one thing the relayer cannot: where the door is.
 *
 * IT DOES NOT PROMISE A SPONSOR. It used to — "the registration fee is covered for you instead" —
 * and that was false in the same way `createFeeNote`'s old ending was: the faucet gives once, and
 * there is no second subsidy behind it. A refusal is a real refusal, and the honest next step is
 * the user's own wallet.
 */
export function fundRefused(because: string): string {
  return `${because} Fund the account yourself from any wallet or exchange — the address is below, and this screen notices when it lands.`
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

// ── Step 2 — Create the account ───────────────────────────────────────────────────────────
//
// THE FLOW IS TWO STEPS NOW, not six, and the deleted four were not deleted: `custody`, `deadlock`
// and `fund` were SCREENS carrying one paragraph each, and they are cards inside these two steps.
// Every sourced sentence — `CUSTODY_BODY`, `BACKUP_BODY`, `deadlockBody` — still renders, and
// `onboarding-copy.test.ts` still pins each of them byte-exact. What changed is how many times
// somebody has to press Continue to read them.

export const CREATE_TITLE = 'Create your account'
export const CREATE_CTA = 'Create my account'

/** Above the derived address. The prototype's line, and it is a claim about provenance. */
export const ADDRESS_NOTE = 'derived, not chosen'

/** The gate's own sentence, under a Create button that cannot yet be pressed. */
export const CREATE_BLOCKED = 'Save your key and confirm it, and Create unlocks.'

/**
 * The live preview under the name field.
 *
 * Two different sentences because they are two different facts: a claimed name is a public record
 * anyone can resolve, an unclaimed one is a label that never leaves this browser. The prototype
 * writes both and switches on the toggle, which is the honest shape — a single sentence would have
 * to be vague enough to cover both, and vagueness about what is public is the one thing this
 * product cannot afford.
 */
export function namePreview(name: string, claimPublicly: boolean): string {
  return claimPublicly
    ? `You’ll be @${name} — anyone can pay you by typing it.`
    : `You’ll be @${name} — a private label, unless you claim it.`
}

/**
 * The fine print under Create, naming what the one transaction covers and who staked it.
 *
 * `feeStrk` IS INTERPOLATED, NEVER BAKED. The prototype writes "the pool's 6 STRK registration fee
 * … ≈9.6 STRK in all" because a mockup may; this file's governing rule, enforced by its own test,
 * is that no STRK figure is ever a literal. So the placement and the framing are the prototype's
 * and the numbers are the chain's — and when the chain cannot be asked, the sentence loses the
 * figure rather than inventing one.
 *
 * ── THERE IS NO SPONSORSHIP FALLBACK, AND SAYING THERE WAS WAS A LIE ─────────────────────
 *
 * This sentence briefly ended "if the faucet is dry, the fee is covered for you instead — never a
 * locked door". That is not what this product does (Abu, 2026-08-28): **the faucet drips ONCE**,
 * sized to carry a new account through its first few transactions, and nothing quietly pays on the
 * user's behalf after that. A promise of open-ended sponsorship is the most expensive kind of copy
 * to get wrong — it is a commitment made to somebody who has not spent anything yet.
 *
 * So the last clause is the honest door instead: fund it yourself, and the address is right there.
 * `f339cbf`'s work — the funds floor, the copyable address, the live "it landed" line — is what
 * that clause is pointing at, and this is where the user is first told it exists.
 */
export function createFeeNote(feeStrk: string | null): string {
  const fee =
    feeStrk === null
      ? 'the pool’s registration fee'
      : `the pool’s ${feeStrk} STRK registration fee`
  return (
    `Creating the account is one transaction, staked by the faucet — deploy gas, ${fee}, and a ` +
    'starter balance. It lands in your history as an ordinary receipt, with its hash. The faucet ' +
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

/**
 * What just happened, told as two rows the user can go and look at.
 *
 * Switches on the claim for the same reason `namePreview` does — one of these accounts is
 * findable by strangers and the other is not, and that difference is not a detail.
 */
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
