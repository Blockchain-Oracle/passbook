// Funding-rail capability gate (FR-017, story 1.15). A funding wallet (Ready via the Wallet API,
// Xverse as a candidate) is a FUNDING SOURCE, never an identity — its address never becomes the
// account chip. This module decides whether a wallet can be a funding rail using the cheapest
// signal first, so a capable wallet is not taxed with a needless consent-prompting probe.

/** Minimum Wallet API version implementing the STRK20 methods (Ready ≥ this). */
export const MIN_WALLET_API = '0.10.3'

/** The public-deposit honesty line — shipped before any deposit (FR-017). */
export const PUBLIC_DEPOSIT_NOTICE =
  'Your deposit is public. This address and this amount are visible on Starknet. ' +
  'Privacy starts after the deposit, not at it.'

/** Semver-ish compare of dotted numeric versions: a >= b. Missing segments read as 0. */
export function versionGte(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return true
}

export type WalletSupport = 'supported' | 'unsupported' | 'probe-required'

/**
 * The gate ORDER, tax-avoiding: decide from the advertised Wallet API version when we have one,
 * and only fall through to a probe when we genuinely cannot tell. The balance-reading
 * `wallet_strk20Balances` probe raises a consent prompt on a capable wallet, so we never fire it
 * if a version answers the question (that would tax exactly the user we want to keep).
 *
 * - advertised ≥ MIN            → 'supported'   (no probe)
 * - advertised present but < MIN → 'unsupported' (too old; no probe)
 * - advertised absent/unknown   → 'probe-required' (last resort, call with `{ tokens: [] }`)
 *
 * Braavos advertises nothing usable and answers "not implemented" to the probe → resolves to
 * 'unsupported' through the probe path, and must show its NAMED failure state, never a silent one.
 */
export function assessByVersion(advertisedApiVersion: string | null | undefined): WalletSupport {
  if (advertisedApiVersion == null || advertisedApiVersion === '') return 'probe-required'
  return versionGte(advertisedApiVersion, MIN_WALLET_API) ? 'supported' : 'unsupported'
}

export type ProbeResult = 'implemented' | 'not-implemented'

/** Resolves the last-resort probe result into support. Only called when assessByVersion said so. */
export function assessByProbe(probe: ProbeResult): WalletSupport {
  return probe === 'implemented' ? 'supported' : 'unsupported'
}

/**
 * Full gate: version first, probe only if required. `probe` is invoked lazily and ONLY when the
 * version signal is insufficient — so a capable, version-advertising wallet is never prompted.
 */
export async function resolveFundingCapability(
  advertisedApiVersion: string | null | undefined,
  probe: () => Promise<ProbeResult>,
): Promise<WalletSupport> {
  const byVersion = assessByVersion(advertisedApiVersion)
  if (byVersion !== 'probe-required') return byVersion   // decided without taxing the wallet
  return assessByProbe(await probe())
}
