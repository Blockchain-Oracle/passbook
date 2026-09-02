//
// Every sentence the passkey surfaces show. A leaf — no imports. Honest about what a passkey
// does: it seals the same accounts a password seals, and a synced one brings them back elsewhere.
// It never derives the key, and it never carries bets or history anywhere.
//

export type PasskeyErrorKind = 'unsupported' | 'unsupported-prf' | 'closed' | 'already-registered' | 'failed'

/** The sentence each failure gets. Exported so the copy cannot drift from the enum. */
export const PASSKEY_ERROR_TEXT: Record<PasskeyErrorKind, string> = {
  unsupported: 'This browser can’t make passkeys.',
  'unsupported-prf':
    'This passkey can’t protect a wallet in this browser yet. A password and your Recovery File still work.',
  // Neutral on purpose: a closed prompt and a missing passkey look identical from here.
  closed: 'The passkey prompt closed without a passkey.',
  'already-registered': 'That passkey already protects this wallet.',
  failed: 'The passkey could not be used.',
}

// ── Custody (new wallet) ────────────────────────────────────────────────────────────────
export const CUSTODY_PASSKEY_LABEL = 'Protect with a passkey'
export const CUSTODY_PASSKEY_BODY =
  'Face ID, Touch ID or the passkey on your phone seals this browser’s accounts. A synced passkey can bring them back on another device.'
export const CUSTODY_PASSKEY_PROMPTS = 'Two prompts: one to make the passkey, one to seal the wallet with it.'

// ── Lock screen ─────────────────────────────────────────────────────────────────────────
export const UNLOCK_WITH_PASSKEY = 'Unlock with passkey'
export const LOCKED_BODY_PASSKEY = 'Approve your passkey to open this wallet.'
export const LOCKED_BODY_BOTH = 'Enter your password, or approve your passkey, to open this wallet.'
export const UNLOCK_LOST_PASSKEY = 'Lost the passkey? Your Recovery File still opens this account.'

// ── Lock explanation, by what actually seals the accounts ───────────────────────────────
export const LOCK_WHAT_IT_DOES_PASSKEY =
  'Locking drops the key out of this page. Your accounts stay in this browser encrypted, and nothing can read them without your ' +
  'passkey — not this app, not an extension.'
export const LOCK_WHAT_IT_DOES_BOTH =
  'Locking drops the key out of this page. Your accounts stay in this browser encrypted, and nothing can read them without your ' +
  'password or your passkey — not this app, not an extension.'

// ── Settings → Security ─────────────────────────────────────────────────────────────────
export const PASSKEY_TITLE = 'Passkey'
export const PASSKEY_NONE = 'No passkey seals this wallet.'
export const PASSKEY_NONE_BODY = 'A passkey seals the same accounts a password does, and a synced one brings them back on another device.'
export const PASSKEY_SYNCED = 'Passkey · synced by your passkey provider'
export const PASSKEY_DEVICE_ONLY = 'Passkey · this device only'
export const PASSKEY_DEVICE_ONLY_WARNING = 'If this device is lost, only your Recovery File opens this wallet.'
export const PASSKEY_ADD = 'Add passkey'
export const PASSKEY_REMOVE = 'Remove passkey'
export const PASSKEY_REMOVE_BODY_PASSWORD = 'Your password will still seal this browser’s accounts. The sealed copy at the recovery service is deleted.'
export const PASSKEY_REMOVE_BODY_PLAIN =
  'Nothing will seal this browser’s accounts afterwards — the key goes back into this browser’s storage. The sealed copy at the recovery service is deleted.'
export const PASSKEY_SYNC_STATE_SYNCED = 'Sealed copy synced'
export const PASSKEY_SYNC_STATE_SYNCING = 'Syncing the sealed copy…'
export const PASSKEY_SYNC_NOW = 'Sync now'
export const PASSKEY_NEEDS_PASSWORD = 'Adding a passkey to a password-sealed wallet needs the password once.'

// ── Import → Passkey (fresh device) ─────────────────────────────────────────────────────
export const RESTORE_TAB = 'Passkey'
export const RESTORE_BODY = 'Approve the passkey you made on another device. Your accounts come back sealed the same way.'
export const RESTORE_CTA = 'Restore with passkey'
export const RESTORE_DONE = 'Accounts restored. Bets and history stay on the device that made them.'

// ── Forget ──────────────────────────────────────────────────────────────────────────────
export const FORGET_PASSKEY_NOTE =
  'A sealed copy stays with the recovery service and opens only with your passkey. Remove the passkey in Settings first if you want that gone too.'

// ── Outcomes ────────────────────────────────────────────────────────────────────────────
export const PASSKEY_ADDED_TOAST = 'This browser’s accounts are now sealed by your passkey.'
export const PASSKEY_REMOVED_TOAST_PASSWORD = 'The passkey is gone. Your password still seals this browser’s accounts.'
export const PASSKEY_REMOVED_TOAST_PLAIN = 'The passkey is gone. The key is back in this browser’s storage.'
export const PASSWORD_REMOVED_TOAST_PASSKEY = 'The password is gone. Your passkey still seals this browser’s accounts.'
export const PASSWORD_CHANGED_TOAST_V2 = 'Sealed again under the new password. The passkey is unchanged.'
