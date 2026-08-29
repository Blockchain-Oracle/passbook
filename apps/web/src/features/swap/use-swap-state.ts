import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { sameAddress } from '@strk20/protocol/address'
import { insufficient, parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { degradedCopy, degradedFromHealth } from '@strk20/protocol/degraded'
import { DEFAULT_SLIPPAGE_BPS, priceImpact, type Quote } from '@strk20/protocol/quote'
import { byLiquidity } from '@strk20/protocol/token-list'

import { useSession } from '@/app/session'
import { poolHealthQuery } from '@/queries/pool'
import { shieldedBalanceQuery, shieldedQuery } from '@/queries/shielded'
import { tokenListQuery } from '@/queries/tokens'
import { useDebounced } from '@/hooks/use-debounced'
import { quoteIsLive, swapQuoteQuery } from './queries'
import { buyOptions, defaultSell, floorFor, heldWeiFor, sellOptions, sideFor, type SwapSide } from './sides'

const QUOTE_DEBOUNCE_MS = 350

export type WalkState = 'pending' | 'walked' | 'unreachable'

export interface SwapSeed {
  /** Preselected sides, e.g. `/swap?buy=0x…` from a token page. */
  sell?: string
  buy?: string
}

/** Everything the swap surface renders from, in one hook. Reads are queries; the rest is form state. */
export function useSwapState(seed: SwapSeed = {}) {
  const session = useSession()
  const ready = session.status === 'ready'
  const address = ready ? session.address : undefined
  const accountKey = ready ? session.accountKey : undefined

  const tokens = useQuery(tokenListQuery())
  const balance = useQuery(shieldedBalanceQuery(address, accountKey))
  const walk = useQuery(shieldedQuery(address, accountKey))
  const health = useQuery(poolHealthQuery())

  const [sellAddress, setSellAddress] = useState<string | null>(seed.sell ?? null)
  const [buyAddress, setBuyAddress] = useState<string | null>(seed.buy ?? null)
  const [raw, setRaw] = useState('')
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS)

  const list = useMemo(() => byLiquidity(tokens.data ?? []), [tokens.data])
  const sellToken = sellAddress ?? defaultSell(balance.data, buyAddress)
  const sell = sideFor(sellToken, tokens.data, balance.data)
  const buy = buyAddress ? sideFor(buyAddress, tokens.data, balance.data) : null
  const heldWei = heldWeiFor(balance.data, sell.address)

  const parsed = parseAmountInput(raw, sell.decimals)
  const short = insufficient(parsed.wei, heldWei)
  const shortfallWei = short && parsed.wei !== null && heldWei !== null ? parsed.wei - heldWei : null

  const ask = { sellToken: sell.address, buyToken: buy?.address ?? null, sellAmount: useDebounced(parsed.wei, QUOTE_DEBOUNCE_MS) }
  const quoteQuery = useQuery(swapQuoteQuery(ask))
  const live = quoteIsLive(ask)
  const result = live ? quoteQuery.data : undefined
  // A kept-previous quote for another pair is not this pair's price.
  const quoted: Quote | null =
    result?.state === 'quoted' &&
    buy !== null &&
    sameAddress(result.quote.sellToken, sell.address) &&
    sameAddress(result.quote.buyToken, buy.address)
      ? result.quote
      : null
  const refreshing = live && (quoteQuery.isPlaceholderData || (quoteQuery.isFetching && quoted !== null))
  const floor = quoted ? floorFor(quoted.buyAmount, slippageBps) : null
  const minOutWei = floor && 'wei' in floor ? floor.wei : null
  const impact = quoted ? priceImpact(quoted) : null

  const walkState: WalkState = walk.data ? (walk.data.state === 'walked' ? 'walked' : 'unreachable') : 'pending'

  const poolBlocker = (() => {
    if (!health.data) return null
    const reading = degradedFromHealth(health.data, typeof navigator === 'undefined' ? true : navigator.onLine, false)
    return reading.mode ? degradedCopy(reading.mode).blocker : null
  })()

  const blocker: string | null = (() => {
    if (session.status === 'booting') return 'Opening your account'
    if (session.status === 'no-storage') return session.reason ?? 'This browser cannot keep an account'
    if (session.status === 'fresh') return 'This browser has no account yet'
    if (session.status === 'locked') return 'Unlock your account first'
    if (poolBlocker) return poolBlocker
    if (walkState === 'pending') return 'Reading your balance'
    if (walkState === 'unreachable') return 'Your balance could not be read'
    if (tokens.isPending) return 'Loading assets'
    if (tokens.isError) return 'Asset list unavailable'
    if (!buy) return 'Select an asset'
    if (parsed.problem) return parsed.problem
    if (parsed.wei === null || parsed.wei === 0n) return 'Enter an amount'
    if (short) return `Not enough shielded ${sell.symbol}`
    if (!result) return 'Finding the best price'
    if (result.state !== 'quoted') return result.because
    if (!quoted) return 'Refreshing quote…'
    if (floor && 'problem' in floor) return floor.problem
    return null
  })()

  /** The one-line status under the buy card: what the price is, or why there is none yet. */
  const status: string | null = (() => {
    if (parsed.problem) return parsed.problem
    if (!buy || parsed.wei === null || parsed.wei === 0n) return null
    if (!result) return 'Getting live quote…'
    if (result.state !== 'quoted') return result.because
    if (refreshing) return 'Refreshing quote…'
    return null
  })()

  const chooseSell = (next: string) => {
    setSellAddress(next)
    // The same token on both sides is not a swap: the other side clears.
    if (buyAddress && sameAddress(buyAddress, next)) setBuyAddress(null)
  }
  const chooseBuy = (next: string) => {
    setBuyAddress(next)
    if (sameAddress(sell.address, next)) setSellAddress(null)
  }
  /** Direction flips; the typed amount stays, now in the other token. */
  const flip = () => {
    if (!buy) return
    setSellAddress(buy.address)
    setBuyAddress(sell.address)
  }
  const setMax = heldWei !== null && sell.decimals !== null ? () => setRaw(toPlainText(heldWei, sell.decimals!)) : undefined

  return {
    ready,
    address,
    sell,
    buy,
    heldWei,
    raw,
    setRaw,
    setMax,
    parsed,
    short,
    shortfallWei,
    quoted,
    refreshing,
    minOutWei,
    impact,
    slippageBps,
    setSlippageBps,
    walkState,
    blocker,
    status,
    tokensLoading: tokens.isPending,
    sellOptions: useMemo(() => sellOptions(list, balance.data), [list, balance.data]),
    buyOptions: useMemo(() => buyOptions(list), [list]),
    chooseSell,
    chooseBuy,
    flip,
    reset: () => setRaw(''),
  }
}

export type { SwapSide }
