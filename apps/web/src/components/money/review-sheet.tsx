import type { ReactNode } from 'react'
import type { Disclosure } from '@strk20/protocol/disclosure'

import type { BoundaryKind } from '@/app/boundary'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { OperationPipeline } from '@/components/money/operation-pipeline'
import { DisclosurePanelView } from '@/components/privacy/disclosure-panel'
import { usePipeline } from '@/mutations/pipeline-store'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'

export interface ReviewRow {
  label: string
  value: ReactNode
}

/** Past this many characters a blocker is an explanation, not a button label. */
const CTA_MAX = 32

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
  // A blocker is a SENTENCE when it explains a standing condition ("this deployment is read-only
  // until…") and a PHRASE when it names a missing input ("Enter an amount"). Both were being
  // rendered as the button's label, so the explaining kind produced a paragraph inside a CTA that
  // read as breakage. Long ones move to a line above the button; the CTA stays a few words.
  const explained = blocker && blocker.length > CTA_MAX ? blocker : null
  const label = explained ? 'Not available' : (blocker ?? confirmLabel)
  // Every venue that submits does it behind this sheet, and the app allows exactly one pipeline at a
  // time (`use-send`, `use-direct-invoke`). So a BUSY sheet's live pipeline is necessarily its own,
  // and drawing it here gives markets, launch and houses the same prove/relay/confirm run that send
  // and shield had — without nine copies of the same block, which is how they came to be missing.
  const pipeline = usePipeline()
  const running = busy ? pipeline : null
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
          {running ? (
            <OperationPipeline
              stages={running.stages}
              reached={running.reached}
              failedAt={running.failedAt}
              replaced={running.replaced}
              startedAt={running.startedAt}
            />
          ) : null}
          {children}
          {disclosure ? <DisclosurePanelView panel={disclosure} onWayOut={onWayOut} /> : null}
          {problem ? (
            <p role="alert" className="rounded-lg border border-irreversible/40 bg-irreversibleTint px-3 py-2 text-body4 text-irreversible">
              {problem}
            </p>
          ) : null}
        </div>
        <SheetFooter className="flex-col items-stretch gap-2">
          {explained ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-body4 text-muted-foreground">{explained}</p>
          ) : null}
          <Button
            size="lg"
            aria-disabled={blocked || undefined}
            onClick={() => {
              if (!blocked) onConfirm()
            }}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {label}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
