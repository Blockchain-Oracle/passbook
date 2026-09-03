//
// Earn's words. A leaf with no imports, so a card can render a sentence without pulling a reader.
//
// Two rules run through all of it. First, `forbidden-claims.ts`: a Vesu supply's amount IS public,
// so nothing here may say amounts are private, and "read-only" is banned outright so market data
// is described some other way. Second, a rate is an observation and not a promise — every line
// about yield says when it was read or that it moves, because a lending rate quoted flatly reads
// as a commitment nobody made.
//

export const EARN_TITLE = 'Earn'
export const EARN_KICKER = 'Money'

export const EARN_DESCRIPTION =
  'Compare private-pool lending routes, supply shielded USDC, and manage the positions you hold.'

/** The one-line answer to "what is this doing with my money". */
export const EARN_ROUTE_LINE =
  'Shielded USDC leaves the pool to our helper, the helper supplies the market, and the shares come ' +
  'back to you as a private note — one transaction.'

// ── States ────────────────────────────────────────────────────────────────────────────────

export const EARN_NOT_DEPLOYED =
  'The Earn helper is not deployed in this build, so nothing can be supplied yet. The markets below ' +
  'are real and every figure is a live read.'

export const EARN_CATALOG_LOADING = 'Reading the markets…'

export const EARN_CATALOG_EMPTY = 'No lending markets are configured in this build.'

/** Both halves, always: why new money is refused AND that existing money is untouched. */
export const EARN_MARKET_PAUSED =
  'This market is paused, so nothing new can be supplied. A position already in it is unaffected and ' +
  'can still be redeemed.'

export const EARN_MARKET_UNVALIDATED =
  'This market did not match the addresses recorded for it, so it is shown but cannot be transacted with.'

export const EARN_MARKET_UNREADABLE =
  'This market could not be read just now, so its figures are missing rather than zero.'

export const EARN_NO_POSITION = 'Nothing here yet.'

export const EARN_POSITION_LOADING = 'Reading your notes…'

export const EARN_LOCKED = 'Unlock to see what you hold. The markets below are public either way.'

/** Why performance can be missing while the value is not. */
export const EARN_HISTORY_INCOMPLETE =
  'What this cost is still being recovered from the chain, so the return is not shown yet. The value ' +
  'and the shares are exact.'

// ── The things a rate does not promise ────────────────────────────────────────────────────

export const EARN_RATE_MOVES =
  'The rate is variable and was read just now. It is what the market pays at this moment, not a ' +
  'forecast and not a commitment.'

/** The sentence that stops a high APY reading as a recommendation. */
export const EARN_UTILIZATION_MEANS =
  'Utilization is how much of this market is lent out. High utilization is usually what pays well, ' +
  'and it is also what can make leaving harder.'

export const EARN_REDEEMABLE_MEANS =
  'What a position is worth and what can be taken out today are different numbers: the market lends ' +
  'its deposits out, so a redemption is bounded by what is currently unborrowed.'

export const EARN_NO_RISK_SCORE =
  'We do not score these markets. The first-party feed publishes no risk rating, and inventing one ' +
  'would be us making up a number about somebody else’s money.'

// ── Costs ─────────────────────────────────────────────────────────────────────────────────

export const EARN_SELF_SUBMITTED =
  'Earn transactions are submitted by your own account, so they need public STRK for the pool fee ' +
  'and gas. They cannot be covered.'

export const EARN_BREAK_EVEN_MEANS =
  'How long at the current rate before the yield covers the pool fee both ways. A small deposit can ' +
  'take longer to break even than it is worth holding.'

export const EARN_ROUND_TRIP =
  'Getting in and out costs two pool fees. The exit one is an estimate at today’s fee, which moves.'

// ── Moving between markets ────────────────────────────────────────────────────────────────

/** The line the two-step plan exists to make unmissable. */
export const EARN_MOVE_NOT_ATOMIC =
  'Moving between markets is two separate transactions with two fees. After the first, your money is ' +
  'shielded USDC and you can stop there — nothing commits you to the second.'

export const EARN_MOVE_STEP_ONE = 'Redeem from the market you are in'
export const EARN_MOVE_STEP_TWO = 'Supply the market you are moving to'

export const EARN_MOVE_BLOCKED_UNKNOWN =
  'The first transaction’s outcome is still unknown, so the second is held back. Nothing is retried ' +
  'automatically — that is how a redemption gets done twice.'
