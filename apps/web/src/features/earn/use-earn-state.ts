import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parseAmountInput } from '@strk20/protocol/amount'
import { toPlainText } from '@strk20/protocol/amount-format'
import { EARN_UNDERLYING, marketById, type EarnMarketDefinition } from '@strk20/protocol/earn-markets'
import { breakEven, type BreakEven } from '@strk20/protocol/earn-rate'
import type { EarnMarketSnapshot } from '@strk20/protocol/earn-reads'
import type { EarnPosition } from '@strk20/protocol/earn-position'

import { useSession } from '@/app/session'
import { appContracts } from '@/queries/app'
import { earnCatalogQuery, earnHelperQuery, earnPositionsQuery, earnQuoteQuery } from '@/queries/earn'
import { poolConstantsQuery, pricesQuery, shieldedBalanceQuery } from '@/queries'
import { publicBalancesQuery, publicTokenSet } from '@/queries/public-balances'
import { useNow } from '@/hooks/use-now'

export type EarnTab = 'supply' | 'redeem'
export type EarnFilter = 'all' | 'available' | 'held'

const USDC_DECIMALS = 6
const CLOCK_MS = 30_000

/** The balance a tab spends: shielded USDC to supply, held shares to redeem. */
function spendable(tab: EarnTab, usdcWei: bigint | null, position: EarnPosition | undefined): bigint | null {
  return tab === 'supply' ? usdcWei : (position?.sharesWei ?? 0n)
}

export interface EarnState {
  ready: boolean
  /** This account, for the reads a door has to make on its own. */
  address: string | undefined
  locked: boolean
  now: number
  /** Every market, in registry order, whatever state each is in. */
  catalog: EarnMarketSnapshot[]
  catalogLoading: boolean
  catalogFailed: boolean
  positions: EarnPosition[]
  positionsLoading: boolean
  filter: EarnFilter
  setFilter: (next: EarnFilter) => void
  shown: EarnMarketSnapshot[]
  selected: EarnMarketSnapshot | null
  select: (marketId: string) => void
  position: EarnPosition | undefined
  tab: EarnTab
  setTab: (next: EarnTab) => void
  raw: string
  setRaw: (next: string) => void
  parsed: ReturnType<typeof parseAmountInput>
  /** Decimals of whatever the current tab spends — 6 for USDC, 18 for shares. */
  decimals: number
  symbol: string
  available: bigint | null
  short: boolean
  /** Public USDC this account holds, for the row that offers to shield it. `null` while unread. */
  publicUsdcWei: bigint | null
  /** How much shielded USDC a supply is missing, or `null` when it fits. Drives the shield door. */
  shortfallWei: bigint | null
  /** The market's own estimate of what comes back. `undefined` while it is being read. */
  quoteWei: bigint | undefined
  quoteLoading: boolean
  feeWei: bigint | null
  breakEven: BreakEven
  /** Why the CTA cannot open the review. `null` when it can. */
  blocker: string | null
  helperProblem: string | null
  reset: () => void
}

/**
 * Everything `/earn` renders from, in one hook.
 *
 * Reads are shared through the query client rather than fanned out per component — the catalog is
 * read once for the rail, the panel and the positions, so seven markets are not read three times.
 */
export function useEarnState(seedMarketId?: string): EarnState {
  const session = useSession()
  const ready = session.status === 'ready'
  const address = ready ? session.address : undefined
  const accountKey = ready ? session.accountKey : undefined
  const now = useNow(CLOCK_MS)

  const catalog = useQuery(earnCatalogQuery())
  const positions = useQuery(earnPositionsQuery(address, accountKey))
  const balance = useQuery(shieldedBalanceQuery(address, accountKey))
  const fee = useQuery(poolConstantsQuery())
  const prices = useQuery(pricesQuery())
  const helper = useQuery(earnHelperQuery())

  const [filter, setFilter] = useState<EarnFilter>('all')
  const [tab, setTab] = useState<EarnTab>('supply')
  const [raw, setRaw] = useState('')
  const [chosen, setChosen] = useState<string | null>(seedMarketId && marketById(seedMarketId) ? seedMarketId : null)

  const rows = catalog.data ?? []
  const held = positions.data ?? []

  const shown = useMemo(() => {
    if (filter === 'available') return rows.filter((row) => row.validated && !row.paused && row.blocker === null)
    if (filter === 'held') return rows.filter((row) => held.some((p) => p.market.marketId === row.market.marketId))
    return rows
  }, [rows, held, filter])

  // The first market with something in it, else the first that can be used, else the first at all.
  // Never "the highest rate" — that would be the app choosing, and the whole point of the rail is
  // that the rate alone is not the decision.
  const selected = useMemo(() => {
    if (chosen) return rows.find((row) => row.market.marketId === chosen) ?? null
    const withPosition = rows.find((row) => held.some((p) => p.market.marketId === row.market.marketId))
    return withPosition ?? rows.find((row) => row.validated && !row.paused) ?? rows[0] ?? null
  }, [rows, held, chosen])

  const position = held.find((p) => p.market.marketId === selected?.market.marketId)
  const market: EarnMarketDefinition | null = selected?.market ?? null

  const usdcWei = useMemo(() => {
    const row = balance.data?.tokens.find((t) => {
      try {
        return BigInt(t.token) === BigInt(EARN_UNDERLYING)
      } catch {
        return false
      }
    })
    return row?.wei ?? (balance.data ? 0n : null)
  }, [balance.data])

  const decimals = tab === 'supply' ? USDC_DECIMALS : (market?.shareDecimals ?? 18)
  const symbol = tab === 'supply' ? 'USDC' : 'shares'
  const available = spendable(tab, usdcWei, position)
  const parsed = parseAmountInput(raw, decimals)
  const short = parsed.wei !== null && available !== null && parsed.wei > available

  const quote = useQuery(earnQuoteQuery(market, tab, parsed.wei))
  // Public USDC is read whatever the shielded side says: a holder with 100 public and 0 shielded
  // was the case Earn shipped unable to serve, and it is the ordinary case for a new account.
  const publicBalances = useQuery(publicBalancesQuery(address, publicTokenSet([EARN_UNDERLYING])))
  const publicUsdcWei = useMemo(() => {
    const found = Object.keys(publicBalances.data ?? {}).find((k) => {
      try {
        return BigInt(k) === BigInt(EARN_UNDERLYING)
      } catch {
        return false
      }
    })
    return found === undefined ? null : (publicBalances.data?.[found] ?? null)
  }, [publicBalances.data])
  // Only a supply can be covered by shielding: a redeem spends shares, which cannot be bought.
  const shortfallWei =
    tab === 'supply' && parsed.wei !== null && available !== null && parsed.wei > available ? parsed.wei - available : null
  // `PragmaReading` is a per-pair union: a failed pair carries its name and a reason, not a price.
  // Reaching past that would render a break-even built on `undefined`.
  const strkReading = prices.data?.find((r) => r.ok && r.price.pair === 'STRK/USD')
  const strk = strkReading?.ok ? strkReading.price.price : null

  const evenAt = useMemo(
    (): BreakEven =>
      breakEven({
        // For a redeem the question is not break-even, so it is measured on the supply figure only.
        principalWei: tab === 'supply' ? (parsed.wei ?? 0n) : 0n,
        underlyingDecimals: USDC_DECIMALS,
        poolFeeWei: fee.data?.feeWei ?? 0n,
        strkPrice: strk,
        apy: selected?.apy ?? 0,
      }),
    [tab, parsed.wei, fee.data?.feeWei, strk, selected?.apy],
  )

  const helperProblem = !appContracts().vesuEarn
    ? null // The surface says this once, up top; a per-field repeat would be saying it twice.
    : helper.data && !helper.data.ok
      ? helper.data.because
      : null

  return {
    ready,
    address,
    locked: !ready,
    now,
    catalog: rows,
    catalogLoading: catalog.isPending,
    catalogFailed: catalog.isError,
    positions: held,
    positionsLoading: positions.isPending && ready,
    filter,
    setFilter,
    shown,
    selected,
    select: (marketId) => {
      setChosen(marketId)
      setRaw('')
    },
    position,
    tab,
    setTab: (next) => {
      setTab(next)
      setRaw('')
    },
    raw,
    setRaw,
    parsed,
    decimals,
    symbol,
    available,
    short,
    publicUsdcWei,
    shortfallWei,
    quoteWei: quote.data,
    quoteLoading: quote.isFetching,
    feeWei: fee.data?.feeWei ?? null,
    breakEven: evenAt,
    blocker: earnBlocker({ ready, market, selected, tab, position, parsed, short, helperProblem }),
    helperProblem,
    reset: () => setRaw(''),
  }
}

/** Conditions only — never a failure, which belongs in the sheet's red row. */
function earnBlocker(input: {
  ready: boolean
  market: EarnMarketDefinition | null
  selected: EarnMarketSnapshot | null
  tab: EarnTab
  position: EarnPosition | undefined
  parsed: ReturnType<typeof parseAmountInput>
  short: boolean
  helperProblem: string | null
}): string | null {
  const { ready, market, selected, tab, position, parsed, short, helperProblem } = input
  if (!ready) return 'Unlock to continue'
  if (!appContracts().vesuEarn) return 'Not deployed'
  if (helperProblem) return 'Not available'
  if (!market || !selected) return 'Choose a market'
  if (!selected.validated) return 'Unverified market'
  // A pause refuses new money and nothing else: redeeming out of a paused market still works.
  if (tab === 'supply' && selected.paused) return 'Supply paused'
  if (tab === 'supply' && selected.blocker?.kind === 'unreadable') return 'Figures unavailable'
  if (tab === 'redeem' && (!position || position.sharesWei <= 0n)) return 'Nothing to redeem'
  if (parsed.problem) return parsed.problem
  if (parsed.wei === null || parsed.wei <= 0n) return 'Enter an amount'
  if (short) return tab === 'supply' ? 'Not enough shielded USDC' : 'More than you hold'
  return null
}

/** The quick-amount chips, scaled to the real balance. Fixed presets are dead buttons. */
export function quickAmounts(available: bigint | null, decimals: number): { label: string; value: string }[] {
  if (available === null || available <= 0n) return []
  return [
    { label: '25%', value: toPlainText(available / 4n, decimals) },
    { label: '50%', value: toPlainText(available / 2n, decimals) },
    { label: '75%', value: toPlainText((available * 3n) / 4n, decimals) },
    { label: 'Max', value: toPlainText(available, decimals) },
  ]
}
