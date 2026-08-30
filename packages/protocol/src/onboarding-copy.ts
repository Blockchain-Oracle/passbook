//
// Every sentence the first-run conversion panel says. A leaf that imports nothing.
//
// Most of it is sourced from `context/11-product-experience.md` §1 and quoted byte-exact, because
// each claim is a verified protocol fact: the key is generated locally and never derived from a
// wallet signature; it is written once and cannot be rotated; the auditor escrow is not optional;
// the bootstrap deadlock is real. No duration renders anywhere, and no STRK figure is ever a literal
// — the fee is read from `get_fee_amount()` at render and passed in.
//

// ── Screen 0 — The fork ───────────────────────────────────────────────────────────────────

/**
 * The very first screen, and it is NOT the pitch.
 *
 * It carried the motto and then a sentence explaining it, which was wrong twice over. The stage
 * beside this card already reads "Everything / on Starknet, / one account.", so the motto was on
 * screen twice; and anyone reading this has already pressed "open the app" — they are sold, and
 * selling them again is three seconds of reading between them and the thing they came for.
 *
 * So it answers the only question a first-timer actually has here: what do I need before I can
 * start? Three words, three answers, none of them a claim about privacy. It is the refusal
 * ticker's move — say what we do not need — at the one moment a reader is deciding whether this
 * will be a hassle.
 */
export const FORK_TITLE = ['No wallet.', 'No email.', 'No seed phrase.'] as const

/** Six words on what the button does. Anything longer is a page, and this is a door. */
export const FORK_BODY = 'One key, made in this browser.'

/** Three words, per the CTA rule. It creates an ACCOUNT; a wallet is the thing we do not need. */
export const FORK_CREATE_CTA = 'Create an account'

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

// ── Screen 4 — The deadlock, and who pays it ──────────────────────────────────────────────
//
// THE DEADLOCK IS REAL AND WE SOLVE IT; the copy has to say which of those is which. Registering
// costs one pool transaction, a new account cannot pay from nothing, and nobody may hold a shielded
// balance until they are registered. What changed is the answer: the relayer pays, out of a budget
// with a number on it, rather than staking the user to pay for themselves.
//
// SO NOTHING HERE MAY SAY "your own account pays its own way" ANY MORE. It did, truthfully, under
// the one-subsidy model. Under this one the relayer submits and is charged, and a user reading that
// sentence would be told the opposite of what the receipt shows.

export const DEADLOCK_TITLE = 'The first three are on us'

/** The fee is a parameter, never a literal — read from `get_fee_amount()` at render. */
export function deadlockBody(feeStrk: string | null): string {
  const cost = feeStrk === null ? 'one pool transaction' : `one pool transaction — currently ~${feeStrk} STRK`
  return `Registering costs ${cost}, and a new account cannot pay it from nothing — nobody may hold a shielded balance until they are registered. So we cover your first three transactions on mainnet. Registering is the first. The other two are yours to spend on anything.`
}

/** Names who pays, where payment happens. The claim has to match what the receipt will show. */
export function deadlockFeeRow(appName: string, feeStrk: string | null): string {
  return feeStrk === null
    ? `Paid by ${appName} · submitted from our relayer`
    : `Paid by ${appName} · ${feeStrk} STRK · submitted from our relayer`
}

/** What the offer is, in one line, wherever the flow needs to state it before anything is spent. */
export const SPONSORED_OFFER = 'Your first three transactions are on us — real STRK, on mainnet.'

/**
 * The honest footnote under the offer. Two things a user is owed before they rely on it: the pool
 * charges a fee on every transaction, which comes out of their own balance once ours runs out, and
 * the budget is finite and shared.
 */
export const SPONSORED_OFFER_NOTE =
  'After that, each transaction costs the pool fee from your shielded balance. The budget is shared and resets daily.'

// ── The ladder — creating the account ─────────────────────────────────────────────────────
//
// The drip buys ONE thing: enough STRK for the account to put itself on chain. Registration and the
// starter balance are sponsored and arrive together. Row titles live in `pipeline-stage.ts`; only
// the notes are here.

/** The per-stage note, shown only for the rung that is currently running. No amount is baked in. */
export const ONBOARDING_STAGE_NOTES = {
  drip: 'enough STRK to put your account on chain — the receipt below is its record',
  deploy: 'your address goes live on Starknet',
  settle: 'the proof is checked a few blocks behind the head, so a fresh deploy waits for the chain to pass it',
  register: 'we pay this one — your key and your starting balance land together',
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
export const FUND_PENDING = 'Sending the STRK that puts your account on chain…'

/**
 * The success line. `amount` is rendered by the caller so the number is never hardcoded here.
 *
 * It must NOT claim this covers registration any more — it does not, and it is not sized to. What
 * this money does is pay for one `deployAccount`; the fee after it is ours.
 */
export function fundArrived(amount: string): string {
  return (
    `${amount} STRK is on its way — give it a few seconds to land. It covers putting your account ` +
    'on chain. Registering, and the balance you start with, are on us.'
  )
}

/**
 * The refusal wrapper. `because` is the relayer's own sentence; this adds where the door is.
 *
 * A refused drip is not a refused account: the sponsored door is a separate budget with its own
 * counter, so this names the self-funded path without implying everything behind it is closed too.
 */
export function fundRefused(because: string): string {
  return `${because} Fund the account yourself from any wallet or exchange — the address is below, and this screen notices when it lands.`
}

export const FUND_CTA = 'Continue'

/**
 * The register screen's blocker when the account cannot get on chain yet.
 *
 * The number names the DEPLOY, not the registration — a deploy is ~0.06 STRK and the fee behind it
 * is sponsored, so quoting the old "about 8 STRK" would ask for money we no longer need and make
 * the door look far higher than it is.
 */
export const REGISTER_NEEDS_FUNDS =
  'This account holds no STRK yet, and it needs a little to put itself on chain — well under ' +
  '1 STRK. Registering is on us. Send some to your address below from any wallet or exchange; ' +
  'this screen notices when it lands.'

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

export const ENTER_CTA = 'Enter strk20.run'

/** What the onboarding stage says beside each screen: three lines, the middle one in the accent. */
export type StageKey =
  | 'booting'
  | 'no-storage'
  | 'locked'
  | 'checking'
  | 'fork'
  | 'import'
  | 'teach'
  | 'name'
  | 'custody'
  | 'backup'
  | 'fund'
  | 'register'

export const STAGE_LINES: Record<StageKey, readonly [string, string, string]> = {
  booting: ['', 'strk20.run', ''],
  'no-storage': ['This browser', 'cannot', 'hold a key.'],
  locked: ['Locked.', 'Your key', 'is still here.'],
  checking: ['Reading', 'the chain.', ''],
  fork: ['Everything', 'on Starknet,', 'one account.'],
  import: ['Your key,', 'back.', 'Same address.'],
  teach: ['Two balances.', 'Never', 'summed.'],
  name: ['A name is', 'optional.', 'Public if claimed.'],
  custody: ['The key is', 'made here.', 'Sent nowhere.'],
  backup: ['One file.', 'No reset.', 'Keep it.'],
  fund: ['Money lands', 'public', 'first.'],
  register: ['Now the pool', 'knows', 'your key.'],
}

/** The stage's footer tick — the one move this whole flow exists for. */
export const STAGE_TICK = ['public', 'shielded'] as const

export const REGISTER_TITLE = 'Register your key'
export const REGISTER_CTA = 'Create your account'

/** The terminal state, rendered on the register screen once the write confirms. */
export const REGISTERED_TITLE = 'You’re in'
export const REGISTERED_BODY =
  'Registered, on-chain, and usable. Anything sent to you shows up in your record; your shielded ' +
  'balance is nobody else’s to read.'
