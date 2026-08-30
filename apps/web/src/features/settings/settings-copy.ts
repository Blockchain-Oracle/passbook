// Sentences Settings needs that no protocol copy module carries. Everything a protocol module
// already says (`account-copy`, `backup-copy`, `disclosure-copy`) is imported there, never retyped.

export const SETTINGS_DESCRIPTION = 'How this browser holds the key, what it shows, and what it talks to.'

// ── Appearance ──────────────────────────────────────────────────────────────────────────────
export const THEME_LABELS = { dark: 'Dark', light: 'Light', system: 'Follow system' } as const
export const THEME_FOLLOWING_SYSTEM = 'Following your system setting. Changing it there changes this app.'
export const THEME_PINNED = 'Stored on this device. strk20.run opens in this theme until you change it here.'

// ── Security ────────────────────────────────────────────────────────────────────────────────
export const PASSWORD_CHANGE_ACTION = 'Change password'
export const PASSWORD_CHANGE_BODY =
  'The accounts are unsealed with the current password and sealed again with the new one. The old password stops working at once.'
export const PASSWORD_TOO_SHORT = (min: number) => `Use at least ${min} characters.`
export const STRENGTH_LABEL = { 'too-short': 'Too short', weak: 'Weak', fair: 'Fair', strong: 'Strong' } as const
export const NEED_UNLOCK = 'Unlock this wallet to change how it is protected.'
export const AUTO_LOCK_TITLE = 'No timer'
export const AUTO_LOCK_BODY =
  'strk20.run does not lock on its own. Lock it here or close the tab; with a password set, a reload asks for it again.'
export const LOCK_NOW = 'Lock now'
export const PASSWORD_SET_TOAST = 'This browser’s accounts are now encrypted.'
export const PASSWORD_REMOVED_TOAST = 'The key is back in this browser’s storage.'
export const PASSWORD_CHANGED_TOAST = 'Sealed again under the new password.'
export const PASSWORD_CHANGE_HALF_DONE =
  'The old password was removed but the new one could not be set, so the key is in this browser’s storage in the clear. Set a password again now.'

// ── Backup ──────────────────────────────────────────────────────────────────────────────────
export const BACKUP_STATUS_TITLE = { 'backed-up': 'Backed up', 'not-backed-up': 'No backup', unknown: 'Backup state unknown' } as const
export const BACKUP_VERIFIED_OK = 'That file and code open this key.'
export const VERIFY_TITLE = 'Check a recovery file'
export const VERIFY_ACTION = 'Verify'
export const REISSUE_ACTION = 'Write a new recovery file'
export const REISSUE_TITLE = 'New recovery file'
export const lastVerifiedLine = (at: number | null) =>
  at === null ? 'Never verified in this browser.' : `Last verified ${new Date(at).toLocaleDateString()}.`
export const nextCheckLine = (dueAt: number | null, due: boolean) => {
  if (dueAt === null) return null
  return due ? 'A check is due now.' : `Next check ${new Date(dueAt).toLocaleDateString()}.`
}

// ── Privacy ─────────────────────────────────────────────────────────────────────────────────
export const NEVER_CLAIM_TITLE = 'What we never claim'
export const NEVER_CLAIM_BODY =
  'Each of these is false about the pool as deployed. If you read one of them anywhere in strk20.run, it is a bug.'
export const RECIPIENT_SEES = 'The recipient of a private transfer sees who sent it. Private is not anonymous to your counterparty.'
export const OPEN_NOTE_PUBLIC =
  'An open-note leg makes its amount public. Markets, Launch and DAOs can record a bearer commitment instead of your account, but the transaction submitter remains visible on-chain.'
export const MATRIX_PICKER_LABEL = 'Show the matrix for'

// ── Network ─────────────────────────────────────────────────────────────────────────────────
export const POOL_STATE_LABEL = { ok: 'Live', paused: 'Paused', upgraded: 'Upgraded', unreachable: 'Unreachable' } as const
export const RPC_ORDER_NOTE = 'The first host answers; the rest are fallbacks, tried in order.'
export const FEE_RECIPIENT_TITLE = 'Relayer fee recipient'
export const FEE_RECIPIENT_BODY = 'Where the pool fee goes when the relayer submits for you.'
export const FEE_RECIPIENT_UNSET = 'Not set'
export const PINNED_POOL = 'Pinned protocol deployment'

// ── Sounds ──────────────────────────────────────────────────────────────────────────────────
export const SOUNDS_TITLE = 'Sounds'
export const SOUNDS_ON = 'Short cues when a submission settles or fails. Nothing else makes noise.'
export const SOUNDS_OFF = 'strk20.run is silent. It plays no sound anywhere.'

// ── Danger ──────────────────────────────────────────────────────────────────────────────────
export const FORGET_TITLE = 'Forget this browser’s wallet'
export const FORGET_BODY =
  'Every key saved in this browser is deleted: all accounts, the password vault, the backup record and any bearer position secrets. ' +
  'Nothing on chain changes. The only way back into these accounts afterwards is a Recovery File with its Recovery Code.'
export const FORGET_CONFIRM_WORD = 'forget'
export const FORGET_ACTION = 'Forget everything'
export const forgetPrompt = (word: string) => `Type ${word} to confirm.`
export const FORGOTTEN_TOAST = 'This browser holds no keys now.'
export const NOTHING_TO_FORGET = 'This browser holds no account.'
