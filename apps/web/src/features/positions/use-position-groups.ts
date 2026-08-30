//
// The one read behind the positions surface: every bearer claim this browser holds, resolved
// against the chain and grouped into the thing it is a claim ON.
//
// It uses the SAME query keys the venue panels use, so the directory shares their cache rather
// than opening a second read of the same position. Nothing here decides a door — the venues'
// `*PositionAction` reducers do, and `positionLifecycle` puts one vocabulary over all three.
//
import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { MARKET_STATE, marketQuestion, timeLeft, type OnChainLaunch, type OnChainMarket } from '@strk20/protocol/app-reads'
import { PROPOSAL_STATE, type OnChainHouse } from '@strk20/protocol/governance-reads'
import { governancePositionAction, launchPositionAction, marketPositionAction } from '@strk20/protocol/position-actions'
import { positionLifecycle, type PositionTone } from '@strk20/protocol/position-lifecycle'
import type { StoredPosition } from '@strk20/protocol/session-position-store'

import { houseTitle } from '@/features/houses/gov-send'
import { launchStateWord } from '@/features/launch/phase'
import { shortAddress } from '@/lib/format'
import {
  findToken,
  governanceWrites,
  housesQuery,
  launchPositionQuery,
  launchesQuery,
  marketPositionQuery,
  marketsQuery,
  proposalsQuery,
  tokenListQuery,
} from '@/queries'
import { storedPositionsQuery } from '@/queries/positions'

import { mergeClaimable, type Claim, type Claimable, type PositionGroup, type PositionsRead, type Payout } from './types'

type TokenList = Parameters<typeof findToken>[0]

/** One frozen empty array, so "nothing stored" is a stable reference rather than a new one. */
const EMPTY: readonly StoredPosition[] = []

/** A token's display identity, or an honest stand-in. `decimals: null` renders raw units, never a guess. */
function payoutFor(list: TokenList, token: string, symbol?: string): Payout {
  const info = findToken(list, token)
  return { token, symbol: symbol ?? info?.symbol ?? shortAddress(token, 6, 3), decimals: info?.decimals ?? (symbol ? 18 : null) }
}

function marketClock(market: OnChainMarket | undefined, now: number): string | null {
  if (!market) return null
  if (market.state === MARKET_STATE.resolved) return 'Resolved'
  if (market.state === MARKET_STATE.voided) return 'Voided — stakes are refundable'
  const left = timeLeft(market.deadline, now)
  return left === 'closed' ? 'Closed · settling' : `Resolves in ${left}`
}

function launchClock(launch: OnChainLaunch | undefined, now: number): string | null {
  if (!launch) return null
  const word = launchStateWord(launch)
  if (word === 'graduated') return 'Graduated'
  if (word === 'failed') return 'Did not fill'
  const left = timeLeft(launch.deadline, now)
  return left === 'closed' ? 'Deadline passed' : `Closes in ${left}`
}

/** Ready beats running beats finished: a group is as actionable as its most actionable claim. */
function groupTone(claims: readonly Claim[]): PositionTone {
  if (claims.some((c) => c.life.tone === 'ready')) return 'ready'
  return claims.some((c) => c.life.tone === 'waiting') ? 'waiting' : 'settled'
}

function claimableOf(claims: readonly Claim[]): Claimable[] {
  return mergeClaimable(
    claims
      .filter((c) => c.life.tone === 'ready' && c.life.amount !== null)
      .map((c) => [{ symbol: c.payout.symbol, decimals: c.payout.decimals, wei: c.life.amount! }]),
  )
}

function assemble(
  key: string,
  venue: PositionGroup['venue'],
  tab: PositionGroup['tab'],
  title: string,
  kicker: string,
  href: PositionGroup['href'],
  clock: string | null,
  claims: Claim[],
): PositionGroup {
  return {
    key,
    venue,
    tab,
    title,
    kicker,
    href,
    clock,
    claims,
    ready: claims.filter((c) => c.life.tone === 'ready').length,
    running: claims.filter((c) => c.life.tone === 'waiting').length,
    finished: claims.filter((c) => c.life.tone === 'settled').length,
    claimable: claimableOf(claims),
    tone: groupTone(claims),
  }
}

/** Insertion-ordered buckets, so settling one claim never reshuffles the board. */
function bucket<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const held = out.get(key)
    if (held) held.push(row)
    else out.set(key, [row])
  }
  return out
}

export function usePositionGroups(now: number): PositionsRead {
  const stored = useQuery(storedPositionsQuery())
  const markets = useQuery(marketsQuery())
  const launches = useQuery(launchesQuery())
  const houses = useQuery(housesQuery())
  const proposals = useQuery(proposalsQuery())
  const tokens = useQuery(tokenListQuery())
  const writes = governanceWrites()

  // Read once into a stable array: a fresh `[]` every render would re-key every `useQueries` below.
  const all = useMemo<readonly StoredPosition[]>(() => (stored.data?.state === 'ok' ? stored.data.positions : EMPTY), [stored.data])
  const marketHeld = useMemo(() => all.filter((p) => p.venue === 'market'), [all])
  const launchHeld = useMemo(() => all.filter((p) => p.venue === 'launch'), [all])
  const govHeld = useMemo(() => all.filter((p) => p.venue === 'governance'), [all])

  const marketReads = useQueries({ queries: marketHeld.map((p) => marketPositionQuery(p.commitment)) })
  const launchReads = useQueries({ queries: launchHeld.map((p) => launchPositionQuery(p.commitment)) })

  // Narrowed before the memo so its dependencies are the values it reads, not five query objects.
  const marketList = markets.data?.markets
  const launchList = launches.data?.launches
  const houseList = houses.data?.houses
  const proposalList = proposals.data?.proposals
  const tokenList = tokens.data
  const govPending = houses.isPending || proposals.isPending
  const govFailed = houses.isError

  const groups = useMemo(() => {
    const list = tokenList
    const out: PositionGroup[] = []

    // MARKETS. The market a claim landed in is only known after its read — a seed is stored before
    // the chain assigns an id — so grouping has to wait for the reading, not the stored row.
    const marketClaims = marketHeld.map((position, i): Claim & { marketId: number } => {
      const read = marketReads[i]
      const market = marketList?.find((m) => m.id === (read?.data?.marketId ?? position.id))
      const action =
        read?.data && market
          ? marketPositionAction({
              positionOpen: read.data.state === 1,
              marketState:
                market.state === MARKET_STATE.active ? 'active' : market.state === MARKET_STATE.resolved ? 'resolved' : 'voided',
              beforeDeadline: now < market.deadline * 1000,
              cashoutQuote: read.data.cashoutQuote,
              claimPreview: read.data.claimPreview,
            })
          : null
      return {
        position,
        action,
        life: positionLifecycle(action),
        pending: read?.isPending ?? true,
        failed: read?.isError ?? false,
        payout: payoutFor(list, market?.token ?? '0x0'),
        marketId: market?.id ?? position.id,
      }
    })
    for (const [id, claims] of bucket(marketClaims, (c) => String(c.marketId))) {
      const market = marketList?.find((m) => m.id === Number(id))
      out.push(
        assemble(
          `market:${id}`,
          'market',
          'market',
          market ? marketQuestion(market) : `Market #${id}`,
          'Market',
          market ? { to: '/markets/$id', id: String(market.id) } : null,
          marketClock(market, now),
          claims,
        ),
      )
    }

    // LAUNCHES. A redeem pays the launched token; a refund pays back the stake. Two tokens in one
    // group, so the payout is decided per claim rather than per group.
    const launchClaims = launchHeld.map((position, i): Claim => {
      const read = launchReads[i]
      const launch = launchList?.find((l) => l.id === position.id)
      const action =
        read?.data && launch
          ? launchPositionAction({
              positionOpen: read.data.state === 1,
              launchState: launchStateWord(launch),
              deadlinePassed: now >= launch.deadline * 1000,
              redeemPreview: read.data.redeemPreview,
              refundPreview: read.data.refundPreview,
            })
          : null
      const redeeming = action?.kind === 'redeem'
      return {
        position,
        action,
        life: positionLifecycle(action),
        pending: read?.isPending ?? true,
        failed: read?.isError ?? false,
        payout:
          redeeming && launch
            ? { token: launch.token, symbol: launch.symbol, decimals: 18 }
            : payoutFor(list, launch?.stakeToken ?? '0x0'),
      }
    })
    for (const [id, claims] of bucket(launchClaims, (c) => String(c.position.id))) {
      const launch = launchList?.find((l) => l.id === Number(id))
      out.push(
        assemble(
          `launch:${id}`,
          'launch',
          'token',
          launch ? launch.name || launch.symbol : `Launch #${id}`,
          'Token launch',
          launch ? { to: '/launch/$id', id: String(launch.id) } : null,
          launchClock(launch, now),
          claims,
        ),
      )
    }

    // HOUSES. No per-claim chain read exists, so the door comes from the proposal's own state and
    // a founder's claim states plainly that it has none — never an invented lifecycle.
    const govClaims = govHeld.map((position): Claim => {
      const proposal = position.kind === 'gov-ballot' ? proposalList?.find((p) => p.id === position.id) : undefined
      const house = houseList?.find((h: OnChainHouse) => h.id === position.houseId)
      const action =
        position.kind === 'gov-founder'
          ? null
          : governancePositionAction({
              escrowOpen: true,
              kind: position.kind === 'gov-delegation' ? 'delegation' : 'ballot',
              amount: 0n,
              proposalActive: proposal ? proposal.state === PROPOSAL_STATE.active : position.kind === 'gov-ballot',
              writesEnabled: writes.enabled,
              ...(writes.enabled ? {} : { writeBlocker: writes.because }),
            })
      return {
        position,
        action,
        life: positionLifecycle(action),
        pending: govPending,
        failed: govFailed,
        payout: payoutFor(list, house?.token ?? '0x0'),
      }
    })
    for (const [id, claims] of bucket(govClaims, (c) => String(c.position.houseId ?? c.position.id))) {
      const house = houseList?.find((h: OnChainHouse) => h.id === Number(id))
      out.push(
        assemble(
          `house:${id}`,
          'governance',
          'house',
          house ? houseTitle(house) : `House #${id}`,
          'DAO',
          house ? { to: '/houses/$id', id: String(house.id) } : null,
          null,
          claims,
        ),
      )
    }

    // Ready first — the only ordering that answers "what can I do right now" without reading it all.
    const rank: Record<PositionTone, number> = { ready: 0, waiting: 1, settled: 2 }
    return out.sort((a, b) => rank[a.tone] - rank[b.tone])
  }, [marketHeld, launchHeld, govHeld, marketReads, launchReads, marketList, launchList, houseList, proposalList, tokenList, govPending, govFailed, writes, now])

  if (stored.isPending) return { status: 'pending', because: null, groups: [], ready: 0, running: 0, finished: 0, claimable: [] }
  if (stored.data?.state === 'corrupt') {
    return { status: 'corrupt', because: stored.data.because, groups: [], ready: 0, running: 0, finished: 0, claimable: [] }
  }
  return {
    status: 'ok',
    because: null,
    groups,
    ready: groups.reduce((n, g) => n + g.ready, 0),
    running: groups.reduce((n, g) => n + g.running, 0),
    finished: groups.reduce((n, g) => n + g.finished, 0),
    claimable: mergeClaimable(groups.map((g) => g.claimable)),
  }
}
