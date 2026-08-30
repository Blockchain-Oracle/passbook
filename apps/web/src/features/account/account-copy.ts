// Sentences the drawer needs that `@strk20/protocol/account-copy` does not carry. Everything a
// protocol module already says is imported from there, never re-typed here.

export const FORGET_TITLE = 'Forget this browser’s wallet'
export const FORGET_BODY =
  'Every key saved in this browser is deleted: all accounts, the password vault, the backup record and any bearer position secrets. ' +
  'Nothing on chain changes. The only way back into these accounts afterwards is a Recovery File with its Recovery Code.'
export const FORGET_CONFIRM_WORD = 'forget'
export const FORGET_ACTION = 'Forget everything'
export const forgetPrompt = (word: string) => `Type ${word} to confirm.`

export const LABEL_TITLE = 'Name this account'
export const LABEL_BODY = 'A label stays in this browser. It is not the public name people find you by.'
export const LABEL_ACTION = 'Save label'

export const LOCK_ACTION = 'Lock'
export const ADD_ACCOUNT_ACTION = 'New account'
export const IMPORT_ACCOUNT_ACTION = 'Import'
export const ACTIVE_MARK = 'active'
export const NO_ACCOUNT = 'No account'
export const LOCKED_MARK = 'Locked'

// The PUBLIC name, which is a different thing from the label above it — and the sidebar was
// showing the label with no `@`, so a claimed handle and a private nickname read identically.
export const NAME_TITLE = 'Claim a public name'
export const NAME_BODY =
  'A public name puts @you over this address in the directory, so people can start a chat or pay you without pasting hex. ' +
  'The directory is public: it maps the name to this address, and anyone can read that.'
export const NAME_ACTION = 'Claim the name'
export const NAME_RULE = '3–20 characters: lowercase letters, numbers, hyphen or underscore.'
export const NO_NAME_MARK = 'No public name'
export const NAME_TAKEN = 'That name is already claimed.'
