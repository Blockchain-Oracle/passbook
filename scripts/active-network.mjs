//
// THE ACTIVE_NETWORK MATCHER. One copy, imported by everything that needs it.
//
// This module exists because of a bug, and the bug is worth stating so nobody re-splits it. There
// were four independently authored copies of this pattern: `lint-claims.mjs`, `apps/web/
// vite.config.ts`, the verify script's precondition, and the verify script's FLIP. Three used the
// anchored regex; the fourth used a plain string needle. On a tree with a commented-out decoy line
// above a live declaration, the flip corrupted the COMMENT, left the live declaration on mainnet,
// watched the build succeed, and reported "the sepolia build SUCCEEDED. The guard did not fire" —
// falsely accusing a guard that was working perfectly.
//
// Four copies of a security-relevant matcher will drift. The fix is not to fix the fourth copy.
//
// WHY THE PATTERN IS SHAPED LIKE THIS. Two properties, each earned:
//
//   - ANCHORED (`^…$` with `m`). The unanchored form matches the first occurrence ANYWHERE in the
//     file, including inside a comment. A line reading
//         // was: export const ACTIVE_NETWORK: NetworkName = 'mainnet' <- decoy
//     above a live `'sepolia'` declaration made every unanchored reader report `mainnet` and let an
//     off-mainnet production build through. Reproduced, not theorised.
//   - COUNTED. With two live declarations there is no fact of the matter about which network ships,
//     so every caller refuses instead of taking the first and sounding confident.
//
const PATTERN = String.raw`^export const ACTIVE_NETWORK: NetworkName = '(\w+)'$`

/**
 * A FRESH regex every call, deliberately. A shared `/g` regex object carries `lastIndex` between
 * uses, so exporting one would make results depend on who scanned last — a bug of exactly the kind
 * this module was created to end.
 *
 * @returns {RegExp}
 */
export function activeNetworkRegex() {
  return new RegExp(PATTERN, 'gm')
}

/**
 * Every LIVE declaration in `source`, in file order. Commented-out lines are not live.
 *
 * @param {string} source
 * @returns {{network: string, index: number, text: string}[]}
 */
export function findActiveNetworkDeclarations(source) {
  return [...source.matchAll(activeNetworkRegex())].map((m) => ({
    network: m[1],
    index: m.index,
    text: m[0],
  }))
}

/**
 * The single live declaration, or a thrown error naming why there isn't one.
 *
 * @param {string} source
 * @param {{file?: string, prefix?: string}} [opts] `prefix` is prepended to the message — callers
 *   that are asserted on by string (the build guard's `MAINNET GUARD`) pass theirs here.
 * @returns {{network: string, index: number, text: string}}
 */
export function requireSingleActiveNetwork(source, { file = 'constants.ts', prefix = '' } = {}) {
  const found = findActiveNetworkDeclarations(source)
  if (found.length !== 1) {
    throw new Error(
      `${prefix}${file} has ${found.length} live ACTIVE_NETWORK declarations, expected exactly 1. ` +
        `There is no fact of the matter about which network would ship.`,
    )
  }
  return found[0]
}

/**
 * Rewrites the one live declaration to `toNetwork` by INDEX SPLICE, never by string replacement.
 *
 * `source.replace(needle, …)` is what caused the original defect: the needle matched inside a
 * comment first and silently rewrote that instead. Splicing at the matched index cannot target
 * anything the matcher did not find, which is the whole point of having one matcher.
 *
 * The result is re-scanned before it is returned. A flip that did not produce exactly one live
 * declaration of the requested network is a flip that must never reach the filesystem — the caller
 * is about to mutate a real working tree with it.
 *
 * @param {string} source
 * @param {string} toNetwork
 * @param {{file?: string}} [opts]
 * @returns {string}
 */
export function flipActiveNetwork(source, toNetwork, { file = 'constants.ts' } = {}) {
  const decl = requireSingleActiveNetwork(source, { file })
  const line = `export const ACTIVE_NETWORK: NetworkName = '${toNetwork}'`
  const flipped = source.slice(0, decl.index) + line + source.slice(decl.index + decl.text.length)

  const after = findActiveNetworkDeclarations(flipped)
  if (after.length !== 1 || after[0].network !== toNetwork) {
    throw new Error(
      `flipping ${file} to '${toNetwork}' produced ${after.length} live declaration(s) ` +
        `(${after.map((d) => d.network).join(', ') || 'none'}). Refusing to write it.`,
    )
  }
  return flipped
}
