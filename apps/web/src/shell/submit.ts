//
// Signing and broadcasting from the browser's own key.
//
// ── THE SEAM THAT HAD NO IMPLEMENTATION ──────────────────────────────────────────────────
//
// `send.ts:1469` has shipped for weeks with this default:
//
//     'no self-submit executor was supplied, so nothing can sign from this wallet'
//
// The type was written, the branch was written, the failure path was written. Nothing anywhere in
// the repository ever supplied one, because until the account existed in the browser there was
// nothing to sign WITH. This is that function.
//
// ── WHY SELF-SUBMIT IS THE SIMPLER PATH, NOT THE FALLBACK ────────────────────────────────
//
// The relayer exists to sponsor a user who has no gas. When the user DOES have gas, going through
// it is strictly more moving parts: in self mode `planSend` sets `plan.fee` to `null`, so the
// reimbursement withdrawal disappears from the action list entirely. Fewer actions, no host to
// keep running, no allowlist to satisfy.
//
// What it costs is stated rather than hidden: the user's own account pays, and a reverting attempt
// has still been paid for. `send.ts` carries the sentence for that (`SELF_SUBMIT_GAS_LOSS`) and
// surfaces it on the failure.
//
// ── EVERYTHING HERE IS DYNAMICALLY IMPORTED ──────────────────────────────────────────────
//
// `starknet` is the crypto graph the build gate keeps out of first paint. Every function below
// loads it on the call, so a page that never submits never fetches it.
//
import { NET } from '@strk20/protocol/constants'
import { OZ_ACCOUNT_CLASS_HASH } from '@strk20/protocol/account-address'
// Static on purpose: both are runtime leaves already in the eager graph (faucet.ts / wallet.tsx
// import them statically), so a dynamic import here would split nothing and trip the build
// gate's INEFFECTIVE_DYNAMIC_IMPORT check.
import { RELAYER_PATHS, type SubmitResponseBody } from '@strk20/protocol/relayer-wire'
import { readAccountStatus } from './account-status'

/** What `send.ts` hands an executor: the assembled calls plus the V3 proof fields. */
export interface SubmitDetails {
  proofFacts: string[]
  proof: string
}

export interface SubmitCall {
  contractAddress: string
  entrypoint: string
  /**
   * DELIBERATELY `unknown`, not `unknown[]`.
   *
   * starknet.js types a `Call`'s calldata as `RawArgs | Calldata`, and `RawArgs` includes a plain
   * OBJECT — the named-arguments form its serialiser accepts. Narrowing to an array here would
   * make this type structurally incompatible with the `SelfSubmitExecutor` seam `send.ts`
   * declares, for a shape that is legal on the wire.
   *
   * Nothing in this file reads it. It is handed to `account.execute`, which owns the
   * serialisation, so the honest type is "whatever that accepts" rather than a guess at it.
   */
  calldata?: unknown
}

/**
 * Build the executor `sendShielded` asks for.
 *
 * THE PROOF PAIR IS PASSED AS TRANSACTION DETAILS, NOT CALLDATA, and that is the whole subtlety of
 * this function. `proof_facts` and `proof` are top-level fields on a v3 invoke; the sequencer takes
 * BOTH OR NEITHER, and it will not echo them back on a receipt — which is why an earlier attempt at
 * this concluded, from receipt sampling, that no proof was attached at all. It is write-only on the
 * wire. Dropping either half broadcasts a rejection.
 */
export function makeSelfSubmit(accountKey: string, address: string) {
  return async (calls: SubmitCall[], details: SubmitDetails): Promise<string> => {
    const { Account, RpcProvider } = await import('starknet')
    const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
    const account = new Account({ provider, address, signer: accountKey })

    const { transaction_hash } = await account.execute(calls as never, details as never)
    return transaction_hash
  }
}

/**
 * A `submit` for `registerSponsored` that signs from THIS browser instead of posting to a relayer.
 *
 * ── THE SEAM WAS ALREADY THE RIGHT SHAPE, WHICH IS WHY NOTHING IN register.ts CHANGES ────
 *
 * `RegisterDeps.submit` receives `(url, body)` where the body already carries the assembled calls,
 * the proof facts and the proof blob — everything a signer needs. It is described as the relayer
 * seam, and it is; but "post this somewhere that will sign it" and "sign it here" differ only in
 * who holds the key. So the url is ignored and the browser signs.
 *
 * That matters beyond convenience: `registerSponsored` is proven on mainnet, and modifying it to
 * add a self-submit branch would put new code in the one pipeline that has actually worked. This
 * adds none.
 *
 * ── IT REPORTS THE RELAYER'S SHAPE HONESTLY, INCLUDING THE DANGEROUS CASE ────────────────
 *
 * A 200 means "there is a transaction and here is its hash". If signing throws AFTER the broadcast
 * left — a timeout, a dropped socket — the transaction may exist and we do not know its hash, which
 * `RelayResponse` models as `bodyUnreadable` and calls "the single worst state to report as a clean
 * refusal". A thrown error from `account.execute` cannot distinguish the two, so this reports a
 * 502 WITHOUT claiming the request never landed, and the pipeline's own retry discipline applies.
 *
 * NOTE ON WHAT THIS COSTS. The relayer path is sponsored; this one is not. The user's own account
 * pays the pool fee and the gas, including on an attempt that reverts.
 */
export function makeSelfSubmitRegistration(accountKey: string, address: string) {
  const sign = makeSelfSubmit(accountKey, address)

  return async (
    _url: string,
    body: { calls: unknown[]; proofFacts?: string[]; proof?: string },
  ): Promise<{ status: number; body: SubmitResponseBody }> => {
    // BOTH OR NEITHER. The sequencer requires the pair on a v3 invoke and rejects a broadcast
    // carrying one without the other, so a missing half is refused here rather than paid for.
    if (!body.proofFacts?.length || !body.proof) {
      return {
        status: 400,
        body: { error: 'refusing to submit without both the proof facts and the proof blob' },
      }
    }

    try {
      const transactionHash = await sign(body.calls as SubmitCall[], {
        proofFacts: body.proofFacts,
        proof: body.proof,
      })
      return { status: 200, body: { transactionHash } }
    } catch (error) {
      return {
        status: 502,
        body: { error: error instanceof Error ? error.message : 'the browser could not sign this' },
      }
    }
  }
}

export type DeployResult =
  | { readonly ok: true; readonly transactionHash: string }
  | { readonly ok: false; readonly because: string }

/**
 * One ordinary invoke from the browser's account — no pool, no proof pair.
 *
 * `create_launch` is why this exists: `launch.cairo` keeps creation OUTSIDE `privacy_invoke` on
 * purpose ("the creator is a commitment, so sponsorship gives the relayer nothing to sweep"), so
 * it is a plain account call that moves no money. The caller's address IS on the transaction —
 * which the create surface says in words — and the creator's CLAIM stays a bearer secret.
 *
 * Waits for acceptance before reporting, because the surface's next poll must see the result.
 */
export async function invokeDirect(
  accountKey: string,
  address: string,
  call: SubmitCall,
): Promise<DeployResult> {
  try {
    const { Account, RpcProvider } = await import('starknet')
    const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
    const account = new Account({ provider, address, signer: accountKey })
    const { transaction_hash } = await account.execute([call] as never)
    await provider.waitForTransaction(transaction_hash)
    return { ok: true, transactionHash: transaction_hash }
  } catch (error) {
    // The account paid for any attempt that reached the sequencer, so this says so rather than
    // reading as though nothing happened.
    return {
      ok: false,
      because:
        error instanceof Error && error.message
          ? `The transaction did not complete: ${error.message}`
          : 'The transaction did not complete.',
    }
  }
}

/**
 * A creation invoke, the way the infrastructure was designed to carry it: the RELAYER signs and
 * pays gas, because the caller is a pool-native user whose STRK is shielded — the L2 address
 * usually holds nothing. `allowlist.ts` permits `create_house`/`propose` on the Governor for
 * exactly this ("the creator is a commitment… this key signing a creation identifies nobody"),
 * and the app simply never asked until now: `CreateHouse` self-signed with gas nobody had, which
 * is why "it didn't even work".
 *
 * FALLS BACK to the browser's own key when the relayer refuses or is unreachable — but only
 * after reading the ladder: telling an unfunded, undeployed account to self-sign buys the same
 * opaque RPC error this function exists to end. The refusal names the rung and the fix instead.
 */
export async function invokeSponsoredOrDirect(
  accountKey: string,
  address: string,
  call: SubmitCall,
): Promise<DeployResult> {
  let relayerBecause: string | null = null
  try {
    const response = await fetch(RELAYER_PATHS.submit, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calls: [call] }),
    })
    const body = (await response.json().catch(() => ({}))) as SubmitResponseBody
    if (response.ok && body.transactionHash) {
      // The relayer broadcast it; acceptance is still worth waiting for, because the surface's
      // next poll must see the result — the same rule `invokeDirect` states.
      const { RpcProvider } = await import('starknet')
      const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
      await provider.waitForTransaction(body.transactionHash)
      return { ok: true, transactionHash: body.transactionHash }
    }
    relayerBecause = body.notice ?? body.error ?? `the relayer answered ${response.status}`
  } catch {
    relayerBecause = 'the relayer could not be reached'
  }

  // The sponsored path is out. Self-signing is only offered when it can actually work.
  const status = await readAccountStatus(address)
  if (status.rung === 'unfunded' || status.rung === 'undeployed' || status.rung === 'unknown') {
    const fix =
      status.rung === 'unfunded'
        ? 'this address holds no STRK for gas — fund it from the wallet screen, or try again when the relayer is back'
        : status.rung === 'undeployed'
          ? 'this account is not deployed yet — the wallet screen has the deploy step'
          : (status.because ?? 'the account could not be read')
    return {
      ok: false,
      because: `The sponsored path failed (${relayerBecause}), and signing it yourself is not possible yet: ${fix}.`,
    }
  }
  return invokeDirect(accountKey, address, call)
}

/**
 * Deploy the account contract this key controls.
 *
 * ── THE ADDRESS IS CHECKED AGAINST THE KEY FIRST, AND THAT REFUSAL IS THE POINT ──────────
 *
 * `deploy-account.ts` calls this "the single most important check in this file", and it stops the
 * run rather than warning. If the derived address does not match the funded one, deploying creates
 * an account at some OTHER address — stranding the funds and paying a fee for a contract nobody
 * can use. There is no recovery from that, so it is refused before anything is signed.
 *
 * ── AND THE RESULT IS READ BACK FROM THE CHAIN ───────────────────────────────────────────
 *
 * "The transaction succeeded" is a weaker claim than "the class is there now", and this is the
 * moment where the difference matters most.
 */
export async function deployAccount(accountKey: string, address: string): Promise<DeployResult> {
  try {
    const { Account, RpcProvider, ec, hash } = await import('starknet')
    const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })

    const publicKey = ec.starkCurve.getStarkKey(accountKey)
    const derived = hash.calculateContractAddressFromHash(
      publicKey, // salt
      OZ_ACCOUNT_CLASS_HASH,
      [publicKey], // constructor calldata
      0, // deployerAddress — 0 for a self-deploying account
    )

    if (BigInt(derived) !== BigInt(address)) {
      return {
        ok: false,
        because:
          'This key does not control that address, so deploying would create an account somewhere ' +
          'else and strand whatever was sent here. Refused.',
      }
    }

    const account = new Account({ provider, address, signer: accountKey })
    const result = await account.deployAccount({
      classHash: OZ_ACCOUNT_CLASS_HASH,
      constructorCalldata: [publicKey],
      addressSalt: publicKey,
      contractAddress: address,
    })
    await provider.waitForTransaction(result.transaction_hash)

    // Read back rather than trusting the response.
    const onChain = await provider.getClassHashAt(result.contract_address)
    if (BigInt(onChain) !== BigInt(OZ_ACCOUNT_CLASS_HASH)) {
      return {
        ok: false,
        because: `The address now holds class ${onChain}, which is not the account class. Something else deployed there.`,
      }
    }

    return { ok: true, transactionHash: result.transaction_hash }
  } catch (error) {
    // The account paid for any attempt that reached the sequencer, so this says so rather than
    // reading as though nothing happened.
    return {
      ok: false,
      because:
        error instanceof Error && error.message
          ? `The deployment did not complete: ${error.message}`
          : 'The deployment did not complete.',
    }
  }
}
