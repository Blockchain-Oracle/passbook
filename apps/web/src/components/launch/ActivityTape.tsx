//
// The public tape — what the contracts just did, as sentences with receipts.
//
// Every row is a decoded contract event off the chain feed (`TapeItem`), which is why every row
// can carry a real transaction link: this is the market's PUBLIC history, the half the contracts
// publish on purpose. Nothing here is anyone's identity — bets and buys arrive as bearer
// commitments through the pool, and the tape renders what the chain shows everyone: that it
// happened, and how big it was.
//
// One component serves the surface's Activity tab and both detail pages: `scope` narrows the tape
// to one launch or one market, and the empty state names which nothing it is.
//
import type { TapeItem } from '@strk20/protocol/chain-feed-wire'
import type { OnChainLaunch, OnChainMarket } from '@strk20/protocol/app-reads'
import { marketQuestion, strikeDisplay } from '@strk20/protocol/app-reads'
import { toPlainText } from '@strk20/protocol/amount'
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import type { TokenInfo } from '@strk20/protocol/token-list'

import { findToken, useTokenList } from '../../shell/use-token-list'
import { Text } from '../ui/Text'

export type TapeScope =
  | { launchId: number }
  | { marketId: number }
  | { family: 'markets' | 'launch' }
  | null

function inScope(item: TapeItem, scope: TapeScope): boolean {
  if (scope === null) return true
  if ('family' in scope) {
    return scope.family === 'markets' ? 'marketId' in item : 'launchId' in item
  }
  if ('launchId' in scope) return 'launchId' in item && item.launchId === scope.launchId
  return 'marketId' in item && item.marketId === scope.marketId
}

/** The row's words. Exported for the table's tooltip use later; pure so it is testable. */
export function tapeSentence(
  item: TapeItem,
  markets: readonly OnChainMarket[],
  launches: readonly OnChainLaunch[],
  tokens: readonly TokenInfo[],
): string {
  const market = 'marketId' in item ? markets.find((m) => m.id === item.marketId) : undefined
  const launch = 'launchId' in item ? launches.find((l) => l.id === item.launchId) : undefined
  const stake = (token: string | undefined) => {
    const found = token ? findToken(tokens, token) : undefined
    return { symbol: found?.symbol ?? 'STRK', decimals: found?.decimals ?? 18 }
  }
  const marketName = market ? marketQuestion(market) : `Market #${'marketId' in item ? item.marketId : '?'}`
  const launchName = launch
    ? launch.symbol || launch.name || `Launch #${launch.id}`
    : `Launch #${'launchId' in item ? item.launchId : '?'}`

  switch (item.kind) {
    case 'market-created':
      return `New market — ${item.pair} above $${strikeDisplay(BigInt(item.strike))}`
    case 'bet': {
      // `SIDE_DOWN = 0, SIDE_UP = 1` — markets.cairo's constants, and YES is the UP side.
      const t = stake(market?.token)
      return `${toPlainText(BigInt(item.amount), t.decimals)} ${t.symbol} on ${item.side === 1 ? 'YES' : 'NO'} — ${marketName}`
    }
    case 'market-resolved':
      return `Resolved — ${marketName} · ${item.winner === 1 ? 'YES' : 'NO'} won`
    case 'market-voided':
      return `Voided — ${marketName} refunds every bet in full`
    case 'market-claim': {
      const t = stake(market?.token)
      return `A winning ticket claimed ${toPlainText(BigInt(item.amount), t.decimals)} ${t.symbol} — ${marketName}`
    }
    case 'market-cashout': {
      const t = stake(market?.token)
      return `A position cashed out for ${toPlainText(BigInt(item.amount), t.decimals)} ${t.symbol} — ${marketName}`
    }
    case 'launch-created':
      return `New launch — ${launchName} is selling`
    case 'buy': {
      const t = stake(launch?.stakeToken)
      return `${item.units} unit${item.units === 1 ? '' : 's'} of ${launchName} — ${toPlainText(BigInt(item.cost), t.decimals)} ${t.symbol}, epoch ${item.epoch + 1}`
    }
    case 'graduated':
      return `${launchName} graduated — the token is deployed`
    case 'launch-failed': {
      const t = stake(launch?.stakeToken)
      return `${launchName} missed its raise at ${toPlainText(BigInt(item.raised), t.decimals)} ${t.symbol} — refunds open`
    }
    case 'redeem':
      return `${item.units} unit${item.units === 1 ? '' : 's'} of ${launchName} redeemed for tokens`
    case 'refund': {
      const t = stake(launch?.stakeToken)
      return `${toPlainText(BigInt(item.amount), t.decimals)} ${t.symbol} reclaimed from ${launchName}`
    }
  }
}

export function ActivityTape({
  items,
  markets,
  launches,
  scope = null,
  emptyLine,
  limit = 40,
}: {
  items: readonly TapeItem[]
  markets: readonly OnChainMarket[]
  launches: readonly OnChainLaunch[]
  scope?: TapeScope
  /** The specific sentence for THIS surface's nothing — never a generic blank. */
  emptyLine: string
  limit?: number
}) {
  const { tokens } = useTokenList()
  const rows = items.filter((item) => inScope(item, scope)).slice(-limit).reverse()

  if (rows.length === 0) {
    return (
      <Text variant="body3" className="text-neutral3">
        {emptyLine}
      </Text>
    )
  }

  return (
    <ol className="m-s0 flex list-none flex-col p-s0">
      {rows.map((item) => {
        const href = voyagerTxUrl(item.txHash)
        return (
          <li
            key={`${item.txHash}:${item.kind}:${item.block}`}
            className="flex items-baseline gap-s12 border-b border-solid border-surface3 py-s8 last:border-b-0"
          >
            <Text variant="body3" className="min-w-0 flex-1 text-neutral1">
              {tapeSentence(item, markets, launches, tokens)}
            </Text>
            <span className="flex shrink-0 items-baseline gap-s8">
              <Text variant="mono" className="text-neutral3">
                block {item.block}
              </Text>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring font-mono text-mono text-neutral3 underline hover:text-neutral1"
                >
                  tx ↗
                </a>
              ) : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
