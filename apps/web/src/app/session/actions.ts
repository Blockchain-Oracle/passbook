// Account lifecycle: create, import, switch, label, forget. Every action throws a whole sentence
// on refusal so `useMutation` surfaces it; nothing here swallows a failure.
import { IMPORT_NO_KEY } from '@strk20/protocol/account-copy'
import type { StoredAccounts } from '@strk20/protocol/session-accounts'

import { ensureBooted } from './boot'
import { BOOTING, getSessionSnapshot, patchSession, publishSession } from './store'
import { addressFor, getOpenVault, isLeader, loadRecord, loadTier, persist, publishFromRecord, setOpenVault, summarize, type Tier } from './tier'

const NO_RECORD = 'There is no account list in this browser to switch inside.'
const NOT_HELD = 'This browser does not hold that account.'
const LOCKED = 'Unlock this wallet before changing its accounts.'

async function ready(): Promise<Tier> {
  await ensureBooted()
  return loadTier()
}

function requireRecord(t: Tier): StoredAccounts {
  if (t.vaults.load().kind === 'present' && !getOpenVault()) throw new Error(LOCKED)
  const record = loadRecord(t)
  if (!record) throw new Error(NO_RECORD)
  return record
}

/** Adds a key to this browser — seeding the list when there is none — and makes it active. */
async function adopt(t: Tier, accountKey: string): Promise<void> {
  if (!t.identity.isStarkPrivateKey(accountKey)) throw new Error(IMPORT_NO_KEY)
  const address = addressFor(t, accountKey)
  const now = Date.now()

  if (t.vaults.load().kind === 'present' && !getOpenVault()) throw new Error(LOCKED)
  const existing = loadRecord(t)
  if (!existing) {
    const record = t.protocol.seedFrom(accountKey, address, now)
    t.accounts.save(record)
    publishFromRecord(t, record)
    return
  }
  // Already here: switch rather than add twice.
  const held = t.protocol.findAccount(existing, address)
  const next = held
    ? t.protocol.withActive(existing, address)
    : t.protocol.withActive(t.protocol.withAccount(existing, { address, accountKey, label: null, addedAt: now }), address)
  await persist(t, t.protocol.withLocked(next, false))
  publishFromRecord(t, t.protocol.withLocked(next, false))
}

/** A fresh browser gets its first key; a browser with accounts gets one more. Never silent. */
export async function createAccount(): Promise<void> {
  const t = await ready()
  if (getSessionSnapshot().status === 'no-storage') {
    throw new Error(getSessionSnapshot().reason ?? t.protocol.SESSION_STORAGE_UNAVAILABLE)
  }
  if (!loadRecord(t) && t.vaults.load().kind !== 'present') {
    // First key: `loadOrCreateAccountKey` adopts a stray single-slot key or mints one — create on demand.
    const key = t.protocol.loadOrCreateAccountKey(t.store)
    if (!key.ok) throw new Error(key.reason)
    await adopt(t, key.accountKey)
    return
  }
  const generated = t.identity.generateIdentity().privateKey
  if (!t.identity.isStarkPrivateKey(generated)) {
    throw new Error('The key generator returned something that is not a Stark private key.')
  }
  await adopt(t, generated)
}

/** Imports a raw account key (the recovery file has already been opened by `backup.ts`). */
export async function importAccount(accountKey: string): Promise<void> {
  const t = await ready()
  await adopt(t, accountKey)
}

export async function switchAccount(address: string): Promise<void> {
  const t = await ready()
  const record = requireRecord(t)
  if (!t.protocol.findAccount(record, address)) throw new Error(NOT_HELD)
  const next = t.protocol.withActive(record, address)
  await persist(t, next)
  publishFromRecord(t, next)
}

/** Optimistic: the label shows at once; the write follows. A failed write is reported to the console. */
export function setLabel(address: string, label: string | null): void {
  const trimmed = label?.trim() || null
  const current = getSessionSnapshot()
  patchSession({
    label: current.address && sameHex(current.address, address) ? trimmed : current.label,
    accounts: current.accounts.map((a) => (sameHex(a.address, address) ? { ...a, label: trimmed } : a)),
  })
  void ready().then(async (t) => {
    const record = requireRecord(t)
    const next = t.protocol.withLabel(record, address, trimmed)
    await persist(t, next)
    // Re-derive from the record so a concurrent write cannot leave the snapshot stale.
    patchSession({ accounts: summarize(next), label: t.protocol.activeAccount(next)?.label ?? null })
  }).catch((e: unknown) => {
    console.error('label not saved', e)
  })
}

function sameHex(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return a === b
  }
}

/**
 * Wipes every session key from this browser: accounts, the single-key slot, the vault, the backup
 * ceremony and cadence, and bearer position secrets. Irreversible — the caller confirms first.
 */
export function forget(): void {
  void ready().then((t) => {
    setOpenVault(null)
    for (const key of Object.values(t.protocol.SESSION_KEYS)) {
      try {
        t.store.remove(key)
      } catch {
        // A key that cannot be removed cannot be read either; the store already refused above.
      }
    }
    publishSession({ ...BOOTING, status: 'fresh', isLeader: isLeader() })
  })
}
