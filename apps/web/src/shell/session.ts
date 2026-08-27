//
// THE APP'S FRONT DOOR — the call `session.ts` was written for and never had.
//
// `packages/protocol/src/session.ts:1-8` says it outright: *"Epic 6 boots the browser app from
// here: build a store, get the account key… The call that builds a store at app boot is epic 6's."*
// Every piece below it — the storage boundary, the key, the leader lock, the cadence store — has
// been built and tested for weeks with zero callers. This is the caller.
//
// ── LOGIN-FREE BY CONSTRUCTION, WHICH IS A PRODUCT DECISION AND A GATE REQUIREMENT ────────
//
// AD-4/AD-7: the account is derived in the browser on first load. There is no wallet to connect,
// no email, no seed phrase to paste before anything works. Opening the page IS having an account.
// That is also what makes the hosted demo satisfy "works without login" — not a waiver, a
// consequence.
//
// ── THE HONEST AUTH SURFACE IS CREATE / IMPORT / UNLOCK / LOCK, AND "DISCONNECT" IS LOCK ──
//
// There is no wallet to disconnect from — there never was — so the four verbs above are the whole
// lifecycle, and zk-freighter's `App.tsx` does the same four in 206 lines. What is deliberately
// NOT here is a password: `session-key.ts` argues at length that the root key sits in localStorage
// in plaintext as an accepted risk, so a password on the unlock screen would protect nothing and
// would tell the user it protected something. `account-copy.ts`'s `LOCK_WHAT_IT_DOES` says what a
// lock here is: a screen lock. Unlock therefore verifies an IDENTITY rather than a secret — that
// the stored key still derives the address recorded beside it — which is the one thing that can
// actually have gone wrong.
//
// ── THE SDK LOADS LAZILY, AND THE GATE ENFORCES IT ───────────────────────────────────────
//
// `identity.ts` reaches `starknet` for its CSPRNG and curve arithmetic, so importing it statically
// would put the crypto graph in the entry chunk and `build:web` would refuse the build by name.
// Everything here is behind `import()`, and the session arrives a beat after first paint —
// which is why `SessionState` has a `loading` arm rather than pretending an account exists
// synchronously.
//
// ── A BROWSER THAT CANNOT SAVE GETS NO ACCOUNT, AND THAT IS DELIBERATE ───────────────────
//
// `browserSessionStore` has NO in-memory fallback, and its own header explains why: an account
// that vanishes on reload is one a user could fund and then lose, and registering from it would
// orphan it on the pool — where the viewing key is written once and `WriteOnce` refuses every
// replacement. So the honest outcome is a refusal that says so.
//
// ── WHY THIS IS A STORE AND NOT A PROMISE ANY MORE ───────────────────────────────────────
//
// The first version was a module-scope promise read by a `useState` + `useEffect` pair, which is
// correct for a value that is derived once and never changes. Locking, switching and importing all
// change it, from a drawer that is not an ancestor of the surfaces reading it. So it is a
// `useSyncExternalStore` singleton — `pool-health.ts`'s pattern, for `toast-store.ts`'s reason:
// context answers "who is my provider", and an account switch has no business knowing.
//
import { useSyncExternalStore } from 'react'

// STATIC, and correct precisely because this module has no SDK edge: `account-address.ts` takes the
// Pedersen hasher as an argument rather than importing one, which is the whole reason it was
// written that way. Importing it dynamically here while `submit.ts` imports it statically also
// defeated both splits — the bundler said so, and the warning contract refused the build.
import { accountAddressFor } from '@strk20/protocol/account-address'

/** One account this browser holds, as the drawer's switch list needs it. Never carries a key. */
export interface AccountSummary {
  address: string
  label: string | null
  addedAt: number
  /** True for the one currently in use. */
  active: boolean
}

/** What the app knows about its own account. */
export type SessionState =
  /** Before the first answer. NOT "no account" — nothing has been read yet. */
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      /** The root key. Never rendered, never logged — held so callers can sign. */
      readonly accountKey: string
      /**
       * Derived, never stored: a second copy of a secret with nothing gained.
       *
       * BOUND TO THE CHAIN AND THE POOL, which is a privacy property rather than a parameter list.
       * The same account key against a different pool yields an unrelated viewing key, so one
       * pool's indexer cannot read another's notes.
       */
      readonly viewingKey: bigint
      /**
       * Where this account WILL live — its counterfactual address.
       *
       * Starknet has no EOAs: an account is a contract, and its address is a hash of what it will
       * be deployed from. So this is exact and usable before anything is deployed — funds sent
       * here wait for the deployment. It is also what discovery looks the account up by.
       */
      readonly address: string
      /** What the user called this account, or `null`. Never generated. */
      readonly label: string | null
      /** True on the load that created it, so a first run can say something a return visit must not. */
      readonly created: boolean
      readonly accounts: readonly AccountSummary[]
    }
  /**
   * The screen is locked. The key is out of this page and still in storage.
   *
   * It carries the ADDRESS but never the key: everything the locked screen renders — the identity
   * disc, the short address, which account you are about to unlock — is public, and a locked state
   * holding the key in memory would be a lock with nothing behind it.
   */
  | {
      readonly status: 'locked'
      readonly address: string
      readonly label: string | null
      readonly accounts: readonly AccountSummary[]
      /** Why the last unlock did not work, or `null`. */
      readonly problem: string | null
    }
  /** The account could not be established. `because` is a whole sentence, safe to render. */
  | { readonly status: 'failed'; readonly because: string }

/** What a lifecycle action did. `because` is a whole sentence, safe to render. */
export type SessionOutcome = { ok: true } | { ok: false; because: string }

/** An import also reports whether this browser already held the account. */
export type ImportOutcome =
  | { ok: true; address: string; already: boolean }
  | { ok: false; because: string }

//
// ── ONE SESSION PER TAB, SHARED BY EVERY SURFACE ─────────────────────────────────────────
//
let state: SessionState = { status: 'loading' }
const listeners = new Set<() => void>()

function publish(next: SessionState): void {
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  void ensureBooted()
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Every module this tier needs, loaded once.
 *
 * One dynamic import for the whole tier; the bundler gives it a single chunk. Held after the first
 * load so a lock/unlock/switch is synchronous-feeling rather than a second round trip — and so the
 * `SessionStore` is built ONCE. Building a second one would re-run the storage probe, which writes
 * and removes a witness key on every call.
 */
type Tier = {
  protocol: typeof import('@strk20/protocol/session')
  identity: typeof import('@strk20/protocol/identity')
  net: typeof import('@strk20/protocol/constants').NET
  sdk: typeof import('starknet')
  store: import('@strk20/protocol/session-store').SessionStore
  accounts: import('@strk20/protocol/session-accounts').AccountRecordStore
}

let tier: Promise<Tier> | null = null

function loadTier(): Promise<Tier> {
  if (tier) return tier
  tier = (async () => {
    const [protocol, identity, constants, sdk] = await Promise.all([
      import('@strk20/protocol/session'),
      import('@strk20/protocol/identity'),
      import('@strk20/protocol/constants'),
      // The SDK is already in this chunk because of `identity`, so naming it costs nothing here —
      // and `account-address.ts` deliberately takes the hasher rather than importing it, so that
      // module stays loadable by anything.
      import('starknet'),
    ])
    const store = protocol.browserSessionStore()
    return {
      protocol,
      identity,
      net: constants.NET,
      sdk,
      store,
      accounts: protocol.sessionAccountStore(store),
    }
  })().catch((error: unknown) => {
    // A failed chunk load is NOT cached — the retry on the next action should be a real retry.
    tier = null
    throw error
  })
  return tier
}

/** The address and viewing key an account key implies. Pure, given the tier. */
function identityFor(t: Tier, accountKey: string): { address: string; viewingKey: bigint } {
  return {
    address: accountAddressFor(t.sdk.ec.starkCurve.getStarkKey(accountKey), (a, b) =>
      t.sdk.hash.computePedersenHash(a, b),
    ),
    viewingKey: t.identity.deriveViewingKey(accountKey, t.net.chainId, t.net.pool),
  }
}

function summarize(
  t: Tier,
  record: import('@strk20/protocol/session-accounts').StoredAccounts,
): AccountSummary[] {
  return [...record.accounts]
    .sort((a, b) => a.addedAt - b.addedAt)
    .map((account) => ({
      address: account.address,
      label: account.label,
      addedAt: account.addedAt,
      active: t.protocol.sameAddress(account.address, record.active),
    }))
}

/**
 * The store's own refusal sentence when this browser cannot persist anything, or `null` when it
 * can.
 *
 * `browserSessionStore` hands back a store whose every method throws `SESSION_STORAGE_UNAVAILABLE`
 * plus the probe's reason, rather than returning `null` — so the only way to ask "does storage
 * work" is to use it. A read of a key that has never been written answers `null` on a healthy
 * store and throws on a refusing one, which is exactly the distinction needed and costs nothing.
 */
function storageIsBroken(t: Tier): string | null {
  try {
    t.store.read(t.protocol.SESSION_KEYS.accountKey)
    return null
  } catch (error) {
    return error instanceof Error && error.message ? error.message : String(error)
  }
}

/**
 * The refusal when an action finds no account list at all.
 *
 * Inline rather than in `account-copy.ts` because it is not a state a user can reach by using the
 * product — the boot writes a record before any of these actions can be pressed. It is the sentence
 * for a list that was removed from under a live session, and its job is to be honest in a bug
 * report rather than to guide anybody.
 */
const NO_ACCOUNT_LIST =
  'This browser has no account list to add to, and this app will not create one on top of a key it ' +
  'has not read. Reload the page.'

/**
 * The sentence for an account list that is present and does not parse.
 *
 * It promises NO REPAIR, deliberately. Overwriting the list with a fresh seed — or with an
 * imported account — would drop every entry it holds, and an account whose recovery file was never
 * saved is gone the moment that happens. Refusing costs a broken session in a state only a
 * hand-edited localStorage can reach; repairing costs somebody's money in the state where they
 * needed it most.
 */
function accountListCorrupt(reason: string): string {
  return (
    `The list of accounts saved in this browser could not be read, so nothing was changed: ${reason}. ` +
    'No key has been overwritten, and this app will not replace a list it cannot read — doing so ' +
    'would drop the accounts inside it.'
  )
}

/** The sentence for a failure that is not one of the typed ones. */
function whyFailed(error: unknown): string {
  return error instanceof Error && error.message
    ? `This browser could not open an account: ${error.message}`
    : 'This browser could not open an account.'
}

let booting: Promise<void> | null = null

/**
 * Build or load this browser's accounts. Runs once; a FAILURE IS NOT CACHED.
 *
 * NEVER THROWS. A failure here is the app having no account, which is a state to render — not an
 * exception on the way to a blank page.
 */
async function ensureBooted(): Promise<void> {
  if (booting) return booting
  booting = (async () => {
    try {
      const t = await loadTier()
      const read = t.accounts.load()

      if (read.kind === 'unreadable') {
        //
        // "I could not look" is not "there is nothing here", and the difference decides whether it
        // is safe to generate a key. `session-key.ts` makes the same call one layer down: a store
        // we cannot read may well be sitting on the key this account is registered with. So this
        // arm NEVER writes — a corrupt account list must not be replaced by a fresh seed, because
        // the accounts it lists are unrecoverable for anyone who has not exported them.
        //
        // TWO CAUSES, TWO SENTENCES. A browser with no usable storage at all (private mode, a
        // blocked origin, a full quota) reaches here as well, and its honest explanation is
        // `browserSessionStore`'s own refusal — the sentence that tells someone to leave private
        // browsing, which is actionable. Probing the store directly is what tells the two apart.
        //
        publish({ status: 'failed', because: storageIsBroken(t) ?? accountListCorrupt(read.reason) })
        return
      }

      if (read.kind === 'absent') {
        // A browser that predates the account list, or a genuinely first visit. Either way
        // `loadOrCreateAccountKey` is the path: it adopts the key already in the single-key slot
        // when there is one, and mints one when there is not.
        const key = t.protocol.loadOrCreateAccountKey(t.store)
        if (!key.ok) {
          publish({ status: 'failed', because: key.reason })
          return
        }
        const derived = identityFor(t, key.accountKey)
        const record = t.protocol.seedFrom(key.accountKey, derived.address, Date.now())
        t.accounts.save(record)
        publish({
          status: 'ready',
          accountKey: key.accountKey,
          viewingKey: derived.viewingKey,
          address: derived.address,
          label: null,
          created: key.created,
          accounts: summarize(t, record),
        })
        return
      }

      const active = t.protocol.activeAccount(read.record)
      if (!active) {
        // `parseStoredAccounts` refuses a record whose active address names nothing, so this is
        // unreachable through storage. It is here because the type allows it and a silent
        // `undefined` at this point would boot the app into an account it has no key for.
        publish({ status: 'failed', because: 'The active account is missing from this browser’s account list.' })
        return
      }

      const summary = summarize(t, read.record)
      if (read.record.locked) {
        publish({
          status: 'locked',
          address: active.address,
          label: active.label,
          accounts: summary,
          problem: null,
        })
        return
      }

      const derived = identityFor(t, active.accountKey)
      if (!t.protocol.sameAddress(derived.address, active.address)) {
        // The stored key no longer derives the address stored beside it. Refuse to open into it —
        // zk-freighter's `App.tsx:107` check, and the reason is the same: an app that quietly
        // adopts a swapped identity would let a user fund and register the wrong account.
        const { UNLOCK_DIFFERENT_IDENTITY } = await import('@strk20/protocol/account-copy')
        publish({
          status: 'locked',
          address: active.address,
          label: active.label,
          accounts: summary,
          problem: UNLOCK_DIFFERENT_IDENTITY,
        })
        return
      }

      publish({
        status: 'ready',
        accountKey: active.accountKey,
        viewingKey: derived.viewingKey,
        address: derived.address,
        label: active.label,
        created: false,
        accounts: summary,
      })
    } catch (error) {
      publish({ status: 'failed', because: whyFailed(error) })
    } finally {
      // Cleared either way: a `failed` session should be retried by the next action rather than
      // being remembered as the answer forever.
      if (state.status === 'failed') booting = null
    }
  })()
  return booting
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

// ── The lifecycle ─────────────────────────────────────────────────────────────────────────

/**
 * Lock the screen.
 *
 * Drops the key out of the page and records the lock so a reload lands here too — a wallet the
 * user locked being open again after a refresh is the behaviour nobody expects. It does NOT
 * encrypt anything and the copy says so.
 */
export async function lockSession(): Promise<SessionOutcome> {
  if (state.status !== 'ready') return { ok: true }
  try {
    const t = await loadTier()
    const { LOCK_NOT_SAVED } = await import('@strk20/protocol/account-copy')

    // RE-READ AFTER THE AWAIT. `state` is a module singleton and both awaits above yield, so a
    // switch that was already in flight can publish in between — and locking against the snapshot
    // taken on entry would put the PREVIOUS account's address on the locked screen while storage
    // says a different one is active. Unlocking would then land somewhere the user was not shown.
    const current = state
    if (current.status !== 'ready') return { ok: true }

    const read = t.accounts.load()
    // THE IN-MEMORY LOCK IS REAL EVEN WHEN THE PERSISTED ONE IS NOT — the key genuinely leaves the
    // page either way — so this publishes regardless, and REPORTS the difference rather than
    // returning `ok` for a lock that a reload will undo. Claiming success there would be the
    // overclaim: the user would close the tab believing the wallet was locked behind them.
    let saved = false
    if (read.kind === 'present') {
      t.accounts.save(t.protocol.withLocked(read.record, true))
      saved = true
    }

    publish({
      status: 'locked',
      address: current.address,
      label: current.label,
      accounts: current.accounts,
      problem: null,
    })
    return saved ? { ok: true } : { ok: false, because: LOCK_NOT_SAVED }
  } catch (error) {
    return { ok: false, because: whyFailed(error) }
  }
}

/**
 * Unlock: read the key back and CHECK IT STILL DERIVES THE ADDRESS RECORDED BESIDE IT.
 *
 * The check is the whole function. There is no secret to get wrong here, so the only failure worth
 * a sentence is the one where the stored key and the stored address have stopped agreeing.
 */
export async function unlockSession(): Promise<SessionOutcome> {
  try {
    const t = await loadTier()
    const { UNLOCK_DIFFERENT_IDENTITY } = await import('@strk20/protocol/account-copy')
    const read = t.accounts.load()
    if (read.kind !== 'present') {
      //
      // IT STAYS LOCKED RATHER THAN GOING TO `failed`, AND THAT IS THE RECOVERY PATH.
      //
      // `failed` is terminal from here: `ensureBooted` only retries while its promise is unsettled,
      // and by now it is settled, so nothing in the app can re-boot the session. Publishing it
      // would leave a permanently dead chip and a dead surface over a `passbook.account-key` that
      // may be perfectly good — recoverable only by reloading the page.
      //
      // Staying locked keeps the Unlock button on screen, and the Unlock button IS the retry: a
      // storage read that failed once (another tab mid-write, a transient quota) usually succeeds
      // on the next press.
      //
      const because =
        read.kind === 'unreadable'
          ? `The accounts saved in this browser could not be read: ${read.reason}`
          : 'There is no account saved in this browser to unlock.'
      const current = state
      if (current.status === 'locked') publish({ ...current, problem: because })
      return { ok: false, because }
    }

    const active = t.protocol.activeAccount(read.record)
    if (!active) return { ok: false, because: UNLOCK_DIFFERENT_IDENTITY }

    const derived = identityFor(t, active.accountKey)
    if (!t.protocol.sameAddress(derived.address, active.address)) {
      publish({
        status: 'locked',
        address: active.address,
        label: active.label,
        accounts: summarize(t, read.record),
        problem: UNLOCK_DIFFERENT_IDENTITY,
      })
      return { ok: false, because: UNLOCK_DIFFERENT_IDENTITY }
    }

    const record = t.protocol.withLocked(read.record, false)
    t.accounts.save(record)
    publish({
      status: 'ready',
      accountKey: active.accountKey,
      viewingKey: derived.viewingKey,
      address: derived.address,
      label: active.label,
      created: false,
      accounts: summarize(t, record),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, because: whyFailed(error) }
  }
}

/** Make one of the held accounts active. Unknown addresses change nothing and say so. */
export async function switchAccount(address: string): Promise<SessionOutcome> {
  try {
    const t = await loadTier()
    const read = t.accounts.load()
    if (read.kind !== 'present') {
      return { ok: false, because: 'There is no account list in this browser to switch inside.' }
    }
    const target = t.protocol.findAccount(read.record, address)
    if (!target) return { ok: false, because: 'This browser does not hold that account.' }

    const record = t.protocol.withActive(read.record, target.address)
    t.accounts.save(record)
    const derived = identityFor(t, target.accountKey)
    publish({
      status: 'ready',
      accountKey: target.accountKey,
      viewingKey: derived.viewingKey,
      address: derived.address,
      label: target.label,
      created: false,
      accounts: summarize(t, record),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, because: whyFailed(error) }
  }
}

/**
 * Mint a second (or third) account in this browser.
 *
 * `generateIdentity` rather than `loadOrCreateAccountKey`: that function's whole job is to return
 * the key already in storage when there is one, which is the opposite of what this asks for.
 */
export async function createAccount(label?: string): Promise<SessionOutcome> {
  try {
    const t = await loadTier()
    const read = t.accounts.load()
    if (read.kind === 'unreadable') {
      return { ok: false, because: `The accounts in this browser could not be read: ${read.reason}` }
    }

    //
    // NO `absent` FALLBACK, DELIBERATELY. Seeding a one-entry record here would write a list
    // containing ONLY the new account and move the mirror onto it — discarding whatever
    // `passbook.account-key` was holding. The boot path routes that exact situation through
    // `loadOrCreateAccountKey` precisely so an existing single-key account is ADOPTED rather than
    // replaced, and this must not be the one door that skips it.
    //
    // Unreachable in normal operation: no action can run before the boot published `ready` or
    // `locked`, and both of those imply a record was saved. If it is missing now, something removed
    // it mid-session, and the safe answer is to refuse rather than to build a fresh list over it.
    //
    if (read.kind === 'absent') {
      return { ok: false, because: NO_ACCOUNT_LIST }
    }

    const generated = t.identity.generateIdentity().privateKey
    if (!t.identity.isStarkPrivateKey(generated)) {
      return { ok: false, because: 'The key generator returned something that is not a Stark private key.' }
    }
    const derived = identityFor(t, generated)
    const now = Date.now()
    const entry = {
      address: derived.address,
      accountKey: generated,
      label: label?.trim() ? label.trim() : null,
      addedAt: now,
    }
    const record = t.protocol.withAccount(read.record, entry)
    // PERSIST BEFORE PUBLISH — `session-key.ts`'s ordering, and for its reason: a key handed to the
    // UI and never written is an identity a user can fund and lose on the next reload. A throwing
    // save leaves the previous account active, which is the safe direction.
    t.accounts.save(record)
    publish({
      status: 'ready',
      accountKey: generated,
      viewingKey: derived.viewingKey,
      address: derived.address,
      label: entry.label,
      created: true,
      accounts: summarize(t, record),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, because: whyFailed(error) }
  }
}

/**
 * Read back a Recovery File — the half of the ceremony that has never existed.
 *
 * `BackupCeremony` can WRITE one and nothing in this app could open one, so a user who saved their
 * key had no way to use it. This is the reader, and it is `restoreBackup` plus two checks:
 *
 *   1. WHAT CAME OUT IS A KEY. `restoreBackup` returns the decrypted plaintext, and a file whose
 *      ciphertext happened to decrypt to something else must not be adopted as an identity.
 *   2. THE FILE'S OWN HEADER AGREES WITH IT. `v:2` files bind the header to the ciphertext as
 *      additional data, so a header that survives decryption is one nobody edited — which makes
 *      `receiveAddress` a real cross-check on the key inside rather than a decoration.
 *
 * The two failures are reported separately, which is zk-freighter's `App.tsx:132` distinction:
 * a wrong code is a typo, and a file that opens to a different identity is not.
 */
export async function importAccount(file: string, recoveryCode: string): Promise<ImportOutcome> {
  try {
    const t = await loadTier()
    const copy = await import('@strk20/protocol/account-copy')

    let restored: string
    try {
      restored = await t.identity.restoreBackup(file, recoveryCode)
    } catch (error) {
      const kind = error instanceof t.identity.BackupRestoreError ? error.kind : 'undecryptable'
      // One sentence per kind, and never the catch-all: `identity.ts` argues that telling the owner
      // of an INTACT file to replace it invites them to delete a key that cannot be reissued.
      const because =
        kind === 'unsupported-version'
          ? copy.IMPORT_UNSUPPORTED_VERSION
          : kind === 'not-json' || kind === 'not-an-envelope'
            ? copy.IMPORT_FILE_UNREADABLE
            : copy.IMPORT_CODE_WRONG
      return { ok: false, because }
    }

    if (!t.identity.isStarkPrivateKey(restored)) return { ok: false, because: copy.IMPORT_NO_KEY }

    const derived = identityFor(t, restored)
    const header = t.identity.readBackupHeader(file)
    if (header?.receiveAddress && !t.protocol.sameAddress(header.receiveAddress, derived.address)) {
      return { ok: false, because: copy.IMPORT_DIFFERENT_IDENTITY }
    }

    const read = t.accounts.load()
    if (read.kind === 'unreadable') {
      return { ok: false, because: `The accounts in this browser could not be read: ${read.reason}` }
    }
    // No `absent` fallback, for `createAccount`'s reason: seeding a fresh one-entry list here would
    // discard whatever the single-key slot was holding.
    if (read.kind === 'absent') return { ok: false, because: NO_ACCOUNT_LIST }

    const already = t.protocol.findAccount(read.record, derived.address) !== undefined
    const now = Date.now()
    const entry = { address: derived.address, accountKey: restored, label: null, addedAt: now }
    const record = t.protocol.withAccount(read.record, entry)
    t.accounts.save(record)

    publish({
      status: 'ready',
      accountKey: restored,
      viewingKey: derived.viewingKey,
      address: derived.address,
      label: t.protocol.findAccount(record, derived.address)?.label ?? null,
      // An imported account is not a NEW one: `created` drives first-run copy, and a restore is
      // the opposite of a first run.
      created: false,
      accounts: summarize(t, record),
    })
    return { ok: true, address: derived.address, already }
  } catch (error) {
    return { ok: false, because: whyFailed(error) }
  }
}

/** Name the active account, or clear its name. */
export async function labelAccount(address: string, label: string | null): Promise<SessionOutcome> {
  try {
    const t = await loadTier()
    const read = t.accounts.load()
    if (read.kind !== 'present') return { ok: false, because: 'There is no account list to name in.' }
    const record = t.protocol.withLabel(read.record, address, label)
    t.accounts.save(record)
    const current = state
    if (current.status === 'ready') {
      publish({
        ...current,
        label: t.protocol.findAccount(record, current.address)?.label ?? null,
        accounts: summarize(t, record),
      })
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, because: whyFailed(error) }
  }
}

/**
 * A felt shortened for display: `0x1234…abcd`.
 *
 * The ELLIPSIS IS ONE CHARACTER (U+2026), not three dots — three periods in a monospace address is
 * three more characters that look like part of the value.
 */
export function shortenFelt(felt: string, lead = 6, tail = 4): string {
  if (felt.length <= lead + tail + 1) return felt
  return `${felt.slice(0, lead)}…${felt.slice(-tail)}`
}
