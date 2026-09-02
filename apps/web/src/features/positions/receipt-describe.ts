// How a receipt describes itself in words and numbers. Pure, so the list and the sheet agree.
import { strikeDisplay } from '@strk20/protocol/app-reads'
import { SIDE_UP } from '@strk20/protocol/market-calldata'
import { BET_SIDE_DOWN, BET_SIDE_UP } from '@strk20/protocol/markets-copy'
import type { MarketReceipt } from '@strk20/protocol/position-history'

import { positionShareOf, type PositionShare } from '@strk20/protocol/position-share'

import { formatWei, shortAddress } from '@/lib/format'
import { findToken } from '@/queries'

export type TokenList = Parameters<typeof findToken>[0]

/** The stake's unit: the snapshot's when it was captured at the bet, else the token list's, else raw units. */
export function receiptUnit(r: MarketReceipt, tokens: TokenList | undefined): { symbol: string; decimals: number | null } {
  if (r.snapshot && r.snapshot.symbol !== '') return { symbol: r.snapshot.symbol, decimals: r.snapshot.decimals }
  const info = tokens && r.token ? findToken(tokens, r.token) : undefined
  return { symbol: info?.symbol ?? (r.token ? shortAddress(r.token, 6, 3) : ''), decimals: info?.decimals ?? null }
}

/** "BTC/USD above $80,500", or the honest stand-in for a row older than history. */
export function receiptTitle(r: MarketReceipt): string {
  if (!r.snapshot) return `Market #${r.marketId} · earlier deployment`
  const strike = BigInt(r.snapshot.strike)
  return strike === 0n ? `${r.snapshot.pair} above the opening line` : `${r.snapshot.pair} above $${strikeDisplay(strike)}`
}

export function receiptSide(r: MarketReceipt): string {
  if (r.side < 0) return '—'
  return r.side === SIDE_UP ? BET_SIDE_UP : BET_SIDE_DOWN
}

export function receiptStake(r: MarketReceipt, tokens?: TokenList): string {
  if (r.cashIn === '0') return '—'
  const unit = receiptUnit(r, tokens)
  return `${formatWei(BigInt(r.cashIn), unit.decimals)} ${unit.symbol}`.trim()
}

/** The ending's amount as the chain said it, or nothing — never a computed number. */
export function receiptAmount(r: MarketReceipt, tokens?: TokenList): string | null {
  const amount = r.terminal?.amount
  if (!amount) return null
  const unit = receiptUnit(r, tokens)
  return `${formatWei(BigInt(amount), unit.decimals)} ${unit.symbol}`.trim()
}


/**
 * The share DTO for a receipt, from named scalars — the receipt is never spread. `null` unless
 * the chain has confirmed the opening (and the ending, when there is one) and the bet can be
 * described in its own unit.
 */
export function shareOf(r: MarketReceipt, tokens: TokenList | undefined): PositionShare | null {
  if (r.contract === null || r.snapshot === null || r.opening.state !== 'landed' || r.opening.txHash === null) return null
  if (r.terminal && r.terminal.kind !== 'lost' && r.terminal.txHash === null) return null
  const unit = receiptUnit(r, tokens)
  return positionShareOf({
    chainId: r.chainId,
    contract: r.contract,
    marketId: r.marketId,
    pair: r.snapshot.pair,
    side: r.side,
    cashIn: r.cashIn,
    token: r.token,
    symbol: unit.symbol,
    decimals: unit.decimals,
    strike: r.snapshot.strike,
    deadline: r.snapshot.deadline,
    commitment: r.commitment,
    openingTxHash: r.opening.txHash,
    openingBlock: r.opening.block,
    terminal: r.terminal ? { kind: r.terminal.kind, amount: r.terminal.amount, txHash: r.terminal.txHash, block: r.terminal.block } : null,
  })
}
