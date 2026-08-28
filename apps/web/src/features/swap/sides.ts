import { sameAddress } from '@strk20/protocol/address'
import type { ShieldedBalance, TokenBalance } from '@strk20/protocol/balances'
import { BRIDGE_USDC } from '@strk20/protocol/bridge'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { minimumOut, type Quote } from '@strk20/protocol/quote'
import type { TokenInfo } from '@strk20/protocol/token-list'

import type { PickableToken } from '@/components/money/token-picker'
import { formatWei, shortAddress } from '@/lib/format'
import { findToken } from '@/queries/tokens'

// Pure helpers behind the swap form: which token is on which side, what it is called, what is held.

export interface SwapSide {
  address: string
  symbol: string
  name: string
  /** `null` = unverified scale; the field then refuses a decimal amount. */
  decimals: number | null
  logoUri: string | null
}

function holdingFor(balance: ShieldedBalance | undefined, token: string): TokenBalance | undefined {
  return balance?.tokens.find((row) => sameAddress(row.token, token))
}

/** Name and scale for an address: the list first, the walk's own decimals when it has them. */
export function sideFor(address: string, list: readonly TokenInfo[] | undefined, balance: ShieldedBalance | undefined): SwapSide {
  const listed = findToken(list, address)
  const held = holdingFor(balance, address)
  return {
    address,
    symbol: listed?.symbol ?? shortAddress(address),
    name: listed?.name ?? 'Unlisted token',
    decimals: held?.decimals ?? listed?.decimals ?? null,
    logoUri: listed?.logoUri ?? null,
  }
}

/**
 * The shielded balance a sell spends. `null` while the walk has not completed or could not be
 * read. A completed walk holding no note in this token is a true zero, so it is spelled `0n`
 * here on purpose — this is the one place that is not the `?? 0n` bug.
 */
export function heldWeiFor(balance: ShieldedBalance | undefined, token: string): bigint | null {
  if (!balance || balance.presence === 'unknown') return null
  const row = holdingFor(balance, token)
  return row ? row.wei : 0n
}

/** The sell side when nothing was chosen: the first shielded holding, else STRK, never the buy token. */
export function defaultSell(balance: ShieldedBalance | undefined, buyAddress: string | null): string {
  const candidates = [...(balance?.tokens.filter((row) => row.wei > 0n).map((row) => row.token) ?? []), STRK_TOKEN, BRIDGE_USDC]
  return candidates.find((token) => buyAddress === null || !sameAddress(token, buyAddress)) ?? STRK_TOKEN
}

/** Held tokens first, each with its shielded balance in the trailing slot, then the venue's list. */
export function sellOptions(list: readonly TokenInfo[], balance: ShieldedBalance | undefined): PickableToken[] {
  const held = (balance?.tokens ?? []).filter((row) => row.wei > 0n)
  const heldRows: PickableToken[] = held.map((row) => {
    const side = sideFor(row.token, list, balance)
    return { ...side, trailing: `${formatWei(row.wei, row.decimals)} shielded` }
  })
  const rest = list
    .filter((token) => !held.some((row) => sameAddress(row.token, token.address)))
    .map((token) => ({ address: token.address, symbol: token.symbol, name: token.name, logoUri: token.logoUri, decimals: token.decimals }))
  return [...heldRows, ...rest]
}

export function buyOptions(list: readonly TokenInfo[]): PickableToken[] {
  return list.map((token) => ({ address: token.address, symbol: token.symbol, name: token.name, logoUri: token.logoUri, decimals: token.decimals }))
}

/** `1 SELL = rate BUY`, in the buy token's smallest unit. Exact bigint; `null` without a sell scale. */
export function rateWei(quote: Quote, sellDecimals: number | null): bigint | null {
  if (sellDecimals === null || quote.sellAmount <= 0n) return null
  return (quote.buyAmount * 10n ** BigInt(sellDecimals)) / quote.sellAmount
}

/** `minimumOut` refuses a zero floor by throwing; the form wants the sentence, not the exception. */
export function floorFor(buyAmount: bigint, slippageBps: number): { wei: bigint } | { problem: string } {
  try {
    return { wei: minimumOut(buyAmount, slippageBps) }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : 'The minimum output could not be computed.' }
  }
}

/** The quote's own USD marks, as a fraction the impact row can colour. */
export function impactTone(impact: number | null): 'quiet' | 'exposed' | 'irreversible' {
  if (impact === null || impact < 0.01) return 'quiet'
  return impact >= 0.05 ? 'irreversible' : 'exposed'
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`
}

export function routeLabel(quote: Quote): string | null {
  if (quote.routes.length === 0) return null
  return quote.routes
    .map((route) => (route.percent < 1 ? `${route.name} ${Math.round(route.percent * 100)}%` : route.name))
    .join(' · ')
}
