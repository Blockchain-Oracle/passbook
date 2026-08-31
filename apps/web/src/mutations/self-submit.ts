import { NET } from '@strk20/protocol/constants'
import type { SubmitResponseBody } from '@strk20/protocol/relayer-wire'

import { getSessionLock } from '@/app/session'

// Signing and broadcasting from the embedded key. Everything here loads `starknet` on the call.

/**
 * `deps.acquireSubmitLock` for send and register: only the leader tab may spend. A follower tab
 * gets the `lock-unavailable` refusal instead of a second pipeline over the same notes.
 */
export function acquireSubmitLock(): Promise<() => void> {
  const lock = getSessionLock()
  if (!lock) return Promise.reject(new Error('The session has not finished opening, so nothing can be signed yet.'))
  return lock.acquire()
}

export interface SubmitDetails {
  proofFacts: string[]
  proof: string
  /** Ceilings, not charges. Present means `execute` skips the estimate — which cannot see the proof. */
  resourceBounds?: unknown
}

export interface SubmitCall {
  contractAddress: string
  entrypoint: string
  /** Handed to `account.execute`, which owns the serialisation — so the honest type is "whatever it accepts". */
  calldata?: unknown
}

/** `{ address, signer }` — what the protocol pipelines take as `account`. */
export async function embeddedAccount(accountKey: string, address: string) {
  const { Account, RpcProvider } = await import('starknet')
  const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
  return { provider, account: new Account({ provider, address, signer: accountKey }) }
}

/**
 * The executor `sendShielded` / `shieldPublic` ask for. The proof pair rides as v3 transaction
 * DETAILS, not calldata — the sequencer takes both or neither and never echoes them on a receipt.
 */
export function makeSelfSubmit(accountKey: string, address: string) {
  return async (calls: SubmitCall[], details: SubmitDetails): Promise<string> => {
    const { account } = await embeddedAccount(accountKey, address)
    const { transaction_hash } = await account.execute(calls as never, details as never)
    return transaction_hash
  }
}

/**
 * A `submit` for `registerSponsored` that signs here instead of posting to the relayer. The seam
 * is `(url, body)`; the url is ignored and the browser signs. A thrown execute cannot say whether
 * the broadcast left, so it reports 502 without claiming the request never landed.
 */
export function makeSelfSubmitRegistration(accountKey: string, address: string) {
  const sign = makeSelfSubmit(accountKey, address)
  return async (
    _url: string,
    body: { calls: unknown[]; proofFacts?: string[]; proof?: string; resourceBounds?: unknown },
  ): Promise<{ status: number; body: SubmitResponseBody }> => {
    if (!body.proofFacts?.length || !body.proof) {
      return { status: 400, body: { error: 'refusing to submit without both the proof facts and the proof blob' } }
    }
    try {
      // The bounds ride through, or this path estimates — and an estimate reverts on a proven
      // batch that moves value. Self-pay registration folds no starter, but the pool fee is value.
      const transactionHash = await sign(body.calls as SubmitCall[], {
        proofFacts: body.proofFacts,
        proof: body.proof,
        ...(body.resourceBounds === undefined ? {} : { resourceBounds: body.resourceBounds }),
      })
      return { status: 200, body: { transactionHash } }
    } catch (error) {
      return { status: 502, body: { error: error instanceof Error ? error.message : 'the browser could not sign this' } }
    }
  }
}

/** A stable id for a pipeline row. */
export function operationId(prefix = 'strk20'): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `${prefix}-${Date.now()}-${suffix}`
}

export function currentRoute(): string {
  return typeof location === 'undefined' ? '/wallet' : location.pathname
}
