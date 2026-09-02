// Boot: read what this browser already holds and publish the first real session state.
//
// Never creates a key. `fresh` means "no key yet" and stays that way until `createAccount` runs —
// an account minted silently on first load is one the user never chose to back up.
import type { SessionLock } from '@strk20/protocol/session-lock'

import { BOOTING, publishSession, setBootTrigger } from './store'
import { addressFor, loadTier, protectionOf, publishFromRecord, type Tier } from './tier'

let booting: Promise<void> | null = null
let lock: SessionLock | null = null

/** Storage that cannot be read must not be written over. Returns the store's own refusal. */
function storageIsBroken(t: Tier): string | null {
  try {
    t.store.read(t.protocol.SESSION_KEYS.accountKey)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function accountListCorrupt(reason: string): string {
  return (
    `The list of accounts saved in this browser could not be read, so nothing was changed: ${reason}. ` +
    'No key has been overwritten, and this app will not replace a list it cannot read — doing so would ' +
    'drop the accounts inside it.'
  )
}

async function bootOnce(): Promise<void> {
  const t = await loadTier()

  const broken = storageIsBroken(t)
  if (broken) {
    publishSession({ ...BOOTING, status: 'no-storage', reason: broken })
    return
  }

  const sealed = t.vaults.load()
  if (sealed.kind === 'damaged') {
    publishSession({
      ...BOOTING,
      status: 'locked',
      hasVault: true,
      // Nothing can be read, so nothing is guessed about what seals it.
      protection: null,
      reason:
        `The locked wallet saved in this browser could not be read: ${sealed.reason}. ` +
        'Nothing has been overwritten. Your Recovery File still opens this account.',
    })
    return
  }
  if (sealed.kind === 'present') {
    // Straight off the public header — the one part a sealed vault shows without the password.
    const header = sealed.vault.header
    const active = header.accounts.find((a) => a.address === header.active) ?? header.accounts[0]
    publishSession({
      status: 'locked',
      address: active?.address,
      label: active?.label ?? null,
      accounts: [...header.accounts]
        .sort((a, b) => a.addedAt - b.addedAt)
        .map((a) => ({ address: a.address, label: a.label })),
      hasVault: true,
      protection: protectionOf(sealed.vault),
    })
    return
  }

  const read = t.accounts.load()
  if (read.kind === 'unreadable') {
    publishSession({ ...BOOTING, status: 'no-storage', reason: accountListCorrupt(read.reason) })
    return
  }
  if (read.kind === 'present') {
    publishFromRecord(t, read.record)
    return
  }

  // No account list. A key already in the single-key slot (a browser that predates the list) is
  // adopted; an empty slot is `fresh` — nothing is minted here.
  const stored = t.store.read(t.protocol.SESSION_KEYS.accountKey)
  if (t.identity.isStarkPrivateKey(stored)) {
    const record = t.protocol.seedFrom(stored, addressFor(t, stored), Date.now())
    t.accounts.save(record)
    publishFromRecord(t, record)
    return
  }
  publishSession({ ...BOOTING, status: 'fresh' })
}

/**
 * Opens the cross-tab submit lock. It holds nothing until a submission asks for it, so there is no
 * leadership to poll and no role for a tab to be stuck in — the old 1 s heartbeat existed only to
 * publish a role that never changed after boot.
 *
 * ── NOTHING IS TORN DOWN ON `pagehide`, AND THAT IS THE FIX ───────────────────────────────
 *
 * There used to be a `pagehide` handler here that closed the lock and set it to `null`. `pagehide`
 * is not unload: it fires when a page enters the back/forward cache and when a mobile browser
 * backgrounds a tab. On restore the lock was gone and `openSubmitLock` is only reachable through
 * `ensureBooted`, so every later submission was refused with "the session has not finished
 * opening" — permanently, in a tab that looked perfectly healthy.
 *
 * There is nothing to clean up anyway. A Web Lock is released when its holder's promise settles,
 * and the browser frees every lock a page holds when the page is actually destroyed.
 */
function openSubmitLock(): void {
  if (lock) return
  void loadTier().then((t) => {
    lock = t.protocol.createSessionLock()
  })
}

/** Idempotent. Runs on the first `useSession` subscriber; a failed boot is retried by the next call. */
export function ensureBooted(): Promise<void> {
  if (booting) return booting
  openSubmitLock()
  booting = bootOnce().catch((e) => {
    booting = null
    publishSession({
      ...BOOTING,
      status: 'no-storage',
      reason: `This browser could not open an account: ${e instanceof Error ? e.message : String(e)}`,
    })
  })
  return booting
}

/** The cross-tab lock, for `deps.acquireSubmitLock` on register/send. `null` before boot. */
export function getSessionLock(): SessionLock | null {
  return lock
}

setBootTrigger(() => {
  void ensureBooted()
})
