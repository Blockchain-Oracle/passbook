//
// Where a token's picture actually loads from.
//
// The chain stores `logo_uri` as the CREATOR wrote it — `ipfs://CID` once the M3 pin pipeline
// lands, or any https URL a custom client chose to write — and a browser cannot fetch `ipfs://`
// directly. This module is the one place that mapping lives, so the gateway can change without a
// grep across surfaces, and so the disclosure page has a single host to name.
//
// PURE, AND BROWSER-SAFE. String functions only; the eager chunk pays nothing for it.
//

/**
 * The public gateway rendered logos load through. In `PROXY_EXCEPTIONS`' terms this is a
 * browser-direct host: what it learns is which token logos a viewer's browser asked for —
 * disclosed there, and nothing else about the viewer.
 */
export const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'

const CID_PATTERN = /^[a-zA-Z0-9]{32,128}$/

/**
 * A chain-stored `logo_uri` into something an `<img>` can load, or null for "use the disc".
 *
 * Null is the ANSWER for anything unrecognised, not a failure: `TokenLogo`'s seeded disc is the
 * designed fallback, and a malformed URI a hostile creator wrote into the contract must become a
 * disc, never an `<img src>` this app did not vet the scheme of.
 */
export function logoDisplayUrl(logoUri: string | null | undefined): string | null {
  if (!logoUri) return null
  const uri = logoUri.trim()
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length).split('/')[0] ?? ''
    return CID_PATTERN.test(cid) ? `${IPFS_GATEWAY}${cid}` : null
  }
  if (uri.startsWith('https://')) return uri
  // http, data:, javascript:, a bare CID — all refused into the disc. `data:` in particular is
  // refused because the contract caps the field at 256 chars, so a real data URI cannot fit and
  // anything that short pretending to be one is not a logo.
  return null
}
