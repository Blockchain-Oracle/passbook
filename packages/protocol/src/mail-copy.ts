//
// Mail's words. Every sentence here is a claim the code above it can keep.
//

export const MAIL_TITLE = 'Mail'
export const MAIL_TAGLINE = 'Every message is a shielded payment.'

/** The footer disclosure: what a mail costs and where it lives. */
export const MAIL_IS_A_TRANSACTION =
  'A mail is one pool transaction: the money lands as a shielded note, and the pool posts the sealed ' +
  'memo to the Mailbox in the same proof. There is no server between you and the reader.'
export const MAIL_HISTORY_IS_CHAIN =
  'Threads are rebuilt from the chain with your viewing key — on this device, or any device you bring the account to. Nothing is kept in this browser.'
export const MAIL_COST_NOTE = 'Each mail pays the pool fee and gas, or spends one covered transaction.'

/** Composer. */
export const MAIL_COMPOSE_PLACEHOLDER = 'Write something. It seals with the payment.'
export const MAIL_POSTAGE_LABEL = 'Postage'
export const MAIL_POSTAGE_NOTE = 'A mail with no amount still carries postage: the note is how the reader finds it.'
export const MAIL_SEND_CTA = 'Send mail'
export const MAIL_REVIEW_TITLE = 'Review and send'
export const MAIL_TOO_LONG = 'Too long to seal in one mail.'

/** Thread states. */
export const MAIL_NO_THREADS = 'No mail yet.'
export const MAIL_NO_THREADS_HINT = 'Send someone a payment with a note, and the thread starts here.'
export const MAIL_PICK_A_THREAD = 'Pick a thread'
export const MAIL_THREAD_EMPTY = 'No mail with this account yet.'
export const MAIL_PENDING = 'Sending'
export const MAIL_VERIFIED = 'On chain'
export const MAIL_UNREADABLE = 'Could not be opened'
export const MAIL_UNREADABLE_HINT = 'The memo did not authenticate against the note it rides with.'
export const MAIL_UNSUPPORTED = 'A message this app does not read yet.'
export const MAIL_AMOUNT_UNKNOWN = 'The pool holds no note under this id.'

/** Peer refusals, on the composer. */
export const MAIL_PEER_UNREGISTERED = 'This account has not registered with the pool, so it has no channel to receive mail on.'
export const MAIL_PEER_SELF = 'That is your own address.'
export const MAIL_PEER_INVALID = 'Not an address.'

/** New-mail dialog. */
export const MAIL_NEW = 'New mail'
export const MAIL_DIRECTORY_PLACEHOLDER = 'A name from the directory, or an address'
export const MAIL_DIRECTORY_IS_LOCAL = 'Search happens in this browser; the directory is fetched once.'
export const MAIL_NAME_IS_NOT_IDENTITY = 'A directory name is a claim by whoever registered it, not a verified identity.'

/** Cards. */
export const MAIL_REQUEST_LABEL = 'Asks for'
export const MAIL_REQUEST_PAY = 'Pay'
export const MAIL_SHARE_BET = 'Share a finished bet'
export const MAIL_SHARE_HANDLE = 'Share voter handle'
export const MAIL_ASK_FOR_MONEY = 'Ask for money'
