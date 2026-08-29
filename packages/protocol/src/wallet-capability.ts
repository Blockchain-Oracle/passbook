// Funding-rail capability gate. A funding wallet (Ready via the Wallet API) is a FUNDING SOURCE,
// never an identity — its address never becomes the account chip. The decision reads the
// advertised Wallet API version and nothing else: the sponsor's integration guide says not to
// feature-detect with `strk20Balances([])`, which wallets gate behind a balance-consent prompt.

/** Minimum Wallet API version implementing the STRK20 methods (Ready ≥ this). */
export const MIN_WALLET_API = '0.10.3'

/** The public-funding honesty line — shown before the connected wallet signs. */
export const PUBLIC_FUNDING_NOTICE =
  'This funding transfer is public. The sender, Passbook address and amount are visible on Starknet. ' +
  'Privacy starts only when the embedded Passbook account shields those funds.'

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
 * - advertised ≥ MIN             → 'supported'
 * - advertised present but < MIN → 'unsupported'
 * - advertised absent/unknown    → 'probe-required' — the app treats this as unknown, full stop.
 */
export function assessByVersion(advertisedApiVersion: string | null | undefined): WalletSupport {
  if (advertisedApiVersion == null || advertisedApiVersion === '') return 'probe-required'
  return versionGte(advertisedApiVersion, MIN_WALLET_API) ? 'supported' : 'unsupported'
}
