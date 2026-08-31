import type { ReactNode } from 'react'
import type { Disclosure } from '@strk20/protocol/disclosure'

import type { BoundaryKind } from '@/app/boundary'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { OperationPipeline } from '@/components/money/operation-pipeline'
import { RefusalRow, asRefusal, type Refusal } from '@/components/money/refusal'
import { SponsorRow, useSponsorChoice, type SponsorOffer } from '@/components/money/sponsor-row'
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
  /**
   * `sponsored` is whether the user left the sponsorship toggle ON *and* a unit was actually
   * available. Callers that pass no `sponsor` offer always receive `false` and may ignore the
   * argument entirely — a `() => void` still satisfies this type.
   */
  onConfirm: (sponsored: boolean) => void
  busy?: boolean
  /**
   * Whether we can pay for this one, and the row that says so. Absent renders nothing at all,
   * which is what every venue did before this existed.
   */
  sponsor?: SponsorOffer
  /**
   * Why confirm is blocked — a standing condition or a missing input, NOT a failure. It renders
   * muted, because nothing has gone wrong yet. A refusal belongs in `problem`, which is red.
   */
  blocker?: string | null
  /**
   * What went wrong on the last confirm. THE ONE PLACE A REFUSAL GOES, on every venue: it is red,
   * it sits against the button that caused it, and it stays until the surface is used again.
   * Takes a bare sentence, or a `Refusal` when there is a transaction to link.
   */
  problem?: string | Refusal | null
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
  sponsor,
  blocker,
  problem,
  children,
}: ReviewSheetProps) {
  const blocked = busy || Boolean(blocker)
  // ── WHO PAYS, DECIDED HERE RATHER THAN IN TWELVE CALL SITES ───────────────────────────────
  //
  // Every venue that signs does it behind this sheet, so the offer, the count and the choice live
  // in one place. The alternative was the same three-state block copied into send, swap, bridge,
  // unshield, bets and launch — which is exactly how the pipeline row came to be missing from six
  // of them before it moved here.
  const choice = useSponsorChoice(sponsor?.kind === 'eligible')
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
          {sponsor ? (
            <SponsorRow
              offer={sponsor}
              allowance={choice.allowance}
              loading={choice.loading}
              checked={choice.want}
              onCheckedChange={choice.setWant}
              locked={busy}
            />
          ) : null}
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
        </div>
        {/* The refusal lives in the FOOTER, not the scroll area above it: a reason the user has to
            scroll back up to find is a reason they will report as "it just did nothing". */}
        <SheetFooter className="flex-col items-stretch gap-2">
          <RefusalRow refusal={asRefusal(problem)} />
          {explained ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-body4 text-muted-foreground">{explained}</p>
          ) : null}
          <Button
            size="lg"
            aria-disabled={blocked || undefined}
            onClick={() => {
              if (!blocked) onConfirm(choice.sponsored)
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
