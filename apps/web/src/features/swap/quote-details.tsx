import type { Quote } from '@strk20/protocol/quote'

import { Amount } from '@/components/money/amount'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatPercent, impactTone, rateWei, routeLabel, type SwapSide } from './sides'
import { SlippagePopover, slippageLabel } from './slippage-popover'

const TONE_CLASS = { quiet: 'text-foreground', exposed: 'text-exposed', irreversible: 'text-irreversible' } as const

export interface QuoteDetailsProps {
  sell: SwapSide
  buy: SwapSide | null
  quote: Quote | null
  minOutWei: bigint | null
  impact: number | null
  slippageBps: number
  onSlippage: (bps: number) => void
  /** Live pool fee from `readPoolConstants`; `undefined` while reading, `null` when unread. */
  feeWei: bigint | null | undefined
  refreshing: boolean
}

/** The measurement the review will be judged against. Rows read `—` until the venue has spoken. */
export function QuoteDetails({ sell, buy, quote, minOutWei, impact, slippageBps, onSlippage, feeWei, refreshing }: QuoteDetailsProps) {
  const rate = quote ? rateWei(quote, sell.decimals) : null
  const route = quote ? routeLabel(quote) : null
  const tone = TONE_CLASS[impactTone(impact)]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-kicker uppercase text-muted-foreground">Quote</CardTitle>
        <CardAction>
          <SlippagePopover slippageBps={slippageBps} onChange={onSlippage} />
        </CardAction>
      </CardHeader>
      <CardContent className={cn(refreshing && 'opacity-70 transition-opacity')}>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">Rate</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {rate !== null && buy ? (
                  <>
                    1 {sell.symbol} = <Amount wei={rate} decimals={buy.decimals} symbol={buy.symbol} size="sm" />
                  </>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Price impact</TableCell>
              <TableCell className={cn('text-right font-mono tabular-nums', tone)}>{impact === null ? '—' : formatPercent(impact)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Minimum received</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                <Amount wei={minOutWei} decimals={buy?.decimals ?? null} symbol={buy?.symbol} size="sm" />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Slippage</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{slippageLabel(slippageBps)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Route</TableCell>
              <TableCell className="text-right">{route ?? '—'}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Pool fee</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                <Amount wei={feeWei} decimals={18} symbol="STRK" size="sm" />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">Gas, venue estimate</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                <Amount wei={quote?.gasFeesWei} decimals={18} size="sm" />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
