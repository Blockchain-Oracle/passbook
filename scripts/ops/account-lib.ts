//
// The three account-plumbing pieces the session scripts share.
//
// A MODULE, not a script: importing this runs nothing, which is the whole reason it
// exists. `OZ_ACCOUNT_CLASS_HASH` used to live in scripts/deploy-account.ts, whose
// top-level code executes on import — so every script that needed the constant either
// re-declared it (two copies of a value that must never drift from the funded
// keypairs) or triggered a deployment dry-run by importing it. It lives here now and
// deploy-account.ts imports it back.
//
import { RpcProvider } from 'starknet'
import { NET, STRK_TOKEN } from '../../packages/protocol/src/constants.js'
import { withFallback } from '../../packages/protocol/src/rpc.js'

/**
 * The OpenZeppelin account class, declared on SN_MAIN. Both keypairs in `.env` were
 * generated against it, so it is not interchangeable with another account class: change
 * it and the derived address stops matching the funded one. The counterfactual
 * convention everywhere in this repository is `calculateContractAddressFromHash(
 * publicKey, OZ_ACCOUNT_CLASS_HASH, [publicKey], 0)` — salt and constructor calldata
 * are both the public key, deployer address zero for a self-deploying account.
 */
export const OZ_ACCOUNT_CLASS_HASH =
  '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f'

/** Only hosts serving a spec version starknet@10.5.0 supports may be broadcast to. */
const SUPPORTED_SPEC = new Set(['0.9.0', '0.10.0', '0.10.2', '0.10.3'])

/**
 * The first configured RPC host whose spec version this starknet.js can broadcast to.
 *
 * Throws, naming every host and what it answered, when none qualifies — the callers are
 * scripts about to SIGN against the returned host, and a host picked without the spec
 * check is how a broadcast fails after the interesting pre-checks all passed.
 */
export async function pickBroadcastHost(): Promise<string> {
  const seen: string[] = []
  for (const nodeUrl of NET.rpc) {
    try {
      const spec = await new RpcProvider({ nodeUrl }).getSpecVersion()
      seen.push(`${nodeUrl} -> ${spec}`)
      if (SUPPORTED_SPEC.has(spec)) return nodeUrl
    } catch {
      seen.push(`${nodeUrl} -> unreachable`)
    }
  }
  throw new Error(`no RPC host serves a supported spec version. Saw: ${seen.join(', ')}`)
}

/** `STRK.balanceOf(owner)` as one bigint, folding the u256 low/high felts. */
export async function strkBalance(owner: string): Promise<bigint> {
  const r = await withFallback((p) =>
    p.callContract({ contractAddress: STRK_TOKEN, entrypoint: 'balanceOf', calldata: [owner] }),
  )
  return BigInt(r[0]!) + (BigInt(r[1] ?? '0x0') << 128n)
}
