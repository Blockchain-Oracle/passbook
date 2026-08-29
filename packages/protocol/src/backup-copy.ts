//
// Every user-facing sentence the backup ceremony ships. One const per sentence, imported rather
// than retyped: the same promise appears on the ceremony screen, the verification screen and the
// nag, and hand-typed copies of a sentence about what a backup does NOT protect you from drift.
// The wording is the brief's (`context/11-product-experience.md` §3); a sentence authored here
// says so above it. The forbidden capability words (`forbidden-claims.ts`) never appear, in copy
// or in comments — the fix is always to reword.
//

// ── The ceremony ───────────────────────────────────────────────────────────────────────

/**
 * The done screen. An INVENTORY, not a congratulation — the second half is the point, and
 * a product that says "You're all set!" here has lied about what a two-secret backup is.
 */
export const BACKUP_DONE_INVENTORY =
  'What this protects against: a new laptop, a cleared browser, a lost phone. ' +
  "What it doesn't: anyone who gets both the file and the code has your balance, " +
  'your history and your messages, permanently. There is no revoke and no rotation.'

// ── Periodic verification ──────────────────────────────────────────────────────────────

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

// ── The one persistent nag ─────────────────────────────────────────────────────────────

/**
 * Shown while an account holds value and has no backup. Not red, not dismissible, and gone
 * forever once a backup exists. Reachable through restore paths only — for accounts created
 * through the conversion flow the gate makes this state structurally impossible.
 */
export const NO_BACKUP_NAG = 'This account has no backup. Save it.'

/**
 * Shown when the backup status is UNKNOWN rather than known-absent. Authored here: "This account
 * has no backup" is a factual claim an unreadable store cannot support, and telling someone who
 * backed up last month that they have no backup loses the credibility the sure moments need.
 * Both nag — fail-closed in what we DO, honest in what we SAY.
 */
export const BACKUP_STATE_UNKNOWN_NAG =
  "We can't tell whether this account has a backup. Check it, or make a new one."

// ── Restore failures ───────────────────────────────────────────────────────────────────
//
// Thrown by `restoreBackup`; one definition of each, here.

/**
 * Reserved for the ONE case it describes: a sound envelope whose ciphertext did not authenticate.
 * Telling someone their code is wrong when their file is damaged sends them to re-type a code
 * that was right all along.
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
