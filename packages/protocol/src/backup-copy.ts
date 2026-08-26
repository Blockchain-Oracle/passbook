//
// Every user-facing sentence the backup ceremony ships (FR-013, story 1.8, AC6).
//
// One const per sentence, exported, and `toBe`-asserted in the suite. The reason copy
// lives in source rather than in the components that render it is drift: the same
// promise appears on the ceremony screen, the verification screen and the nag, and three
// hand-typed copies of a sentence about what a backup does NOT protect you from will not
// stay identical through a redesign. Epic 6 imports these; it does not retype them.
//
// The wording is the brief's, verbatim (`context/11-product-experience.md` §3 and the UX
// spine's flow W3). Where a sentence is authored here rather than quoted, the comment
// above it says so and says under which rule it was written.
//
// ── THE LINT TRAP, STATED SO IT IS NOT REDISCOVERED ────────────────────────────────────
// Ten bare claim substrings are forbidden in user-facing copy, three of which are the
// hyphenated capability words for "can see but cannot spend". Two sentences in the brief's §3
// are built from those words — the fixed Account-Key definition that travels with every
// rendering of the key, and the sentence in the second-device answer that refuses the same
// capability. NEITHER IS HERE, and their absence is deliberate rather than an oversight: the
// lint is protecting a real prohibition (spec §11), and the fix is for the surface that needs
// the definition to reword it, never to loosen the lint or to smuggle the phrase past it.
//
// This applies to comments too, which is how it is easy to get wrong — the lint is line-based
// over the whole file, so explaining the ban using the banned word trips it. `backup-copy`'s
// suite reads the list straight out of the lint script and checks every line of these modules.
//

// ── The ceremony (UX spine W3 steps 1, 5, 6) ───────────────────────────────────────────

/**
 * The frame, shown before the key exists. This is where no-rotation is stated plainly:
 * the gate is justified by the write-once fact, not by a policy we chose.
 */
export const BACKUP_CEREMONY_FRAME =
  'Save your key before we write anything on-chain. ' +
  'The key we register can never be replaced — the protocol writes it once.'

/**
 * The done screen. An INVENTORY, not a congratulation — the second half is the point, and
 * a product that says "You're all set!" here has lied about what a two-secret backup is.
 */
export const BACKUP_DONE_INVENTORY =
  'What this protects against: a new laptop, a cleared browser, a lost phone. ' +
  "What it doesn't: anyone who gets both the file and the code has your balance, " +
  'your history and your messages, permanently. There is no revoke and no rotation.'

/**
 * The single-root claim, WITH the caveat it is not allowed to ship without.
 *
 * Authored here rather than quoted: the brief states the claim and states that it may not
 * be made unqualified until the restore-time channel-index probe passes (`context/11` §9
 * Q5; epics 1.8 probe-gate). So the caveat is part of the sentence rather than a footnote
 * somebody can drop. Delete the second half only when that probe has actually run.
 */
export const ONE_BACKUP_COVERS_EVERYTHING =
  'One backup covers everything — your account key is the single root it all derives from. ' +
  'One part of that is still untested: rebuilding your channel indexes when you restore. ' +
  'Until we have tested it, treat that part as unproven rather than promised.'

// ── Periodic verification (UX spine W3 step 7) ─────────────────────────────────────────

/** Shown beside the file-drop and code field. It is true: the check never leaves the tab. */
export const BACKUP_VERIFICATION_IN_BROWSER =
  'This happens in your browser. Nothing is uploaded.'

/**
 * A failed periodic check. Separates the two things a user conflates in this moment: the
 * money is fine, the safety net is not. Panic about the balance sends people to do worse.
 */
export const BACKUP_VERIFICATION_FAILED =
  "That file and code don't open your key. Your notes are fine — the backup isn't. " +
  'Make a new one now.'

/**
 * Re-wrap copy, and it must never imply revocation, because there is none. Making a new
 * Recovery File does not retire the old one — anyone holding the old file and its old code
 * still opens the same key, forever. Copy that says "your old backup is now invalid" would
 * be the single most dangerous sentence in the product.
 */
export const BACKUP_REWRAP_NO_REVOCATION =
  'Your Account Key stays the same — it cannot be changed. Your old Recovery File still ' +
  'opens it with its old code, and nothing can invalidate that. Delete the old file yourself.'

// ── The one persistent nag (`context/11` §4 table; UX spine W3 non-happy states) ────────

/**
 * Shown while an account holds value and has no backup. Not red, not dismissible, and gone
 * forever once a backup exists. Reachable through restore paths only — for accounts created
 * through the conversion flow the gate makes this state structurally impossible.
 */
export const NO_BACKUP_NAG = 'This account has no backup. Save it.'

/**
 * Shown when the backup status is UNKNOWN rather than known-absent.
 *
 * Authored here, because the brief has no sentence for it and `NO_BACKUP_NAG` cannot be
 * borrowed. "This account has no backup" is a factual claim, and the unknown state is exactly
 * the state that cannot support it: an unreadable cadence store, a seam story 1.11 has not
 * wired yet, or a first run says nothing about whether the user has a Recovery File sitting in
 * their password manager. Telling someone who backed up carefully last month that they have no
 * backup is how a product loses the credibility it needs for the moments it IS sure.
 *
 * The behaviour is identical — both nag, because `unknown` collapses to not-backed-up — and
 * only the sentence differs. Fail-closed in what we DO, honest in what we SAY.
 */
export const BACKUP_STATE_UNKNOWN_NAG =
  "We can't tell whether this account has a backup. Check it, or make a new one."

// ── Restore failures (AC2) ─────────────────────────────────────────────────────────────
//
// These three are thrown by `restoreBackup` and re-exported from `identity.ts`, so a caller
// catching one of its errors finds the sentence next to the function that threw it. They
// live HERE because there must be exactly one definition of each, and this is the file whose
// job is to hold it.

/**
 * The wrong-code sentence, byte-exact per AC2, and reserved for the ONE case it describes:
 * a structurally sound envelope whose ciphertext did not authenticate. Every other failure
 * gets a different sentence, because telling someone their code is wrong when their file is
 * damaged sends them to re-type a code that was right all along — and, worse, teaches them
 * to distrust a code that is the only copy in existence.
 */
export const WRONG_RECOVERY_CODE = 'That file and recovery code do not open this key.'

/** The file is not a backup envelope we can read at all. Says nothing about the code. */
export const MALFORMED_BACKUP_FILE = 'That backup file is malformed or truncated.'

/**
 * A well-formed envelope at a version this build does not know. Distinct from malformed on
 * purpose: the file is probably intact and probably fine somewhere newer, and telling the
 * user it is corrupt would invite them to delete the only copy of their key.
 */
export const UNSUPPORTED_BACKUP_VERSION =
  'That backup file was written by a newer version of this app, which this one cannot read. ' +
  'Do not delete it.'
