//
// THE PUBLIC BALANCE — what the account holds ON CHAIN, in the open, before anything is shielded.
//
// ── WHY THIS FILE EXISTS, AND WHY ITS ABSENCE WAS THE APP'S LOUDEST BUG ───────────────────
//
// Passbook has always shown ONE number: the shielded balance, discovered by walking the pool for
// notes this account can decrypt (`use-balance.ts`). That is the product's whole point, and it is
// also why "the money arrived and the balance still shows nothing" was true and unfixable by any
// amount of refreshing:
//
//   - the faucet drips PUBLIC STRK to the account address;
//   - a friend sending USDC sends PUBLIC USDC to the account address;
//   - the wallet hero reads SHIELDED notes;
//   - and nothing in the app ever read the first two.
//
// So a funded account rendered as an empty one, `/swap` could not tell anybody what they held, and
// the only surface that read a public balance at all was `account-status.ts` — which reads STRK,
// alone, because all it needed to answer was "can this address pay to deploy itself".
//
// This is that read, generalised to every token the app knows about.
//
// ── IT IS THE SAME MECHANISM, DELIBERATELY ────────────────────────────────────────────────
//
// Plain JSON-RPC `starknet_call` against each token's `balanceOf`, no SDK — `account-status.ts`'s
// reasoning applies unchanged and is worth restating: this must answer before the crypto graph has
// finished loading, because a wallet that cannot say what it holds until a 300 kB chunk arrives is
// a wallet that looks broken for the first second of every visit.
//
// ── UNKNOWN IS NOT ZERO, AND THAT DISTINCTION IS THE WHOLE HONESTY RULE ───────────────────
//
// A token whose read failed carries `null`, never `0n`. They render differently and they must:
// zero is a fact about an account, and null is a fact about a network. Telling somebody they hold
// nothing because an RPC host was down is the single most alarming lie this surface can tell.
//
import { NET } from '@strk20/protocol/constants'

/** `balanceOf(address)` — precomputed, per `crowd-rpc.ts`'s reason for pinning a selector. */
const BALANCE_OF = '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e'

export interface PublicBalance {
  /** The token's contract address, as given. */
  token: string
  /** Wei held at the account. `null` when the read failed — NEVER conflated with zero. */
  wei: bigint | null
}

async function rpc(method: string, params: unknown): Promise<unknown> {
  let last: unknown
  for (const nodeUrl of NET.rpc) {
    try {
      const response = await fetch(nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      if (!response.ok) throw new Error(`${nodeUrl} answered ${response.status}`)
      const body = (await response.json()) as { result?: unknown; error?: unknown }
      if (body.error) return null
      return body.result
    } catch (error) {
      last = error
    }
  }
  throw new Error(`all RPC hosts failed: ${String(last)}`)
}

/**
 * Read `balanceOf` for one token. Never throws — a failure is `null`.
 *
 * `balanceOf` returns a u256 as `[low, high]`. Reading only the low half is correct for every
 * amount below 2^128 and wrong in a way nobody would ever see, so both halves are folded in —
 * the same care `account-status.ts` takes, for the same reason.
 */
async function readOne(token: string, address: string): Promise<PublicBalance> {
  try {
    const raw = await rpc('starknet_call', [
      { contract_address: token, entry_point_selector: BALANCE_OF, calldata: [address] },
      'latest',
    ])
    if (!Array.isArray(raw) || typeof raw[0] !== 'string') return { token, wei: null }
    const low = BigInt(raw[0])
    const high = typeof raw[1] === 'string' ? BigInt(raw[1]) : 0n
    return { token, wei: (high << 128n) + low }
  } catch {
    return { token, wei: null }
  }
}

/**
 * Every public token balance for one address.
 *
 * NEVER THROWS and never partially fails: one unreachable token yields `null` for that token and
 * real numbers for the rest. A single rejected promise taking out the whole hero — which is what
 * `Promise.all` over throwing reads would do — is how one dead token contract makes a healthy
 * account look empty.
 *
 * Reads run CONCURRENTLY. Serially, a six-token list is six round trips deep on the critical path
 * of first paint; `account-status.ts` already batches its three the same way.
 */
export async function readPublicBalances(
  tokens: readonly string[],
  address: string,
): Promise<PublicBalance[]> {
  return Promise.all(tokens.map((token) => readOne(token, address)))
}
