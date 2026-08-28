import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { DirectoryEntry } from '@strk20/protocol/directory-name'
import { parsePayLinkSearch, parseRecipientReference, resolveRecipientReference, type PayLinkSearch } from '@strk20/protocol/pay-link'

import { Page } from '@/components/layout/page'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { directoryQuery } from '@/queries'
import { shortAddress } from '@/lib/format'

/** The raw query a pay link or profile route carries. Validated here, not in the route. */
export interface RawPaySearch {
  asset?: string
  amount?: string
  note?: string
}

export function rawPaySearch(search: Record<string, unknown>): RawPaySearch {
  const pick = (key: keyof RawPaySearch) => (typeof search[key] === 'string' ? (search[key] as string) : undefined)
  return { asset: pick('asset'), amount: pick('amount'), note: pick('note') }
}

/** What Send is handed. `to` is an address or an `@name`, as the recipient field would take it. */
export interface SendPrefill extends PayLinkSearch {
  to: string
}

type Resolution =
  | { state: 'refused'; title: string; because: string }
  | { state: 'resolving'; title: string }
  | { state: 'resolved'; address: string; name: string | null; prefill: SendPrefill }

interface DirectoryRead {
  data?: readonly DirectoryEntry[]
  isPending: boolean
  isError: boolean
}

function resolve(reference: string, search: RawPaySearch, directory: DirectoryRead): Resolution {
  const parsed = parseRecipientReference(reference)
  if (!parsed.ok) return { state: 'refused', title: 'This link does not name a recipient', because: parsed.because }
  const request = parsePayLinkSearch({ ...search })
  if (!request.ok) return { state: 'refused', title: 'This payment request is not valid', because: request.because }

  const display = parsed.value.kind === 'address' ? parsed.value.address : parsed.value.display
  if (parsed.value.kind === 'name') {
    if (directory.isPending) return { state: 'resolving', title: `Finding ${display}` }
    if (directory.isError) {
      return { state: 'refused', title: `Could not resolve ${display}`, because: 'Names could not be loaded. Use the recipient’s address instead.' }
    }
  }
  const resolved = resolveRecipientReference(reference, directory.data ?? [])
  if (!resolved.ok) return { state: 'refused', title: `Could not resolve ${display}`, because: resolved.because }
  return { state: 'resolved', address: resolved.address, name: resolved.name, prefill: { to: display, ...request.value } }
}

/**
 * `/pay/$address` and `/u/$name`: resolve who is being paid, then hand Send the prefilled search.
 * The card stays on screen while a name is looked up, and stays for good when the link is refused.
 */
export function PayResolver({ reference, search }: { reference: string; search: RawPaySearch }) {
  const needsDirectory = reference.trim().startsWith('@')
  const directory = useQuery({ ...directoryQuery(), enabled: needsDirectory })
  const navigate = useNavigate()
  const resolution = resolve(reference, search, needsDirectory ? directory : { data: [], isPending: false, isError: false })

  useEffect(() => {
    if (resolution.state !== 'resolved') return
    void navigate({ to: '/send', search: resolution.prefill, replace: true })
    // The prefill is derived from the URL, so the URL is the dependency.
  }, [resolution.state, reference, search.asset, search.amount, search.note, navigate]) // eslint-disable-line react-hooks/exhaustive-deps

  const title = resolution.state === 'resolved' ? 'Opening Send' : resolution.title

  return (
    <Page kicker="Money" title="Pay" actions={<BoundaryBadge kind="shieldedRound" />}>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-display4 uppercase">
            {resolution.state !== 'refused' ? <Spinner className="size-4" /> : null}
            {title}
          </CardTitle>
          {resolution.state === 'refused' ? <CardDescription role="alert">{resolution.because}</CardDescription> : null}
        </CardHeader>
        {resolution.state === 'resolved' ? (
          <CardContent>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell className="text-muted-foreground">Recipient</TableCell>
                  <TableCell className="text-right font-mono">
                    {resolution.name ? `@${resolution.name} · ` : ''}
                    {shortAddress(resolution.address, 10, 8)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">Asset</TableCell>
                  <TableCell className="text-right">{resolution.prefill.asset ?? 'Choose in Send'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">Amount</TableCell>
                  <TableCell className="text-right font-mono">{resolution.prefill.amount ?? 'Open amount'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-muted-foreground">Note · not on chain</TableCell>
                  <TableCell className="text-right">{resolution.prefill.note ?? '—'}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        ) : null}
      </Card>
    </Page>
  )
}
