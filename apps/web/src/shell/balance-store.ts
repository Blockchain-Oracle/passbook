//
// The last reading of the shielded balance, published once and read from anywhere.
//
// ── WHY THIS EXISTS AND WHAT IT IS NOT ───────────────────────────────────────────────────
//
// `useBalance` walks the pool. The walk is a bounded sweep over pool storage — expensive enough
// that its own header says it is deliberately not polled — so the account drawer, which wants one
// line of balance, must not be a second caller. It reads what the wallet surface already found.
//
// IT IS NOT A CACHE OF WHAT A USER HOLDS. `session.ts`'s storage boundary forbids persisting note
// plaintext or decrypted amounts, and this obeys that by construction: it is module memory, it
// never touches a storage API, and a reload starts empty. The only thing it saves is a duplicate
// network walk within one page load.
//
// ── KEYED BY ADDRESS, AND THAT IS THE WHOLE CORRECTNESS ARGUMENT ─────────────────────────
//
// An account switch changes which balance is being talked about. An unkeyed singleton would leave
// the previous account's number on screen under the new account's disc — a wallet showing someone
// else's money, produced by a cache that looked harmless. So a reading carries the address it was
// taken for, and a reader asking about a different address gets `null` rather than a stale number.
//
import { useSyncExternalStore } from 'react'
import type { ShieldedBalance } from '@strk20/protocol/balances'

export interface BalanceReading {
  address: string
  balance: ShieldedBalance
}

let reading: BalanceReading | null = null
const listeners = new Set<() => void>()

export function publishBalance(address: string, balance: ShieldedBalance): void {
  reading = { address, balance }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => reading

/**
 * The last reading for `address`, or `null`.
 *
 * `null` covers "no walk has completed" and "the last walk was for a different account", which
 * render the same way — as an absence — and must never render as a zero.
 */
export function usePublishedBalance(address: string | null): ShieldedBalance | null {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (!current || !address) return null
  return current.address === address ? current.balance : null
}
