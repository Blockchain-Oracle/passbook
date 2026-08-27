//
// More than one account in one browser (Wave 1 — the account drawer's Switch row).
//
// ── WHY THIS IS A NEW RECORD AND NOT A WIDENED `passbook.account-key` ────────────────────
//
// `passbook.account-key` holds ONE key as a bare string, and `loadOrCreateAccountKey` reads it,
// validates it, and generates one when it is missing. Every one of those behaviours is load-
// bearing — the persist-before-return ordering, the re-read, the tab race narrowing — and none of
// them is worth re-deriving for a list.
//
// So the list lives beside it, and the single-key slot KEEPS MIRRORING THE ACTIVE ACCOUNT. That
// is the whole backward-compatibility story and it runs in both directions:
//
//   - A build that predates this file reads `passbook.account-key`, finds the active account's
//     key exactly where it has always been, and boots into it. Nothing it can do is broken by a
//     record it never reads.
//   - A browser that predates this file has no `passbook.accounts` at all. `seedFrom` turns the
//     key already in storage into a one-entry record, so the first boot after the upgrade adopts
//     the existing identity rather than minting a second one beside it.
//
// The mirror is what makes the second bullet safe to repeat: migration is idempotent, because the
// key it seeds from is the key the record then declares active.
//
// ── ADDRESSES ARE COMPARED NUMERICALLY, AND STORED AS WRITTEN ────────────────────────────
//
// A felt has at least three faces — `0x2867e2…`, `0x02867e2…`, and the decimal a `bigint`
// stringifies to. `activity-entry.ts`'s `noteKey` documents what happens to a `Map` keyed by one
// of them: lookups spelled another way silently miss, and the failure is invisible. The same trap
// here would switch to an account that is already active, or import a duplicate of an account
// this browser holds. So every comparison goes through `sameAddress`, and what is STORED is the
// spelling the caller had, because that is what its own surfaces render.
//
// ── NEVER THROWS ON THE WAY IN ───────────────────────────────────────────────────────────
//
// `parseStoredAccounts` follows `parseStoredInviteIntents`: localStorage is writable by any script
// on this origin and by the user, so a malformed record is a state to report, not an exception in
// the middle of a boot. `unreadable` is deliberately distinct from `absent` — the first must not
// be treated as "no accounts yet", because that reading would generate a fresh key on top of a
// browser that already holds one.
//
import { isStarkPrivateKey } from './identity.js'
import { SESSION_KEYS, type SessionKey, type SessionStore } from './session-store.js'

/** The record version this build writes. A different one reads as `unreadable`. */
export const ACCOUNTS_RECORD_VERSION = 1

/** The longest label this will read back. Long enough to name an account, short enough to render. */
export const MAX_ACCOUNT_LABEL_LENGTH = 40

/** One account this browser holds. */
export interface StoredAccount {
  /** The counterfactual address. The identity everything else is keyed by. */
  address: string
  /** The root key for that address. The one secret in this record. */
  accountKey: string
  /** What the user called it, or `null`. Never generated — an unnamed account stays unnamed. */
  label: string | null
  /** When this browser first held it, as epoch ms. Orders the switch list. */
  addedAt: number
}

/** Every account this browser holds, which one is active, and whether the screen is locked. */
export interface StoredAccounts {
  /** The active account's address. Always one of `accounts`. */
  active: string
  /**
   * Whether the user locked the screen.
   *
   * PERSISTED DELIBERATELY, and it is not a security claim — `account-copy.ts`'s `LOCK_WHAT_IT_DOES`
   * states in the UI that this is a screen lock over a key that stays in plaintext storage. What
   * persisting buys is the behaviour a user expects: a wallet they locked is still locked when
   * they come back, rather than open because the tab reloaded.
   */
  locked: boolean
  accounts: readonly StoredAccount[]
}

/** What was in storage. `unreadable` is not `absent` — see the header. */
export type StoredAccountsRead =
  | { kind: 'absent' }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'present'; record: StoredAccounts }

/** True when two felts name the same address, whatever their spelling. */
export function sameAddress(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    // Not both parseable as felts. Fall back to exact text rather than claiming a match — a
    // comparison that cannot be made must fail closed, or a corrupt record adopts a real one.
    return a === b
  }
}

/** Finds one account by address, whatever the spelling. `undefined` when this browser has none. */
export function findAccount(
  record: StoredAccounts,
  address: string,
): StoredAccount | undefined {
  return record.accounts.find((account) => sameAddress(account.address, address))
}

/**
 * The active account, or `null`.
 *
 * `null` is reachable from a record whose `active` names nothing — which `parseStoredAccounts`
 * refuses, so in practice this answers `null` only for a record built in memory and not yet
 * validated. Callers treat it the same as an unreadable record: do not act.
 */
export function activeAccount(record: StoredAccounts): StoredAccount | null {
  return findAccount(record, record.active) ?? null
}

/** The one-entry record a browser that predates this file migrates into. */
export function seedFrom(accountKey: string, address: string, addedAt: number): StoredAccounts {
  return {
    active: address,
    locked: false,
    accounts: [{ address, accountKey, label: null, addedAt }],
  }
}

/**
 * Adds an account, or replaces the entry for one already held, and makes it active.
 *
 * REPLACES RATHER THAN APPENDS, keyed on the address. Importing a recovery file for an account
 * this browser already holds is an ordinary thing to do — a user restoring on a machine they
 * already used — and appending would leave two entries for one identity, with a switch list that
 * shows the same account twice and no way to tell which one anything wrote to.
 *
 * The EXISTING label survives an import that carries none, because a name the user typed is not
 * something a restore should quietly erase.
 */
export function withAccount(record: StoredAccounts, account: StoredAccount): StoredAccounts {
  const existing = findAccount(record, account.address)
  const merged: StoredAccount = {
    ...account,
    label: account.label ?? existing?.label ?? null,
    addedAt: existing?.addedAt ?? account.addedAt,
  }
  return {
    active: merged.address,
    locked: false,
    accounts: [
      ...record.accounts.filter((held) => !sameAddress(held.address, account.address)),
      merged,
    ],
  }
}

/**
 * Makes one held account active, and unlocks.
 *
 * An address this browser does not hold returns the record UNCHANGED rather than throwing or
 * inventing an entry. The caller's UI can only offer addresses from the list, so an unknown one
 * means the list moved underneath it — and switching to an account with no key would leave the
 * app claiming an identity it cannot sign for.
 */
export function withActive(record: StoredAccounts, address: string): StoredAccounts {
  return findAccount(record, address) ? { ...record, active: address, locked: false } : record
}

/** Sets the screen lock. */
export function withLocked(record: StoredAccounts, locked: boolean): StoredAccounts {
  return { ...record, locked }
}

/** Renames the active account. A blank name clears it rather than storing whitespace. */
export function withLabel(
  record: StoredAccounts,
  address: string,
  label: string | null,
): StoredAccounts {
  const trimmed = label === null ? null : label.trim().slice(0, MAX_ACCOUNT_LABEL_LENGTH)
  return {
    ...record,
    accounts: record.accounts.map((account) =>
      sameAddress(account.address, address)
        ? { ...account, label: trimmed === null || trimmed === '' ? null : trimmed }
        : account,
    ),
  }
}

/**
 * Reads a stored record back, validating every field.
 *
 * REBUILT FROM NAMED FIELDS, never handed back as parsed — `loadCeremony`'s rule, for the same
 * reason: anything else in the stored object is somebody else's, and must not ride into a value
 * this module hands back as a record it vouches for.
 */
export function parseStoredAccounts(raw: string | null): StoredAccountsRead {
  if (raw === null || raw === '') return { kind: 'absent' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { kind: 'unreadable', reason: `the stored accounts are not JSON: ${String(e)}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'unreadable', reason: `the stored accounts are ${parsed === null ? 'null' : typeof parsed}` }
  }

  const value = parsed as { v?: unknown; active?: unknown; locked?: unknown; accounts?: unknown }
  if (value.v !== ACCOUNTS_RECORD_VERSION) {
    return {
      kind: 'unreadable',
      reason: `the stored accounts are version ${String(value.v)}, and this build writes ${ACCOUNTS_RECORD_VERSION}`,
    }
  }
  if (typeof value.active !== 'string' || value.active === '') {
    return { kind: 'unreadable', reason: `the active address is ${String(value.active)}` }
  }
  if (typeof value.locked !== 'boolean') {
    return { kind: 'unreadable', reason: `the locked flag is ${String(value.locked)}` }
  }
  if (!Array.isArray(value.accounts) || value.accounts.length === 0) {
    return { kind: 'unreadable', reason: 'the stored accounts list is empty or not a list' }
  }

  const accounts: StoredAccount[] = []
  for (const [index, entry] of value.accounts.entries()) {
    const account = readAccount(entry, index)
    if (typeof account === 'string') return { kind: 'unreadable', reason: account }
    // A duplicate address means two keys claiming one identity, and there is no rule for picking
    // between them that is not a guess about somebody's money. Refuse the whole record.
    if (accounts.some((held) => sameAddress(held.address, account.address))) {
      return { kind: 'unreadable', reason: `account ${index} repeats an address already in the list` }
    }
    accounts.push(account)
  }

  const record: StoredAccounts = { active: value.active, locked: value.locked, accounts }
  // An active address naming nothing is the one inconsistency that would boot the app into an
  // account it has no key for.
  if (!findAccount(record, record.active)) {
    return { kind: 'unreadable', reason: 'the active address is not one of the stored accounts' }
  }
  return { kind: 'present', record }
}

/** One entry, or the sentence saying why it is not one. */
function readAccount(entry: unknown, index: number): StoredAccount | string {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return `account ${index} is ${entry === null ? 'null' : typeof entry}`
  }
  const value = entry as { address?: unknown; accountKey?: unknown; label?: unknown; addedAt?: unknown }

  if (typeof value.address !== 'string' || value.address === '') {
    return `account ${index} has an address of ${String(value.address)}`
  }
  // THE SAME PREDICATE `loadOrCreateAccountKey` APPLIES, so "usable key" means one thing across
  // the codebase. A stored value that is not a key cannot sign, cannot derive a viewing key, and
  // would push its failure into `deriveViewingKey`, which throws.
  if (!isStarkPrivateKey(value.accountKey)) {
    return `account ${index} has a key that is not a Stark private key`
  }
  if (value.label !== null && value.label !== undefined && typeof value.label !== 'string') {
    return `account ${index} has a label of ${String(value.label)}`
  }
  if (typeof value.addedAt !== 'number' || !Number.isFinite(value.addedAt)) {
    return `account ${index} has an addedAt of ${String(value.addedAt)}`
  }

  const label =
    typeof value.label === 'string' ? value.label.trim().slice(0, MAX_ACCOUNT_LABEL_LENGTH) : ''
  return {
    address: value.address,
    accountKey: value.accountKey,
    label: label === '' ? null : label,
    addedAt: value.addedAt,
  }
}

/** Serializes a record. THROWS on one it would not read back — the `serializeCadence` contract. */
export function serializeAccounts(record: StoredAccounts): string {
  const text = JSON.stringify({
    v: ACCOUNTS_RECORD_VERSION,
    active: record.active,
    locked: record.locked,
    accounts: record.accounts.map((account) => ({
      address: account.address,
      accountKey: account.accountKey,
      label: account.label,
      addedAt: account.addedAt,
    })),
  })
  // THE ROUND TRIP IS THE VALIDATION, rather than a second copy of the field rules. A record that
  // does not read back is one that silently disappears on the next boot, taking the switch list
  // with it — and the write would have reported success.
  const echo = parseStoredAccounts(text)
  if (echo.kind !== 'present') {
    throw new Error(
      `refusing to write an accounts record that would not read back: ${
        echo.kind === 'unreadable' ? echo.reason : 'it read back as absent'
      }`,
    )
  }
  return text
}

/** Load and save, over any `SessionStore`. The seam epic 6's boot wires. */
export interface AccountRecordStore {
  load(): StoredAccountsRead
  save(record: StoredAccounts): void
}

export function sessionAccountStore(store: SessionStore): AccountRecordStore {
  return {
    load: () => {
      let raw: string | null
      try {
        raw = store.read(SESSION_KEYS.accounts)
      } catch (e) {
        return { kind: 'unreadable', reason: `could not read the stored accounts: ${String(e)}` }
      }
      return parseStoredAccounts(raw)
    },

    //
    // ── A SAVE IS TWO WRITES, AND A CALLER MUST NEVER SEE ONE OF THEM ────────────────────
    //
    // The record and the `passbook.account-key` mirror have to agree: the mirror is what an older
    // build boots into, and the record is what this one boots into. Written naively — record, then
    // mirror — a failure on the second write throws out of `save`, the caller catches it and
    // reports "could not switch", and the record has ALREADY committed the new active account. The
    // session then shows A, the toast says nothing happened, and the next reload opens B.
    //
    // That is not exotic. The record write is the one that just grew storage, so a quota failure
    // landing on the mirror rather than on the record is the LIKELY ordering, not the unlucky one.
    //
    // So both previous values are read first and put back if either write fails. localStorage has
    // no transaction, and this is not one — a rollback write can fail too. What it buys is that
    // the failure is reported against a store that still holds what it held before, instead of one
    // that has silently half-moved; and the restore is attempted for both keys independently, so
    // one failing does not skip the other.
    //
    save: (record) => {
      // Serialize FIRST. A refusal must happen before anything moves, or a rejected record leaves
      // `passbook.account-key` pointing at an account the list does not contain.
      const text = serializeAccounts(record)
      const active = activeAccount(record)

      let previousRecord: string | null = null
      let previousMirror: string | null = null
      try {
        previousRecord = store.read(SESSION_KEYS.accounts)
        previousMirror = store.read(SESSION_KEYS.accountKey)
      } catch (e) {
        // A store that cannot be read cannot be rolled back either, so this refuses BEFORE writing
        // rather than proceeding without a way to undo.
        throw new Error(`refusing to save accounts into a store that cannot be read back: ${String(e)}`)
      }

      try {
        store.write(SESSION_KEYS.accounts, text)
        // THE MIRROR. See the header: the single-key slot keeps holding the active account's key,
        // so a build that never heard of this record still boots into the same identity.
        if (active) store.write(SESSION_KEYS.accountKey, active.accountKey)
      } catch (e) {
        restore(store, SESSION_KEYS.accounts, previousRecord)
        restore(store, SESSION_KEYS.accountKey, previousMirror)
        throw e
      }
    },
  }
}

/**
 * Puts one key back the way it was, or removes it if it was not there. Best effort, and silent.
 *
 * It swallows, because it runs inside a `catch` on the way to rethrowing the ORIGINAL failure —
 * and that failure is the one the caller needs to see. A rollback that threw would replace "the
 * write failed" with "the rollback failed", losing the only sentence that says what went wrong.
 */
function restore(store: SessionStore, key: SessionKey, previous: string | null): void {
  try {
    if (previous === null) store.remove(key)
    else store.write(key, previous)
  } catch {
    // Nothing further to try: the store that just refused a write will refuse this one too.
  }
}
