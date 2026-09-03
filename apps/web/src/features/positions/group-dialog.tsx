//
// One position, opened: the claims inside it, each with its own door.
//
// The row above collapses nine claims into a count because that is what you want at a glance. This
// is where the nine live, and it is the only place they are enumerated — a list of nine on the main
// surface is the log this whole rebuild removed.
//
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, ChevronDown } from 'lucide-react'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { explorerTx, shortAddress } from '@/lib/format'
import { removeStoredPosition } from '@/queries/positions'

import { LifecycleNote } from './lifecycle-note'
import { DOOR_VERB, settleDoor, type SettleDoor } from './settle'
import type { Claim, PositionGroup } from './types'

/** The venue this position lives in, named the way people say it. Not `kicker.toLowerCase()`. */
const OPEN_LABEL: Record<PositionGroup['venue'], string> = {
  market: 'Open the market',
  launch: 'Open the token',
  governance: 'Open the DAO',
  earn: 'Open Earn',
}

export interface GroupDialogProps {
  group: PositionGroup | null
  onOpenChange: (open: boolean) => void
  onSettle: (claim: Claim, door: SettleDoor) => void
}

function ClaimRow({ claim, onSettle }: { claim: Claim; onSettle: (claim: Claim, door: SettleDoor) => void }) {
  const door = settleDoor(claim)
  const { position, life } = claim
  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0 gap-1">
        <ItemTitle className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate">{position.label ?? `Claim ${shortAddress(position.commitment, 6, 4)}`}</span>
          <Badge variant={life.tone === 'ready' ? 'default' : life.tone === 'waiting' ? 'secondary' : 'outline'}>{life.label}</Badge>
        </ItemTitle>
        {claim.pending ? <Skeleton className="h-4 w-40" /> : null}
        {claim.failed ? <ItemDescription className="text-irreversible">This claim could not be read from the chain.</ItemDescription> : null}
        {door ? (
          <ItemDescription>
            {door === 'cashout' ? 'Sells back for ' : 'Pays '}
            <Amount wei={life.amount} decimals={claim.payout.decimals} symbol={claim.payout.symbol} size="sm" />
          </ItemDescription>
        ) : life.detail ? (
          <ItemDescription>{life.detail}</ItemDescription>
        ) : null}
        {position.txHash ? (
          <a
            href={explorerTx(position.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 font-mono text-mono text-accent1"
          >
            opened {shortAddress(position.txHash, 6, 4)}
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        ) : null}
      </ItemContent>
      <ItemActions>
        {door ? (
          <Button size="sm" onClick={() => onSettle(claim, door)}>
            {DOOR_VERB[door]}
          </Button>
        ) : life.tone === 'settled' ? (
          // A finished claim is a dead secret. Forgetting it is the only thing left to do with it.
          <Button size="sm" variant="ghost" onClick={() => void removeStoredPosition(position.commitment)}>
            Forget
          </Button>
        ) : null}
      </ItemActions>
    </Item>
  )
}

export function GroupDialog({ group, onOpenChange, onSettle }: GroupDialogProps) {
  const ready = group?.claims.filter((c) => settleDoor(c) !== null) ?? []
  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col gap-4 sm:max-w-lg">
        {group ? (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <DialogTitle className="font-display text-display4 uppercase">{group.title}</DialogTitle>
                {/* The door to the venue itself, at the top where it is looked for — it used to sit
                    at the bottom of the modal reading "Open the dao". */}
                {group.href ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    render={<Link to={group.href.to} params={{ id: group.href.id }} />}
                  >
                    {OPEN_LABEL[group.venue]}
                    <ArrowUpRight data-icon="inline-end" aria-hidden />
                  </Button>
                ) : null}
              </div>
              <DialogDescription>
                {group.kicker}
                {group.clock ? ` · ${group.clock}` : ''} · {group.claims.length} claim{group.claims.length === 1 ? '' : 's'}
              </DialogDescription>
            </DialogHeader>

            {group.claimable.length > 0 ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-accent1/40 bg-accent2 px-3 py-2">
                <span className="text-kicker uppercase text-accent1">Ready to collect</span>
                <span className="flex flex-wrap gap-x-3 font-mono tabular-nums">
                  {group.claimable.map((c) => (
                    <Amount key={c.symbol} wei={c.wei} decimals={c.decimals} symbol={c.symbol} />
                  ))}
                </span>
              </div>
            ) : null}

            <ItemGroup className="min-h-0 flex-1 gap-2 overflow-y-auto">
              {group.claims.map((claim) => (
                <ClaimRow key={claim.position.commitment} claim={claim} onSettle={onSettle} />
              ))}
            </ItemGroup>

            {/* Folded, per the one-screen rule: the explanation is there when wanted, never in the way. */}
            <Collapsible>
              <CollapsibleTrigger
                render={
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    How a claim works
                    <ChevronDown className="size-4" aria-hidden />
                  </Button>
                }
              />
              <CollapsibleContent>
                <LifecycleNote venue={group.venue} />
              </CollapsibleContent>
            </Collapsible>

            {ready.length > 1 ? (
              // The review that opens covers every ready claim at once when they share a door.
              <p className="text-body4 text-muted-foreground">{ready.length} ready — settling one offers all of them.</p>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
