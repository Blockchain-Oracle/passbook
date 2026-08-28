//
// Asking the relayer for the starter STRK.
//
// ── IT IS A REQUEST, NOT A TRANSACTION, AND THAT IS THE WHOLE CLIENT SIDE ─────────────────
//
// Everything else in this shell that moves money builds calls, proves them, and posts a batch.
// This posts one address. `packages/relayer/src/faucet.ts` explains why: the drip transfers the
// relayer's OWN STRK, so letting the client contribute calls would be handing the network a
// signed transfer of somebody else's balance. There is nothing to build here and nothing to sign,
// which is why this file is short and has no SDK edge at all — it never enters the crypto chunk.
//
// ── AND EVERY REFUSAL IS A SENTENCE THE SERVER WROTE ──────────────────────────────────────
//
// The relayer answers 400/429/503 with an `error` string that is already user-facing copy: which
// cap bound, and what to do instead ("fund this account from any Starknet wallet"). Re-writing
// those here would mean two sources for one sentence and the client's would be the one that
// drifts — it cannot see which of the three limits actually fired.
//

//
// FROM `relayer-wire.ts`, NOT FROM `register.ts`, and the difference is a failed build.
//
// The obvious import is `DEFAULT_RELAYER_URL`, which is the name every other caller uses. It is
// also re-exported from the head of the crypto graph, so importing it here — into a module that
// is a `fetch` wrapper with no cryptography in it — put `starknet` in the eager chunk and
// `build:web` refused the build by name (`INEFFECTIVE_DYNAMIC_IMPORT`, three of them). The paths
// live in a leaf precisely so this file can have one.
//
import { RELAYER_PATHS } from '@strk20/protocol/relayer-wire'

/** The drip endpoint. Relative, so the app's own origin resolves it — see `RELAYER_PATHS`. */
const FAUCET_URL = RELAYER_PATHS.faucet

/** The relayer is signing and broadcasting; a fast timeout would abandon a transfer mid-flight. */
const TIMEOUT_MS = 45_000

export type DripOutcome =
  | { ok: true; txHash: string; amountWei: string }
  /**
   * `because` is ALWAYS renderable prose.
   *
   * `retryable` distinguishes "the relayer is having a moment" from "this account has had its
   * drip". Only the first should show a button that tries again; offering one for a spent claim
   * is a control that is guaranteed to fail, which reads as a bug in the app rather than as the
   * rule it actually is.
   */
  | { ok: false; because: string; retryable: boolean }

/**
 * Ask for the starter STRK for `address`.
 *
 * NEVER THROWS. A funding step that throws would take out the surface it runs on, and the whole
 * point of the drip is that it is optional — an account that does not get one is an account that
 * has to be funded another way, not a broken account.
 */
export async function requestDrip(address: string): Promise<DripOutcome> {
  let response: Response
  try {
    response = await fetch(FAUCET_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    return {
      ok: false,
      because: `Could not reach the relayer to send starter STRK: ${String(e)}`,
      // A request that never arrived is safe to repeat: nothing was claimed and nothing was sent.
      retryable: true,
    }
  }

  //
  // 404 IS A CONFIGURED STATE, NOT AN ERROR, and it needs its own sentence.
  //
  // The relayer answers 404 when it has no faucet ledger, which is the DEFAULT — the drip is
  // opt-in per deployment (`RELAYER_FAUCET=on`) precisely because it gives away principal. A
  // build pointed at a relayer without one must say "this deployment does not do that" rather
  // than "something went wrong", and must not offer a retry for a route that will never exist.
  //
  if (response.status === 404) {
    return {
      ok: false,
      because: 'This deployment does not hand out starter STRK. Fund this account from any Starknet wallet.',
      retryable: false,
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, because: 'The relayer did not answer with JSON.', retryable: true }
  }

  if (!response.ok) {
    const error = (body as { error?: unknown })?.error
    return {
      ok: false,
      because: typeof error === 'string' && error !== '' ? error : `The relayer answered ${response.status}.`,
      // 503 is ours and transient; 400 and 429 are the caller's situation and repeating them
      // changes nothing.
      retryable: response.status >= 500,
    }
  }

  const { txHash, amountWei } = (body ?? {}) as { txHash?: unknown; amountWei?: unknown }
  if (typeof txHash !== 'string' || typeof amountWei !== 'string') {
    // A 200 whose shape is wrong is NOT reported as success. The surface would render a receipt
    // for a transfer it cannot name, and a link to a transaction hash of `undefined`.
    return { ok: false, because: 'The relayer reported success without a transaction.', retryable: true }
  }

  return { ok: true, txHash, amountWei }
}
