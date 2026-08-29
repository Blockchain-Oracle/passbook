import type { ReactNode } from 'react'
import type { Disclosure } from '@strk20/protocol/disclosure'

import type { BoundaryKind } from '@/app/boundary'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { DisclosurePanelView } from '@/components/privacy/disclosure-panel'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'

export interface ReviewRow {
  label: string
  value: ReactNode
}

export interface ReviewSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  boundary: BoundaryKind
  rows: readonly ReviewRow[]
  disclosure?: Disclosure | null
  onWayOut?: () => void
  confirmLabel: string
  onConfirm: () => void
  busy?: boolean
  /** Why confirm is blocked. The CTA stays enabled but says this instead (never `disabled`). */
  blocker?: string | null
  /** What went wrong on the last confirm, in the caller's words. Shown above the CTA so a refusal is never silent. */
  problem?: string | null
  children?: ReactNode
}

/** The one review surface for send, shield, swap, bridge and bets. */
export function ReviewSheet({
  open,
  onOpenChange,
  title,
  description,
  boundary,
  rows,
  disclosure,
  onWayOut,
  confirmLabel,
  onConfirm,
  busy = false,
  blocker,
  problem,
  children,
}: ReviewSheetProps) {
  const blocked = busy || Boolean(blocker)
  return (
    <Sheet open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <SheetContent side="right" className="w-full sm:max-w-md" showCloseButton={!busy}>
        <SheetHeader className="gap-2">
          <BoundaryBadge kind={boundary} className="w-fit" />
          <SheetTitle className="font-display text-display3 uppercase">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4">
          <Table>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="text-muted-foreground">{row.label}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {children}
          {disclosure ? <DisclosurePanelView panel={disclosure} onWayOut={onWayOut} /> : null}
          {problem ? (
            <p role="alert" className="rounded-lg border border-irreversible/40 bg-irreversibleTint px-3 py-2 text-body4 text-irreversible">
              {problem}
            </p>
          ) : null}
        </div>
        <SheetFooter>
          <Button
            size="lg"
            aria-disabled={blocked || undefined}
            onClick={() => {
              if (!blocked) onConfirm()
            }}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {blocker ?? confirmLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
