import type { ReactNode } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'

import type { BoundaryKind } from '@/app/boundary'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { useCopy } from '@/hooks/use-copy'
import { cn } from '@/lib/utils'

export interface ReceiptProps {
  title?: string
  transactionHash: string
  rows: readonly { label: string; value: ReactNode }[]
  boundary: BoundaryKind
  explorerUrl: string | null
  className?: string
}

export function shortenHash(hash: string, lead = 8, tail = 6): string {
  return hash.length <= lead + tail + 1 ? hash : `${hash.slice(0, lead)}…${hash.slice(-tail)}`
}

/** What landed, with its hash. The boundary badge says where the money ended up. */
export function Receipt({ title = 'Receipt', transactionHash, rows, boundary, explorerUrl, className }: ReceiptProps) {
  const { copied, copy } = useCopy()
  return (
    <Card className={cn('border-settled', className)}>
      <CardHeader>
        <CardTitle className="font-display text-display4 uppercase">{title}</CardTitle>
        <CardAction>
          <BoundaryBadge kind={boundary} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="text-muted-foreground">{row.label}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{row.value}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="text-muted-foreground">Transaction</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void copy(transactionHash)}
                  className="font-mono text-mono"
                  title={transactionHash}
                  aria-label={copied ? 'Copied' : 'Copy transaction hash'}
                >
                  {shortenHash(transactionHash)}
                  {copied ? <Check className="size-3 text-settled" data-icon="inline-end" /> : <Copy className="size-3 text-muted-foreground" data-icon="inline-end" />}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
      {explorerUrl ? (
        <CardFooter>
          <Button variant="outline" size="sm" render={<a href={explorerUrl} target="_blank" rel="noreferrer" />}>
            View on explorer
            <ExternalLink data-icon="inline-end" />
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}
