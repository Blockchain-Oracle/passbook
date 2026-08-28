import {
  ACTOR_LABELS,
  CELL_LABEL,
  CONTEXT_LABELS,
  FACT_LABELS,
  VISIBILITY_ACTORS,
  VISIBILITY_FACTS,
  cellAnnouncement,
  matrixFor,
  matrixNotes,
  noteNumber,
  type VisibilityCell,
  type VisibilityContext,
} from '@strk20/protocol/visibility-matrix'

import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Filled · hollow · half · dash — the protocol's `CELL_ENCODING`, drawn. Colour is the third channel. */
function CellDot({ cell }: { cell: VisibilityCell }) {
  const base = 'inline-block size-3 rounded-pill border-2'
  switch (cell.state) {
    case 'sees':
      return <span className={cn(base, 'border-exposed bg-exposed')} aria-hidden />
    case 'hidden':
      return <span className={cn(base, 'border-settled bg-transparent')} aria-hidden />
    case 'conditional':
      return (
        <span
          className={cn(base, 'border-exposed')}
          style={{ background: 'linear-gradient(90deg, var(--color-exposed) 50%, transparent 50%)' }}
          aria-hidden
        />
      )
    case 'absent':
      return <span className="inline-block h-0.5 w-3 bg-muted-foreground" aria-hidden />
  }
}

export interface VisibilityMatrixViewProps {
  context: VisibilityContext
  className?: string
}

/** Who can read which fact for one review context. Every cell carries its word for AT. */
export function VisibilityMatrixView({ context, className }: VisibilityMatrixViewProps) {
  const matrix = matrixFor(context)
  if (!matrix.authored) {
    return <p className={cn('text-body4 text-muted-foreground', className)}>{matrix.because}</p>
  }
  const notes = matrixNotes(matrix)
  return (
    <div className={cn('overflow-x-auto', className)}>
      <Table>
        <TableCaption className="text-left">{CONTEXT_LABELS[context]}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="text-kicker uppercase">Fact</TableHead>
            {VISIBILITY_ACTORS.map((actor) => (
              <TableHead key={actor} className="text-center text-kicker uppercase">
                {ACTOR_LABELS[actor]}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {VISIBILITY_FACTS.map((fact) => (
            <TableRow key={fact}>
              <TableCell className="font-medium">{FACT_LABELS[fact]}</TableCell>
              {VISIBILITY_ACTORS.map((actor) => {
                const cell = matrix.cells[fact][actor]
                const n = noteNumber(notes, cell)
                return (
                  <TableCell key={actor} className="text-center">
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex items-center gap-1" />}>
                        <CellDot cell={cell} />
                        <span className="sr-only">{cellAnnouncement(cell)}</span>
                        {n !== null ? <sup className="text-[10px] text-muted-foreground">{n}</sup> : null}
                      </TooltipTrigger>
                      <TooltipContent>{cell.state === 'conditional' ? cell.note : CELL_LABEL[cell.state]}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ol className="mt-2 flex flex-col gap-1 text-body4 text-muted-foreground">
        {notes.map((note, i) => (
          <li key={note}>
            <sup>{i + 1}</sup> {note}
          </li>
        ))}
      </ol>
      <p className="mt-2 flex flex-wrap gap-3 text-body4 text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CellDot cell={{ state: 'sees' }} /> Sees
        </span>
        <span className="inline-flex items-center gap-1">
          <CellDot cell={{ state: 'hidden' }} /> Hidden
        </span>
        <span className="inline-flex items-center gap-1">
          <CellDot cell={{ state: 'conditional', note: '' }} /> Conditional
        </span>
        <span className="inline-flex items-center gap-1">
          <CellDot cell={{ state: 'absent' }} /> Not applicable
        </span>
      </p>
    </div>
  )
}
