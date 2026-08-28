//
// What the Markets and Launch surfaces say (Wave 3).
//
// ── THE HARDEST SENTENCES HERE ARE THE EMPTY ONES ────────────────────────────────────────
//
// The contracts are deployed and their address evidence is verified. Empty boards still need one
// of two honest treatments:
// say what is missing and what will fill it, or show nothing. What they must never do is show a
// plausible market with invented odds — a screenshot of that is indistinguishable from a working
// product, which is the fixture-as-truth the anti-demo gate exists to stop.
//
// ── AND THE PRIVACY CLAIM HERE IS NARROW ─────────────────────────────────────────────────
//
// `forbidden-claims.ts` names "amounts are private" as false on this protocol, and it is false on
// exactly these two surfaces: every leg that touches an open note is public. A bet's SIZE, the
// odds it moved and its transaction submitter are visible to anyone reading the chain. The narrow
// protection is that Markets stores a bearer commitment instead of a bettor address. Every
// sentence below that mentions privacy says that, and none of them says more.
//
// ── THE ANONYMITY CLAIM IS NARROWER STILL ────────────────────────────────────────────────
//
// FR-009: a bet is hidden only while its denomination has company. Being the only person at a size
// identifies you by that size, which is why the denomination buttons carry live counts and why the
// copy treats "how many others are at this size" as part of what a user is choosing rather than as
// a statistic beside it.
//

// ── Markets: the surface ──────────────────────────────────────────────────────────────────

export const MARKETS_TITLE = 'Markets'

/** The standing line. Narrow on purpose — see the header. */
export const MARKETS_STANDING_LINE =
  'Take a side on where a price ends up. The size, odds movement and transaction submitter are ' +
  'public; the Markets record stores a bearer commitment instead of a bettor address.'

/**
 * The empty state before any deployment.
 *
 * It names the ONE thing that is true and checkable right now — the prices above are live — so a
 * reader can tell the difference between "this product is a mockup" and "this product is waiting
 * on a transaction". Those are very different things to be looking at.
 */
export const MARKETS_NOT_DEPLOYED =
  'The Markets deployment is missing from this build, so writes are unavailable. Prices remain ' +
  'live from the same oracle a verified deployment settles against.'

/** Deployed, and genuinely nothing open. Different fact, different sentence. */
export const MARKETS_NONE_OPEN =
  'Between windows — the Groundskeeper opens the next standing markets shortly. Anyone can open ' +
  'their own besides, and the first bet in it sets the odds.'

export const MARKETS_LOADING = 'Reading the markets registry…'

// ── The price strip ───────────────────────────────────────────────────────────────────────

/**
 * What the strip is.
 *
 * It says "the same oracle" because that is the load-bearing part: a chart drawn from a different
 * feed than the one the contract resolves against would be a decoration that disagrees with
 * settlement the day it matters.
 */
export const PRICE_STRIP_SOURCE =
  'Live from Pragma — the same oracle these markets resolve against.'

/**
 * The stale badge.
 *
 * Measured, not hypothetical: the day-0 checks watched this feed hold one value for eleven
 * minutes, and a live read while writing this surface came back nearly six minutes old. A price
 * that always renders bright would be claiming immediacy the feed does not have.
 */
export const PRICE_STALE = 'Not updated recently'

/** The series is this session's, and the copy refuses to imply otherwise. */
export const PRICE_SERIES_PROVENANCE =
  'This line is what the relay has witnessed — up to a day of oracle readings that survive your ' +
  'reload, still not a market history. When the live feed is unreachable it narrows to what this ' +
  'page has watched itself, and says so by getting shorter.'

/**
 * What the dashed line on the chart is, before any market exists.
 *
 * ── IT IS A REAL REFERENCE, NOT A PRETEND STRIKE ─────────────────────────────────────────
 *
 * The chart colours itself either side of a level — green above, red below — which is how a market
 * will answer "who is winning" with no legend. Until a market exists there is no strike to draw, and
 * inventing one would be the fixture-as-truth this whole surface refuses.
 *
 * So the level is the FIRST PRICE THIS PAGE OBSERVED: a fact about data the reader watched arrive,
 * true by construction, and exactly the shape a strike will take. The sentence says which it is,
 * because a dashed line on a price chart otherwise reads as a target somebody set.
 */
export const CHART_REFERENCE_IS_WINDOW_OPEN =
  'The dashed line is the first price of the drawn window — green above it, red below. A market ' +
  'puts its own level there instead.'

// ── Betting ───────────────────────────────────────────────────────────────────────────────

export const BET_SIDE_UP = 'Over'
export const BET_SIDE_DOWN = 'Under'

/**
 * The denomination explanation. FR-009, as a sentence somebody acts on.
 *
 * The crowd is framed as PART OF THE CHOICE rather than as a warning under it, because that is
 * what it is: picking a size nobody else picked is a decision to be identifiable.
 */
export const DENOMINATION_CROWD =
  'Bets hide in the crowd at their own size. Pick one others are using and you are one of many; ' +
  'pick a size nobody else has and the amount alone points back at you.'

/** When a denomination has no company yet. Stated plainly rather than dressed as a warning. */
export const DENOMINATION_ALONE =
  'Nobody else is at this size yet, so this bet would be identifiable by its amount.'

/**
 * The price-locks-at-bet-time fact.
 *
 * This is the FPMM's whole advantage over a parimutuel and it is the thing a bettor most needs to
 * know before pressing: the odds shown are the odds taken, not an estimate that settles later.
 */
export const BET_PRICE_LOCKS =
  'The odds you see are the odds you get — the price is fixed the moment the bet lands, not ' +
  'averaged out at the end.'

// ── Claiming ──────────────────────────────────────────────────────────────────────────────

/**
 * The claim-all bar.
 *
 * Yosuku's rule, adopted verbatim as a principle: unclaimed money is never hidden behind a tab. The
 * bar sits above the filter, outside both lists.
 */
export const CLAIM_ALL_READY = 'You have winnings to collect.'

/**
 * The linkability choice, and it is a REAL choice rather than a setting.
 *
 * Claiming several positions in one transaction is cheaper — one proof, one fee — and it publishes
 * that those positions belong to one person. Claiming separately costs more and says less. Neither
 * is the safe default, so the product asks rather than choosing.
 */
export const CLAIM_TOGETHER_LABEL = 'Collect together — one transaction'

export const CLAIM_TOGETHER_DETAIL =
  'Cheaper: one proof and one fee for all of them. It also shows that these positions belong to ' +
  'the same person, because they are collected in one transaction.'

export const CLAIM_SEPARATELY_LABEL = 'Collect one at a time'

export const CLAIM_SEPARATELY_DETAIL =
  'Costs a fee per position and keeps them unlinked, because nothing on chain ties one collection ' +
  'to the next.'

/** The position secrets are money, and the backup surface has to know it. */
export const POSITION_SECRETS_ARE_MONEY =
  'A position is held by a secret in this browser, not by your address — that is what keeps the ' +
  'bet from naming you. It is also the only way to collect, so it is worth backing up.'

// ── Launch ────────────────────────────────────────────────────────────────────────────────

export const LAUNCH_TITLE = 'Launch'

export const LAUNCH_STANDING_LINE =
  'Buy into a token as it is being sold. Price, progress and transaction submitter are public; ' +
  'the Launch record stores a bearer commitment instead of a buyer address.'

export const LAUNCH_NOT_DEPLOYED =
  'The Launch deployment is missing from this build, so creation and buying are unavailable.'

export const LAUNCH_NONE_OPEN =
  'No launches are open right now. Anyone can start one, and it graduates when it fills.'

/**
 * The epoch rule, as a fact about the contract rather than a promise about behaviour.
 *
 * The price is stepwise-linear per epoch, so everyone inside one pays the same. That is what makes
 * racing pointless, and it is worth saying in exactly those terms because every other launch
 * mechanism a reader has met rewards being first.
 */
export const LAUNCH_EPOCH_FACT =
  'Everyone in the same epoch pays the same price, so being first inside one is worth nothing. ' +
  'The price steps up when the epoch does.'

/**
 * What a buyer's address does and does not do here.
 *
 * IT SAYS "THE LAUNCH RECORDS NO BUYER", NOT "YOUR ADDRESS NEVER APPEARS" — and the second
 * phrasing is on `forbidden-claims.ts` for a reason that bites exactly here. The address DOES
 * appear: on the deposit that funded the pool, and on any withdrawal to a public address. What
 * is true is narrower and still worth saying — this contract never sees it.
 */
export const LAUNCH_BUYER_HIDDEN =
  'The Launch contract records a bearer commitment instead of a buyer address. The price action ' +
  'and transaction submitter remain visible.'

export const LAUNCH_GRADUATION =
  'When the sale fills, the token is deployed and every buyer can redeem their share.'

export const LAUNCH_REFUND =
  'If the deadline passes before it fills, every buyer can take their money back.'

// ── The walkthrough ───────────────────────────────────────────────────────────────────────

export const TOUR_SKIP = 'Skip'

export const TOUR_DONE = 'Got it'

export const TOUR_STEP_PRICES_TITLE = 'These prices are real'
export const TOUR_STEP_PRICES_BODY =
  'They come from Pragma on Starknet mainnet, read straight from your browser. A market settles ' +
  'against the same oracle.'

export const TOUR_STEP_SIDES_TITLE = 'Pick a side, not a price'
export const TOUR_STEP_SIDES_BODY =
  'A market asks whether a price ends up over or under a level by a deadline. You take one side; ' +
  'the odds move as others take theirs.'

export const TOUR_STEP_CROWD_TITLE = 'Your size is what hides you'
export const TOUR_STEP_CROWD_BODY =
  'The amount is public and the account is not — so a size other people are also using is what ' +
  'keeps a bet from pointing back at you.'
