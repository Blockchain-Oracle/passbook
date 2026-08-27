//
// The account lifecycle's sentences (Wave 1 — the wallet becomes a wallet).
//
// ── WHY THESE LIVE HERE AND NOT IN THE DRAWER THAT RENDERS THEM ──────────────────────────
//
// Every sentence below is a claim about somebody's only copy of a key. `backup-copy.ts` set the
// precedent and its reasoning holds exactly: a sentence that decides whether a user deletes a
// recovery file has to be reviewable as text, diffable on its own, and pinned by a test that
// fails on a paraphrase. A string typed inline in a component is none of those.
//
// ── THE ONE THING THIS PRODUCT MUST NOT SAY ABOUT LOCKING ────────────────────────────────
//
// `session-key.ts` is explicit that the root key sits in localStorage IN PLAINTEXT, as an
// accepted, argued risk: every alternative available in a browser today moves the exposure
// rather than removing it, and a passkey WRAP (never a derive) is the thing that would actually
// improve it. So Lock here drops the key out of the running page and nothing more.
//
// That makes the honest word for it a SCREEN lock, and the copy says so in as many words. The
// tempting sentence — "your account is locked and safe" — would be the exact overclaim this
// repository fails builds over: it would tell someone that closing a tab protects them from a
// malicious extension, which is false, and they would act on the difference.
//
// ── AND THE TWO IMPORT FAILURES ARE NOT ONE FAILURE ──────────────────────────────────────
//
// zk-freighter's unlock path (its `App.tsx:107` and `:132`) distinguishes "this secret did not
// open the vault" from "this secret opened a DIFFERENT wallet", and the distinction is the whole
// value of the check: the first is a typo and the second is a file that does not belong to the
// identity it claims. Collapsing them into "import failed" tells a user to retype a code that
// was never wrong.
//

// ── Locking ───────────────────────────────────────────────────────────────────────────────

/** What Lock actually does. Never "safe", never "encrypted" — see the header. */
export const LOCK_WHAT_IT_DOES =
  'Locking drops the key out of this page and leaves it in this browser’s storage. It is a screen ' +
  'lock, not encryption: anything that can already read this browser can still read the key.'

/** The locked screen's headline. */
export const LOCKED_HEADLINE = 'Locked'

/** The locked screen's body. Its whole job is to say that nothing was destroyed. */
export const LOCKED_BODY =
  'Nothing was deleted and nothing moved. Unlock to read your balance and spend again.'

/** The unlock control. */
export const UNLOCK_ACTION = 'Unlock'

/**
 * The lock happened in this page and could not be written down.
 *
 * REPORTED RATHER THAN SWALLOWED, because the two halves of a lock fail independently: dropping
 * the key out of the page always works, and recording it so a reload stays locked can fail on a
 * storage that has gone unreadable. Returning success for the pair would send someone away from a
 * screen that says Locked believing it will still say that when they come back.
 */
export const LOCK_NOT_SAVED =
  'The key is out of this page, but the lock could not be saved — reloading will open this wallet ' +
  'again. Close the tab if you need it shut.'

/**
 * The one way unlocking can fail.
 *
 * There is no password to get wrong — the key is read straight back out of storage — so the only
 * failure that can occur is the one worth catching loudly: the stored key no longer derives the
 * address this browser recorded beside it, which means something replaced it.
 */
export const UNLOCK_DIFFERENT_IDENTITY =
  'The stored key no longer derives the address recorded beside it, so this is not the account ' +
  'that was locked. Nothing has been overwritten. Import your recovery file to get back in.'

// ── Importing ─────────────────────────────────────────────────────────────────────────────

export const IMPORT_TITLE = 'Import an account'

export const IMPORT_BODY =
  'Choose the recovery file you saved, then type the recovery code that opens it. You need both — ' +
  'either one on its own is useless, which is the point of having two.'

/** The code did not open the file. A typo, and it says so rather than blaming the file. */
export const IMPORT_CODE_WRONG =
  'That code did not open this file. Nothing was changed — check it and try again.'

/** The file is not one of ours, or it is damaged. */
export const IMPORT_FILE_UNREADABLE =
  'That is not a Passbook recovery file, or it has been damaged. Keep it — try the original ' +
  'download rather than a copy that has been through anything that rewrites text.'

/**
 * A file from a newer build. NEVER "make a new one" — `identity.ts` argues this at length: the
 * file is intact, it opens in the build that wrote it, and telling its owner to replace it invites
 * them to delete the only copy of a key that cannot be reissued.
 */
export const IMPORT_UNSUPPORTED_VERSION =
  'This recovery file was written by a newer version of Passbook. Do not delete it — it still ' +
  'opens there. Update this app and try again.'

/** The file opened, and the key inside it is not the account the file's own header names. */
export const IMPORT_DIFFERENT_IDENTITY =
  'That file opened, but the key inside it does not derive the address the file’s own header ' +
  'records. The two halves do not describe one account, so nothing was imported.'

/** Imported an account this browser already holds. Not an error — say what happened instead. */
export const IMPORT_ALREADY_HERE =
  'This browser already holds that account, so it was switched to rather than added twice.'

/** A file with no key in it at all. */
export const IMPORT_NO_KEY =
  'That file opened, and what came out is not a Stark private key. Nothing was imported.'

// ── Switching, and holding more than one ──────────────────────────────────────────────────

export const SWITCH_TITLE = 'Switch account'

/**
 * What a second account is and is not.
 *
 * Stated because the alternative reading — that accounts here are linked, or that one can pay for
 * another — is the one a user brings from every custodial wallet they have used.
 */
export const SWITCH_BODY =
  'Each account is a separate key with its own address, its own balance and its own history. ' +
  'Nothing on chain joins them up, and neither does this app.'

/** The only account there is. */
export const SWITCH_NOTHING_TO_SWITCH_TO =
  'This is the only account in this browser. Import one, or create another, to have something to ' +
  'switch between.'

export const CREATE_ACTION = 'Create another account'

/**
 * The warning that has to ride with creation.
 *
 * A new account starts unbacked and unregistered, and this app's own gate refuses registration
 * until a recovery file exists. Saying so at the moment of creation is cheaper than saying it
 * after somebody has funded the thing.
 */
export const CREATE_BODY =
  'A new account starts with nothing: no funds, no registration, and no recovery file. It cannot ' +
  'register with the pool until you have saved one.'

// ── The address, and the drawer's own facts ───────────────────────────────────────────────

/**
 * What the address in the drawer is.
 *
 * `registration-requires-a-deployed-account` is a fact this repo learned live: the address is
 * exact before anything is deployed, and money sent there waits. Both halves have to be said, or
 * the sentence either scares people off a valid address or promises an account that answers.
 */
export const ADDRESS_IS_EXACT_BEFORE_DEPLOY =
  'This address is exact before the account is deployed. Anything sent here waits for it.'

/** The clipboard affirmation. Rendered only from the write's success callback, never before it. */
export const COPIED = 'Copied'

/** The copy control's resting label. */
export const COPY_ADDRESS = 'Copy address'

/** The export row. It opens the ceremony rather than downloading anything by itself. */
export const EXPORT_ROW_LABEL = 'Export recovery file'

export const EXPORT_ROW_DETAIL =
  'Writes a fresh recovery file and a code that opens it. The old one keeps working.'

/** The balance line in the drawer, when the walk has not answered. */
export const DRAWER_BALANCE_UNREAD = 'Balance not read yet'

/** The balance line when the walk failed. Never a zero — see `balances.ts`. */
export const DRAWER_BALANCE_UNKNOWN = 'The pool could not be read'
