import type { ReactNode } from 'react'
import { ArrowLeftRight, Eye, ShieldCheck } from 'lucide-react'
import type { Confidence } from '@strk20/protocol/amount'

import { Amount } from '@/components/money/amount'
import { AssetIdentity, type AssetBoundary } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent } from '@/components/ui/item'
import { cn } from '@/lib/utils'

export interface BalanceRow {
  token: string
  symbol: string
  name?: string | null
  logoUri?: string | null
  /** `null` = read failed, `undefined` = not read yet. Never 0 for unknown. */
  wei: bigint | null | undefined
  decimals: number | null
  confidence?: Confidence
}

export interface BalanceCardProps {
  rows: readonly BalanceRow[]
  /** Kicker under the badge — e.g. "as of block 1,234,567" or "no activity yet". */
  headline?: ReactNode
  actions?: ReactNode
  /** Rendered instead of rows while the first read is still out. */
  loading?: ReactNode
  className?: string
}

interface CardChrome {
  boundary: AssetBoundary
  kind: 'shielded' | 'publicEntry'
  title: string
  ring: string
  emptyTitle: string
  emptyBody: string
  Icon: typeof ShieldCheck
}

const CHROME: Record<AssetBoundary, CardChrome> = {
  shielded: {
    boundary: 'shielded',
    kind: 'shielded',
    title: 'Shielded',
    ring: 'border-shielded',
    emptyTitle: 'Nothing shielded yet',
    emptyBody: 'Money that crosses into the pool shows up here as notes.',
    Icon: ShieldCheck,
  },
  public: {
    boundary: 'public',
    kind: 'publicEntry',
    title: 'Public',
    ring: 'border-dashed border-public',
    emptyTitle: 'Nothing public',
    emptyBody: 'Tokens sent to your Starknet address show up here.',
    Icon: Eye,
  },
}

function BalanceCard({ chrome, rows, headline, actions, loading, className }: BalanceCardProps & { chrome: CardChrome }) {
  return (
    <Card className={cn('border-2', chrome.ring, className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-display4 uppercase">
          <chrome.Icon className="size-5" aria-hidden />
          {chrome.title}
        </CardTitle>
        {headline ? <p className="text-body4 text-muted-foreground">{headline}</p> : null}
        <CardAction>
          <BoundaryBadge kind={chrome.kind} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {loading ? (
          loading
        ) : rows.length === 0 ? (
          <Empty className="py-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <chrome.Icon />
              </EmptyMedia>
              <EmptyTitle>{chrome.emptyTitle}</EmptyTitle>
              <EmptyDescription>{chrome.emptyBody}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          rows.map((row) => (
            <Item key={row.token} size="sm" className="px-0">
              <ItemContent>
                <AssetIdentity symbol={row.symbol} name={row.name} logoUri={row.logoUri} boundary={chrome.boundary} chip={false} />
              </ItemContent>
              <ItemActions>
                <Amount wei={row.wei} decimals={row.decimals} symbol={row.symbol} confidence={row.confidence} size="lg" />
              </ItemActions>
            </Item>
          ))
        )}
      </CardContent>
      {actions ? <CardFooter className="flex flex-wrap gap-2">{actions}</CardFooter> : null}
    </Card>
  )
}

/** Pool notes, per token. Never summed across tokens, never summed with the public side. */
export function ShieldedCard(props: BalanceCardProps) {
  return <BalanceCard chrome={CHROME.shielded} {...props} />
}

/** ERC-20 balances on the account address. */
export function PublicCard(props: BalanceCardProps) {
  return <BalanceCard chrome={CHROME.public} {...props} />
}

export interface CrossingRailProps {
  /** The crossing verbs: Shield (public → shielded), Withdraw / Bridge (shielded → public). */
  actions: ReactNode
  className?: string
}

/**
 * The dashed gutter between the two cards. A vertical column between the cards on desktop; on a
 * phone, a band between the stacked cards with the four doors in a two-by-two grid.
 */
export function CrossingRail({ actions, className }: CrossingRailProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-y border-dashed border-border py-3',
        'md:w-28 md:items-center md:justify-center md:border-x md:border-y-0 md:py-6',
        className,
      )}
    >
      <div className="flex items-center justify-center gap-2 md:flex-col md:gap-3">
        <ArrowLeftRight className="size-4 text-muted-foreground md:rotate-90" aria-hidden />
        <span className="text-kicker uppercase text-muted-foreground md:[writing-mode:vertical-rl]">Cross the boundary</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-col">{actions}</div>
    </div>
  )
}
