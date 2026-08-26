//
// The ten claims this product does not make, as data.
//
// These are not style preferences. Each one is a sentence that is FALSE about STRK20 as deployed,
// and a privacy tool that states a false guarantee is worse than no privacy tool, because its
// users act on the difference. Written down so the copy modules and their tests share one list
// instead of each carrying its own retyped copy.
//
// WHY THIS FILE EXISTS AT ALL. The list used to live inside `scripts/lint-claims.mjs`, and three
// test files reached across the repository to REGEX-SCRAPE it out of that script's source. That
// script was removed on 2026-08-26 (Abu's ruling — the lint step is gone and is not coming back).
// The list itself is product knowledge rather than tooling, so it moved here rather than dying
// with the script: a plain exported array, imported normally, with no scrape and no build step.
//
// There is NO gate enforcing this any more. Nothing fails if a surface ships one of these strings.
// It is a list the tests below hold the shipped copy modules to, and otherwise a thing a human has
// to mean.
//
// Why each one is false here, briefly — this is the part worth reading before deleting an entry:
//
//   end-to-end / e2ee        the auditor holds an escrowed viewing key; `get_enc_private_key` is
//                            permissionless. There is a third party by construction.
//   only you can             see above. Someone else can.
//   zero-knowledge           the pool proves things, but amounts on any leg touching an OPEN note
//                            are public. The phrase promises more than the protocol delivers.
//   watch-only / view-only /
//   read-only                one key both reads notes and signs spending. There is no view-only
//                            derivation to hand an accountant, and there never will be here.
//   your address never
//   appears                  it appears on deposit, and on any withdrawal to a public address.
//   amounts are private      false for swaps, launches and market bets — every leg that touches an
//                            open note is public. The sponsor's own rule: "Claim identity privacy;
//                            never claim amount privacy for swaps."
//   unlinkable across
//   surfaces                 the six identities are unlinkable TO OTHER USERS. The auditor and the
//                            relayer can join them up. The honest sentence names who cannot, not
//                            "nobody".
//
export const FORBIDDEN_CLAIMS = [
  'end-to-end',
  'e2ee',
  'only you can',
  'zero-knowledge',
  'watch-only',
  'view-only',
  'read-only',
  'your address never appears',
  'amounts are private',
  'unlinkable across surfaces',
] as const

/**
 * Case-insensitive substring scan, the same shape the retired lint used.
 *
 * Deliberately dumb. A substring check over whole lines catches the phrase in a comment as easily
 * as in a shipped sentence, which is the correct sensitivity: a comment that says "this is
 * end-to-end encrypted" is a claim the next person will believe and repeat.
 *
 * @returns the forbidden phrases present in `text`, empty when it is clean
 */
export function forbiddenClaimsIn(text: string): string[] {
  const haystack = text.toLowerCase()
  return FORBIDDEN_CLAIMS.filter((phrase) => haystack.includes(phrase))
}
