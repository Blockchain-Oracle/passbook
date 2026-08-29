//
// The ten claims this product does not make, as data.
//
// These are not style preferences. Each one is a sentence that is FALSE about STRK20 as deployed,
// and a privacy tool that states a false guarantee is worse than no privacy tool, because its
// users act on the difference. Written down so the copy modules and their tests share one list
// instead of each carrying its own retyped copy.
//
// There is NO gate enforcing this. Nothing fails if a surface ships one of these strings; it is a
// thing a human has to mean, and Settings renders the list to users verbatim.
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
