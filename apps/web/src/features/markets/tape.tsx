import { ExternalLink } from 'lucide-react'
import { marketQuestion, strikeDisplay, type OnChainMarket } from '@strk20/protocol/app-reads'
import type { TapeItem } from '@strk20/protocol/chain-feed-wire'

import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@/components/ui/item'
import { explorerTx, formatWei } from '@/lib/format'
import { sideLabel } from './market-card'

export type MarketTapeItem = Extract<TapeItem, { marketId: number }>

export interface TapeProps {
  items: readonly TapeItem[]
  markets: readonly OnChainMarket[]
  /** Narrow to one market; absent = the whole markets family. */
  marketId?: number
  symbol: string
  decimals: number | null
  emptyLine: string
  limit?: number
}

export function isMarketItem(item: TapeItem): item is MarketTapeItem {
  return 'marketId' in item
}

/** The public tape as sentences. Sizes and odds are what the chain shows everyone. */
export function tapeSentence(item: MarketTapeItem, markets: readonly OnChainMarket[], symbol: string, decimals: number | null): string {
  const market = markets.find((m) => m.id === item.marketId)
  const name = market ? marketQuestion(market) : `Market #${item.marketId}`
  const money = (raw: string) => `${formatWei(BigInt(raw), decimals)} ${symbol}`
  switch (item.kind) {
    case 'market-created':
      return `New market — ${item.pair} above $${strikeDisplay(BigInt(item.strike))}`
    case 'bet':
      return `${money(item.amount)} on ${sideLabel(item.side)} — ${name}`
    case 'market-resolved':
      return `Resolved — ${name} · ${sideLabel(item.winner)} won`
    case 'market-voided':
      return `Voided — ${name} refunds every bet in full`
    case 'market-claim':
      return `A winning ticket claimed ${money(item.amount)} — ${name}`
    case 'market-cashout':
      return `A position cashed out for ${money(item.amount)} — ${name}`
  }
}

export function Tape({ items, markets, marketId, symbol, decimals, emptyLine, limit = 12 }: TapeProps) {
  const rows = items
    .filter(isMarketItem)
    .filter((item) => marketId === undefined || item.marketId === marketId)
    .slice(-limit)
    .reverse()

  if (rows.length === 0) return <p className="text-body4 text-muted-foreground">{emptyLine}</p>

  return (
    <ItemGroup className="gap-0 divide-y">
      {rows.map((item) => (
        <Item key={`${item.txHash}:${item.kind}:${item.block}`} size="sm" className="rounded-none px-0">
          <ItemContent>
            <ItemTitle className="text-body3 font-normal">{tapeSentence(item, markets, symbol, decimals)}</ItemTitle>
          </ItemContent>
          <ItemActions className="shrink-0 gap-2 font-mono text-mono text-muted-foreground">
            <span>block {item.block}</span>
            <a href={explorerTx(item.txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
              tx <ExternalLink className="size-3" aria-hidden />
            </a>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}
