//
// What the Markets and Launch surfaces say.
//
// The privacy claim here is narrow: every leg that touches an open note is public, so a bet's size,
// the odds it moved and its submitter are visible to anyone. The protection is that the venue
// stores a bearer commitment instead of an address — and a bet is hidden only while its
// denomination has company. Every sentence below says that much and no more.
//

// ── Markets: the surface ──────────────────────────────────────────────────────────────────

/** The standing line. Narrow on purpose — see the header. */
export const MARKETS_STANDING_LINE =
  'Take a side on where a price ends up. The size, odds movement and transaction submitter are ' +
  'public; the Markets record stores a bearer commitment instead of a bettor address.'

/** Names the one checkable thing — the prices are live — so a reader can tell mockup from waiting. */
export const MARKETS_NOT_DEPLOYED =
  'The Markets deployment is missing from this build, so writes are unavailable. Prices remain ' +
  'live from the same oracle a verified deployment settles against.'

/** Deployed, no standing series running, and nobody has opened a market. Different fact, different sentence. */
export const MARKETS_NONE_OPEN =
  'No standing series is running on this contract and nobody has opened a market. Anyone can ' +
  'open one, and the first bet in it sets the odds.'

export const MARKETS_LOADING = 'Reading the markets registry…'

// ── Standing windows ──────────────────────────────────────────────────────────────────────

/** Under the rail's title: what a window is, in one line. */
export const RAIL_LINE =
  'Every window closes on the mark and the next one is already there. The first bet sets the line; the house seeds the other side.'

/** A window before its first bet: no line yet, and why. */
export const WINDOW_OPENS_ON_FIRST_BET =
  'No line yet. The first bet opens this window on Pragma’s price at that moment, and the house ' +
  'seeds the other side.'

/** The opening floor, so a dust bet cannot lock the seed. `amount` rendered by the caller. */
export function openingStakeLine(amount: string): string {
  return `Opening this window takes at least ${amount}.`
}

// ── The price chart ───────────────────────────────────────────────────────────────────────

/** The series is what the relay witnessed, and the copy refuses to imply a market history. */
export const PRICE_SERIES_PROVENANCE =
  'This line is what the relay has witnessed — up to a day of oracle readings that survive your ' +
  'reload, still not a market history. When the live feed is unreachable it narrows to what this ' +
  'page has watched itself, and says so by getting shorter.'

/**
 * The dashed level before any market exists is the first price this page observed — a fact about
 * data the reader watched arrive, never an invented strike.
 */
export const CHART_REFERENCE_IS_WINDOW_OPEN =
  'The dashed line is the first price of the drawn window — green above it, red below. A market ' +
  'puts its own level there instead.'

// ── Betting ───────────────────────────────────────────────────────────────────────────────

export const BET_SIDE_UP = 'Over'
export const BET_SIDE_DOWN = 'Under'

/** The FPMM's whole advantage: the odds shown are the odds taken. */
export const BET_PRICE_LOCKS =
  'The odds you see are the odds you get — the price is fixed the moment the bet lands, not ' +
  'averaged out at the end.'

// ── Claiming ──────────────────────────────────────────────────────────────────────────────

/** The position secrets are money, and the backup surface has to know it. */
export const POSITION_SECRETS_ARE_MONEY =
  'A position is held by a secret in this browser, not by your address — that is what keeps the ' +
  'bet from naming you. It is also the only way to collect, so it is worth backing up.'

// ── Launch ────────────────────────────────────────────────────────────────────────────────

export const LAUNCH_STANDING_LINE =
  'Buy into a token as it is being sold. Price, progress and transaction submitter are public; ' +
  'the Launch record stores a bearer commitment instead of a buyer address.'

export const LAUNCH_NOT_DEPLOYED =
  'The Launch deployment is missing from this build, so creation and buying are unavailable.'

export const LAUNCH_NONE_OPEN =
  'No launches are open right now. Anyone can start one, and it graduates when it fills.'

/** Stepwise-linear per epoch, so everyone inside one pays the same and racing is pointless. */
export const LAUNCH_EPOCH_FACT =
  'Everyone in the same epoch pays the same price, so being first inside one is worth nothing. ' +
  'The price steps up when the epoch does.'

/**
 * "Records no buyer", never "your address never appears": the address does appear on the deposit
 * that funded the pool. What is true is narrower — this contract never sees it.
 */
export const LAUNCH_BUYER_HIDDEN =
  'The Launch contract records a bearer commitment instead of a buyer address. The price action ' +
  'and transaction submitter remain visible.'

export const LAUNCH_GRADUATION =
  'When the sale fills, the token is deployed and every buyer can redeem their share.'

export const LAUNCH_REFUND =
  'If the deadline passes before it fills, every buyer can take their money back.'
