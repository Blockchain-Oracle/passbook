import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, ChevronRight, ExternalLink } from 'lucide-react'
import { CHECK_ON_VOYAGER } from '@strk20/protocol/activity-copy'
import { AMOUNT_UNREADABLE_WHY } from '@strk20/protocol/history-copy'
import {
  activityRowModel,
  amountDirection,
  rightSlot,
  rowAmountWei,
  type RightSlot,
  type Transaction,
} from '@strk20/protocol/transaction'

import { Amount } from '@/components/money/amount'
import { IdentityAvatar } from '@/components/money/identity-avatar'
import { Badge } from '@/components/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Identity } from '@/queries/identity'
import type { WalletToken } from './rows'

const CHIP_CLASS = {
  neutral: 'border-border text-muted-foreground',
  settled: 'border-settled text-settled',
  exposed: 'border-exposed text-exposed',
  quiet: 'border-transparent text-muted-foreground',
} as const

/** The right edge: block ↔ spinner ↔ still ring ↔ failed ↔ not-indexed. One slot, five contents. */
function Slot({ slot }: { slot: RightSlot }) {
  switch (slot.kind) {
    case 'block':
      return <span className="font-mono text-mono text-muted-foreground">{slot.text}</span>
    case 'spinner':
      return (
        <span className="inline-flex items-center gap-1 text-body4 text-muted-foreground">
          <Spinner className="size-3" />
          {slot.text}
        </span>
      )
    case 'static-ring':
      // A still ring: the clock runs, nothing is stuck. Never animated — nothing is being watched.
      return (
        <span className="inline-flex items-center gap-1 text-body4 text-muted-foreground">
          <span className="size-3 rounded-full border-2 border-settled" aria-hidden />
          {slot.text}
        </span>
      )
    case 'failed':
      return (
        <span className={cn('inline-flex items-center gap-1 text-body4', slot.retryable ? 'text-exposed' : 'text-muted-foreground')}>
          <AlertTriangle className="size-3" aria-hidden />
          {slot.retryable ? 'Stopped' : 'Refused'}
        </span>
      )
    case 'not-indexed':
      return slot.href ? (
        <a
          href={slot.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-body4 underline"
        >
          {CHECK_ON_VOYAGER}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : (
        <span className="text-body4 text-muted-foreground">Not indexed</span>
      )
  }
}

export interface ActivityRowProps {
  transaction: Transaction
  /** The clock, passed in — `rightSlot` never reads it. */
  now: number
  tokens: readonly WalletToken[]
  /** The counterparty's directory identity, resolved once for the page. */
  identity?: Identity
}

/**
 * The counterparty, as a person rather than 66 characters of hex.
 *
 * `activityRowModel` puts the raw address in the subtitle, which on a phone was the row's whole
 * width. A face and a handle say more in a third of the space, and the address stays legible
 * underneath when the directory has no name for it.
 */
function Counterparty({ address, identity }: { address: string; identity: Identity | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <IdentityAvatar address={address} name={identity?.name} avatar={identity?.avatar} size="sm" />
      {identity?.name ? (
        <span className="truncate">@{identity.name}</span>
      ) : (
        <span className="truncate font-mono text-mono">{shortAddress(address, 8, 6)}</span>
      )}
    </span>
  )
}

/**
 * One row of the record. The whole row is the door to its receipt — hover lifts it, a chevron says
 * so. A `role="link"` div rather than an anchor, so the slot's explorer link stays valid inside it.
 */
export function ActivityRow({ transaction, now, tokens, identity }: ActivityRowProps) {
  const model = activityRowModel(transaction, now)
  const slot = rightSlot(transaction, now)
  const wei = rowAmountWei(transaction)
  const direction = amountDirection(transaction)
  const token = transaction.chain.state === 'settled' ? transaction.chain.entry.token : null
  // The model puts the counterparty in the subtitle; when that is what it is, render it as one.
  const counterparty = transaction.chain.state === 'settled' ? transaction.chain.entry.counterparty : null
  const subtitleIsCounterparty = counterparty !== null && model.subtitle === counterparty
  const known = token ? tokens.find((row) => sameFelt(row.token, token)) : undefined
  const navigate = useNavigate()
  const openReceipt = () => void navigate({ to: '/activity/$id', params: { id: transaction.id } })

  return (
    <Item
      variant="outline"
      size="sm"
      role="link"
      tabIndex={0}
      onClick={openReceipt}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openReceipt()
        }
      }}
      className="group/row cursor-pointer gap-3 hover:border-primary/60 hover:bg-muted"
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="flex flex-wrap items-center gap-2">
          <span className="truncate group-hover/row:underline">{model.title}</span>
          {model.badge ? (
            <Badge variant="outline" className={cn(CHIP_CLASS[model.badge.status], model.badge.notYetReal && 'border-dashed')}>
              {model.badge.label}
            </Badge>
          ) : null}
          {model.tag ? <Badge variant="secondary">{model.tag}</Badge> : null}
        </ItemTitle>
        {subtitleIsCounterparty ? (
          <ItemDescription className="min-w-0">
            <Counterparty address={counterparty} identity={identity} />
          </ItemDescription>
        ) : model.subtitle ? (
          <ItemDescription className={cn('truncate', model.subtitleIsMono && 'font-mono text-mono')}>{model.subtitle}</ItemDescription>
        ) : null}
      </ItemContent>
      {/* A fixed column, so amounts line up down the page instead of jittering with the label beside them. */}
      <ItemActions className="w-24 shrink-0 flex-col items-end gap-0.5 @sm:w-36">
        {transaction.chain.state === 'settled' && direction !== 'none' ? (
          wei === null ? (
            <Tooltip>
              <TooltipTrigger render={<span className="font-mono text-body3 text-muted-foreground" />}>—</TooltipTrigger>
              <TooltipContent>{AMOUNT_UNREADABLE_WHY}</TooltipContent>
            </Tooltip>
          ) : (
            <span className={cn('inline-flex items-center', direction === 'in' ? 'text-settled' : 'text-foreground')}>
              <span className="font-mono text-body3">{direction === 'in' ? '+' : '−'}</span>
              <Amount wei={wei} decimals={known?.decimals ?? null} symbol={known?.symbol} />
            </span>
          )
        ) : null}
        <Slot slot={slot} />
      </ItemActions>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-primary" aria-hidden />
    </Item>
  )
}

function sameFelt(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}
