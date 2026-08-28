// Boot: read what this browser already holds and publish the first real session state.
//
// Never creates a key. `fresh` means "no key yet" and stays that way until `createAccount` runs —
// an account minted silently on first load is one the user never chose to back up.
import type { SessionLock } from '@strk20/protocol/session-lock'

import { BOOTING, getSessionSnapshot, patchSession, publishSession, setBootTrigger } from './store'
import { addressFor, isLeader, loadTier, publishFromRecord, setLeader, type Tier } from './tier'

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
      isLeader: isLeader(),
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
  publishSession({ ...BOOTING, status: 'fresh', isLeader: isLeader() })
}

function startLeaderLock(): void {
  if (lock || typeof BroadcastChannel === 'undefined') return
  void loadTier().then((t) => {
    lock = t.protocol.createSessionLock()
    // The lock has no subscribe; it heartbeats every second, so a poll at that cadence is exact enough.
    const tick = () => {
      const next = lock?.isLeader() ?? false
      if (next !== isLeader()) {
        setLeader(next)
        if (getSessionSnapshot().status !== 'booting') patchSession({ isLeader: next })
      }
    }
    tick()
    const timer = setInterval(tick, 1000)
    window.addEventListener('pagehide', () => {
      clearInterval(timer)
      lock?.close()
      lock = null
    })
  })
}

/** Idempotent. Runs on the first `useSession` subscriber; a failed boot is retried by the next call. */
export function ensureBooted(): Promise<void> {
  if (booting) return booting
  startLeaderLock()
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
