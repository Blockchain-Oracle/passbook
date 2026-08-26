//
// The record the feed reads (story 6.6).
//
// ── `initialized` IS THE WHOLE POINT OF THIS FILE ─────────────────────────────────────────
//
// A store that held only `transactions` would make "we have not read the pool" and "the pool has
// nothing" the same value, and EXPERIENCE §5's cross-state rules exist because those are the same
// picture and opposite facts. A user shown "no activity yet" during an outage has been told their
// history is gone. So the flag is the state, and the empty array is only ever the second half of
// an answer the flag gives first.
//
// ── WHY IT LIVES HERE AND NOT UNDER `apps/web` ───────────────────────────────────────────
//
// It started in `apps/web/src/shell/`, beside `pipeline-store.ts`. `vitest.config.ts:12` collects
// `packages/*/test/**` only, so a store under the app is a store no test can execute — and the
// invariant above is exactly the kind that gets inverted in one word. Changing `initialized: false`
// to `true` makes `/wallet` claim an unread pool is empty, and nothing anywhere would have failed.
//
// The precedent is already here: `session-store.ts`, `session-invite-store.ts` and
// `session-cadence-store.ts` are all stores in this package. This one has no DOM edge either — it
// is a set of listeners and a value.
//
// ── IT IS EMPTY TODAY, AND THAT IS THE HONEST STATE ───────────────────────────────────────
//
// Nothing in epic 6 reads a chain. `buildActivity` needs pool events, and reading them from the
// browser means importing `pool-events.ts`, which reaches `starknet`, which 6.5 measured at
// 655,436 B against a 560,000 B budget. So the wiring lands with the Wallet epic's discovery story,
// and it is one call to `publishRead`. Seeding this with plausible rows so the feed looks alive is
// the fixture-as-truth the anti-demo gate exists to stop.
//
import type { Transaction } from './transaction.js'

export interface ActivityState {
  transactions: readonly Transaction[]
  /** False until a read has completed. Never assume; never default to true. */
  initialized: boolean
}

type Listener = () => void

const listeners = new Set<Listener>()

// ONE OBJECT IDENTITY PER STATE. `useSyncExternalStore` compares snapshots by reference and loops
// forever if `getSnapshot` mints a new object per call — so every mutation replaces this whole
// value and reads hand back exactly what is here. The frozen empty array is part of that: a fresh
// `[]` on each read is a new identity for an unchanged fact.
const EMPTY: readonly Transaction[] = Object.freeze([])

const UNREAD: ActivityState = { transactions: EMPTY, initialized: false }

let state: ActivityState = UNREAD

function emit() {
  for (const listener of listeners) listener()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getActivity(): ActivityState {
  return state
}

/**
 * Publishes a completed read, keeping anything of ours the read could not know about.
 *
 * ── A ROW WE SUBMITTED MUST NOT VANISH BECAUSE A READ CAME BACK ──────────────────────────
 *
 * §11 checklist 9: an optimistic row that has not been indexed becomes "Submitted, not yet
 * indexed" and NEVER disappears. A plain assignment breaks that on the first poll — the read
 * returns what the chain published, which by definition excludes the transaction the chain has not
 * published yet, and the row the user is watching is gone. So the read replaces the settled rows
 * and unsettled ones survive it.
 *
 * Superseding is by TRANSACTION HASH, not by id: a settled row's id is `<hash>-<ordinal>` and an
 * optimistic row's id is whatever minted it, so they never match. The hash is the only thing the
 * two halves genuinely share, and it is only known once the relayer has answered — an optimistic
 * row with no hash yet cannot be superseded, which is correct, because nothing in the read can be
 * shown to be it.
 *
 * `initialized` goes true HERE and nowhere else, which keeps the flag meaning "a read finished"
 * rather than "someone touched the store". A read that FAILED must not call this: it has no rows
 * to publish, and saying it does is the conflation the flag exists to prevent.
 */
export function publishRead(read: readonly Transaction[]): void {
  const settledHashes = new Set(
    read.map((tx) => (tx.chain.state === 'settled' ? tx.chain.entry.transactionHash : null)).filter(Boolean),
  )
  const survivors = state.transactions.filter(
    (tx) =>
      tx.chain.state !== 'settled' &&
      !(tx.chain.state === 'optimistic' && tx.chain.transactionHash !== null && settledHashes.has(tx.chain.transactionHash)),
  )
  state = { transactions: [...survivors, ...read], initialized: true }
  emit()
}

/**
 * Records something this browser just did — an optimistic row, or a failure.
 *
 * Separate door from `publishRead` because it means the opposite thing: `publishRead` says the
 * chain was consulted, this says we acted. It leaves `initialized` alone for that reason — a
 * submission is not a read, and letting it flip the flag would make one send turn "we have not
 * looked" into "the pool holds one thing", which is the lie the flag exists to prevent.
 */
export function recordLocal(transaction: Transaction): void {
  const without = state.transactions.filter((tx) => tx.id !== transaction.id)
  state = { ...state, transactions: [...without, transaction] }
  emit()
}

/**
 * Test seam. Production code never needs this; a suite that leaked state into the next case does.
 *
 * It clears the listener set, which is why it is a seam and not a runtime reset: under mounted
 * components that leaves every subscriber registered-but-forgotten, and their unsubscribe closures
 * become no-ops against a set they are no longer in. `resetPipelineStore` carries the same warning
 * for the same reason.
 */
export function resetActivityStore(): void {
  state = UNREAD
  listeners.clear()
}
