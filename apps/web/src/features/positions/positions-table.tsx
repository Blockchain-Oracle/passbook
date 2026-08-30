//
// One row per POSITION, not per claim.
//
// Nine buys on one launch used to be nine cards that said the same thing nine times. They are one
// row now, and the nine live inside it — the count is a fact about the row, not nine rows.
//
// A table on a wide screen and cards on a narrow one: the same data twice rather than a table that
// scrolls sideways, because a horizontal scrollbar is where a settle button goes to hide.
//
import { ChevronRight } from 'lucide-react'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

import type { Claimable, PositionGroup } from './types'

const TONE_LABEL = { ready: 'Ready', waiting: 'Running', settled: 'Finished' } as const

function Status({ group }: { group: PositionGroup }) {
  // Accent scarcity: only a row you can act on carries the accent.
  return <Badge variant={group.tone === 'ready' ? 'default' : group.tone === 'waiting' ? 'secondary' : 'outline'}>{TONE_LABEL[group.tone]}</Badge>
}

/** The money side. `—` when there is nothing open, because zero would be a claim about the payout. */
function Waiting({ claimable }: { claimable: readonly Claimable[] }) {
  if (claimable.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-col items-end gap-0.5">
      {claimable.map((c) => (
        <Amount key={c.symbol} wei={c.wei} decimals={c.decimals} symbol={c.symbol} size="sm" />
      ))}
    </span>
  )
}

function claimLine(group: PositionGroup): string {
  const claims = `${group.claims.length} claim${group.claims.length === 1 ? '' : 's'}`
  return group.ready > 0 ? `${claims} · ${group.ready} ready` : claims
}

export interface GroupListProps {
  groups: readonly PositionGroup[]
  onOpen: (group: PositionGroup) => void
}

function ActionLabel({ group }: { group: PositionGroup }) {
  return <>{group.tone === 'ready' ? 'Settle' : 'View'}</>
}

/** Wide screens: five columns, the money right-aligned and monospaced so it can be compared. */
function GroupTable({ groups, onOpen }: GroupListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-kicker uppercase">Position</TableHead>
          <TableHead className="text-kicker uppercase">Holdings</TableHead>
          <TableHead className="text-right text-kicker uppercase">Waiting for you</TableHead>
          <TableHead className="text-kicker uppercase">Status</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <TableRow key={group.key} className="cursor-pointer" onClick={() => onOpen(group)}>
            <TableCell className="max-w-xs">
              <span className="flex flex-col gap-0.5">
                <span className="truncate font-medium">{group.title}</span>
                <span className="text-body4 text-muted-foreground">
                  {group.kicker}
                  {group.clock ? ` · ${group.clock}` : ''}
                </span>
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap text-body4">{claimLine(group)}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              <Waiting claimable={group.claimable} />
            </TableCell>
            <TableCell>
              <Status group={group} />
            </TableCell>
            <TableCell className="text-right">
              {/* The row is clickable too; the button must not open it twice. */}
              <Button
                size="sm"
                variant={group.tone === 'ready' ? 'default' : 'outline'}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(group)
                }}
              >
                <ActionLabel group={group} />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Narrow screens: the same five facts stacked, with the action on the headline row. */
function GroupCards({ groups, onOpen }: GroupListProps) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <button
          key={group.key}
          type="button"
          onClick={() => onOpen(group)}
          className={cn(
            'flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-raisedHovered',
            group.tone === 'ready' && 'border-accent1/40',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{group.title}</span>
              <span className="text-body4 text-muted-foreground">
                {group.kicker}
                {group.clock ? ` · ${group.clock}` : ''}
              </span>
            </div>
            <Status group={group} />
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-kicker uppercase text-muted-foreground">Holdings</span>
              <span className="text-body4">{claimLine(group)}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-kicker uppercase text-muted-foreground">Waiting for you</span>
              <span className="font-mono tabular-nums">
                <Waiting claimable={group.claimable} />
              </span>
            </div>
            <ChevronRight className="mb-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </div>
        </button>
      ))}
    </div>
  )
}

/**
 * The switch is a CONTAINER query, not a viewport one: this list sits inside the sidebar inset,
 * so the window being 1100px wide says nothing about how much room the table actually has.
 */
export function PositionsList({ groups, onOpen }: GroupListProps) {
  return (
    <div className="@container">
      <div className="hidden overflow-x-auto rounded-xl border bg-card @3xl:block">
        <GroupTable groups={groups} onOpen={onOpen} />
      </div>
      <div className="@3xl:hidden">
        <GroupCards groups={groups} onOpen={onOpen} />
      </div>
    </div>
  )
}
