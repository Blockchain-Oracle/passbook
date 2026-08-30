//
// The shape of "what am I holding", once claims stop being a flat log.
//
// Nine buys on one launch are ONE position with nine claims in it, not nine positions. The old
// surfaces rendered a card per stored secret, so buying a token ten times printed ten identical
// cards and the answer to "how much can I collect" was arithmetic you had to do yourself.
//
import type { AnyPositionAction, PositionLifecycle, PositionTone } from '@strk20/protocol/position-lifecycle'
import type { StoredPosition } from '@strk20/protocol/session-position-store'

export type PositionVenue = 'market' | 'launch' | 'governance'

/** The tab a group appears under. `token` is Launch in the user's words. */
export type PositionTab = 'all' | 'market' | 'token' | 'house'

export interface Payout {
  token: string
  symbol: string
  decimals: number | null
}

/**
 * An amount that can be collected right now, in ONE token.
 *
 * Never a total across tokens. Payouts here land in STRK, in a launched token, in a House's token
 * — adding them would produce a number that is not any quantity of anything, and this app does not
 * print those. The rollup carries a list of these, one per symbol.
 */
export interface Claimable {
  symbol: string
  decimals: number | null
  wei: bigint
}

/** One stored secret, with whatever the chain has said about it. */
export interface Claim {
  position: StoredPosition
  action: AnyPositionAction | null
  life: PositionLifecycle
  pending: boolean
  failed: boolean
  /** What this claim's open door pays. A launch redeem and a launch refund pay different tokens. */
  payout: Payout
  /**
   * The contract this claim was actually FOUND on. A market position opened before the v2
   * migration lives on the superseded address, and its settlement has to go back there — sending
   * it to the current contract would be a call about a commitment that contract never recorded.
   */
  contract?: string
}

/** Everything held in one market, one launch, or one House. */
export interface PositionGroup {
  key: string
  venue: PositionVenue
  tab: PositionTab
  /** The market's question, the token's name, the House's name. */
  title: string
  /** The venue's own word for itself, under the title. */
  kicker: string
  /** Where this position lives, for the row that opens it. */
  href: { to: '/markets/$id' | '/launch/$id' | '/houses/$id'; id: string } | null
  /** When it decides, in one line, or nothing when this group cannot read a clock. */
  clock: string | null
  claims: Claim[]
  ready: number
  running: number
  finished: number
  /** Summed only within a symbol; usually one entry, occasionally two, never a cross-token total. */
  claimable: Claimable[]
  /** `ready` if anything in it can be settled now — the group sorts and colours by this. */
  tone: PositionTone
}

export interface PositionsRead {
  status: 'pending' | 'corrupt' | 'ok'
  /** Set only when `corrupt`: the position record could not be opened. */
  because: string | null
  groups: PositionGroup[]
  ready: number
  running: number
  finished: number
  claimable: Claimable[]
}

/** Merge per-symbol amounts, keeping each token's own scale. */
export function mergeClaimable(lists: readonly (readonly Claimable[])[]): Claimable[] {
  const out = new Map<string, Claimable>()
  for (const list of lists) {
    for (const item of list) {
      const held = out.get(item.symbol)
      out.set(item.symbol, held ? { ...held, wei: held.wei + item.wei } : item)
    }
  }
  return [...out.values()]
}
