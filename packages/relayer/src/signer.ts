// The funded key, and the reads that judge whether it can pay. Nothing here is browser-reachable.
import { Account, BlockTag, RpcProvider, type Call } from 'starknet'
import { STRK_TOKEN } from '../../protocol/src/constants.js'
import { withFallback } from '../../protocol/src/rpc.js'
import type { TellerDeps } from './teller.js'

/**
 * The first RPC host that answers a READ. Probing before any key is used means no
 * double-broadcast risk; the write path deliberately never retries across hosts.
 */
export async function pickLiveRpcHost(): Promise<string> {
  return withFallback(async (p) => {
    await p.getBlockNumber()
    return p.channel.nodeUrl
  })
}

/** What every writer here calls instead of `account.execute` — one queue, one nonce sequence. */
export type SerialExecute = (
  calls: Call[],
  details?: Record<string, unknown>,
) => Promise<{ transaction_hash: string }>

/**
 * How far ahead of the chain's own nonce this process will run before it stops trusting itself.
 *
 * The look-ahead exists because a broadcast transaction is not yet in an accepted block, so the
 * chain's nonce lags what we have legitimately issued. The CAP exists because that reasoning fails
 * in one direction: a transaction that broadcast and was then dropped by the sequencer consumed no
 * nonce, and without a cap this counter would sit one step ahead of reality forever and every
 * subsequent submission would be rejected. Eight is a queue depth we will never legitimately reach
 * — proven submissions take seconds each — so hitting it means the counter is wrong, not busy.
 */
const MAX_NONCE_LOOKAHEAD = 8n

/**
 * Serialises everything this key signs, and issues the nonce inside the queue.
 *
 * ── ORDERING ALONE DOES NOT FIX THIS, WHICH IS THE WHOLE REASON THE NONCE IS HERE ─────────
 *
 * starknet.js reads the nonce at `BlockTag.LATEST` (its channel default). A transaction we
 * broadcast a second ago is in the pending block and NOT in an accepted one, so `LATEST` hands the
 * next caller the nonce we just used. Queuing the calls without issuing the nonce would therefore
 * produce the same collision, just in a tidier order. `PRE_CONFIRMED` is the tag that counts
 * pending work, and the local counter covers the window where even that has not caught up.
 *
 * `lastIssued` advances ONLY after a broadcast resolves. A submission that throws consumed no
 * nonce, so the next one through the queue reuses the number rather than leaving a gap — and a gap
 * is not a lost transaction, it is a stalled account, because Starknet will not execute nonce n+1
 * until n lands.
 */
export function serialExecute(account: Account): SerialExecute {
  let tail: Promise<unknown> = Promise.resolve()
  let lastIssued: bigint | null = null

  const run = async (calls: Call[], details?: Record<string, unknown>) => {
    const chain = BigInt(await account.getNonce(BlockTag.PRE_CONFIRMED))
    const ahead = lastIssued !== null && lastIssued >= chain
    if (ahead && lastIssued! - chain >= MAX_NONCE_LOOKAHEAD) {
      // Self-heal rather than wedge: the chain is the authority and we have drifted off it.
      console.warn(`relayer: nonce counter ${lastIssued} is ${lastIssued! - chain} ahead of chain ${chain}; resyncing`)
      lastIssued = null
    }
    const nonce = lastIssued !== null && lastIssued >= chain ? lastIssued + 1n : chain
    const result = await account.execute(calls, { ...details, nonce })
    lastIssued = nonce
    return result
  }

  return (calls, details) => {
    // `.then(f, f)`: a failed predecessor must not stop the queue, only free it.
    const next = tail.then(() => run(calls, details), () => run(calls, details))
    tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
}

export interface Signer {
  nodeUrl: string
  provider: RpcProvider
  /** The ONE account that signs every outbound transaction this process makes. */
  account: Account
  /**
   * The ONLY way anything here should sign. `account.execute` is still reachable and must not be
   * called directly: four writers share this key — user submissions, both Teller writes and the
   * settlement keeper — and any one of them bypassing the queue reintroduces the collision for
   * everybody, intermittently and under load, which is when it is hardest to recognise.
   */
  execute: SerialExecute
  address: string
}

export async function openSigner(address: string, privateKey: string): Promise<Signer> {
  const nodeUrl = await pickLiveRpcHost()
  const provider = new RpcProvider({ nodeUrl })
  const account = new Account({ provider, address, signer: privateKey })
  return { nodeUrl, provider, account, address, execute: serialExecute(account) }
}

/** A Cairo u256 from its two felts, low limb first. Exported because only >2^128 exposes a bug. */
export function u256FromFelts(low: string, high: string): bigint {
  return BigInt(low) + (BigInt(high) << 128n)
}

/** The relayer wallet's STRK balance — the funds every fee it signs is actually paid from. */
export async function readStrkBalance(owner: string): Promise<bigint> {
  const [low, high] = await withFallback((p) =>
    p.callContract({ contractAddress: STRK_TOKEN, entrypoint: 'balanceOf', calldata: [owner] }),
  )
  return u256FromFelts(low!, high!)
}

const hex = (n: number | bigint) => `0x${n.toString(16)}`

/**
 * The Teller's two writes, signed by this account directly — never through `/submit`.
 * `publish_key` is refused by the allowlist by name; this is the one path reserved for it.
 */
export function tellerSubmitters(
  execute: SerialExecute,
  governance: string,
): Pick<TellerDeps, 'submitTally' | 'submitKey'> {
  return {
    async submitTally(proposalId, sums, blindSums, excluded) {
      const calldata = [
        hex(proposalId),
        hex(sums.length),
        ...sums.map(hex),
        hex(blindSums.length),
        ...blindSums.map(hex),
        hex(excluded.length),
        ...excluded,
      ]
      const { transaction_hash } = await execute([
        { contractAddress: governance, entrypoint: 'publish_tally', calldata },
      ])
      return transaction_hash
    },
    async submitKey(proposalId, secret) {
      const { transaction_hash } = await execute([
        { contractAddress: governance, entrypoint: 'publish_key', calldata: [hex(proposalId), hex(secret)] },
      ])
      return transaction_hash
    },
  }
}

// A page is fire-and-forget, so it gives up sooner than a request a user is watching.
const OPS_WEBHOOK_TIMEOUT_MS = 5_000

/** Pages go to the webhook when configured, and always to the log under a greppable prefix. */
export function makeOpsPager(
  webhook: string | undefined,
  fetchImpl: typeof fetch = globalThis.fetch,
): (message: string) => void {
  return (message) => {
    console.warn(`relayer: OPS ${message}`)
    if (!webhook) return
    void fetchImpl(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `relayer: ${message}` }),
      signal: AbortSignal.timeout(OPS_WEBHOOK_TIMEOUT_MS),
    })
      .then((r) => {
        // A rotated (404) or revoked (403) webhook RESOLVES; silence here would lose the page.
        if (!r.ok) console.warn(`relayer: ops webhook answered ${r.status}; page not delivered`)
      })
      .catch((e) => console.warn(`relayer: ops webhook failed: ${String(e)}`))
  }
}
