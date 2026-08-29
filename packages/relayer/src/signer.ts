// The funded key, and the reads that judge whether it can pay. Nothing here is browser-reachable.
import { Account, RpcProvider } from 'starknet'
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

export interface Signer {
  nodeUrl: string
  provider: RpcProvider
  /** The ONE account that signs every outbound transaction this process makes. */
  account: Account
  address: string
}

export async function openSigner(address: string, privateKey: string): Promise<Signer> {
  const nodeUrl = await pickLiveRpcHost()
  const provider = new RpcProvider({ nodeUrl })
  const account = new Account({ provider, address, signer: privateKey })
  return { nodeUrl, provider, account, address }
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
  account: Account,
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
      const { transaction_hash } = await account.execute([
        { contractAddress: governance, entrypoint: 'publish_tally', calldata },
      ])
      return transaction_hash
    },
    async submitKey(proposalId, secret) {
      const { transaction_hash } = await account.execute([
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
