import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { SquarePen } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  MAIL_DIRECTORY_IS_LOCAL,
  MAIL_DIRECTORY_PLACEHOLDER,
  MAIL_NAME_IS_NOT_IDENTITY,
  MAIL_NEW,
  MAIL_PEER_INVALID,
  MAIL_PEER_SELF,
} from '@strk20/protocol/mail-copy'
import type { DirectoryEntry } from '@strk20/protocol/directory-name'
import { notify } from '@/lib/notify'

import { IdentityAvatar } from '@/components/money/identity-avatar'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { shortAddress } from '@/lib/format'
import { directoryQuery } from '@/queries'


const RAW_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/

/** Prefix-on-name first, then substring on name or address. Runs here, in this browser. */
export function searchDirectory(entries: readonly DirectoryEntry[], query: string): DirectoryEntry[] {
  const q = query.trim().replace(/^@/, '').toLowerCase()
  if (!q) return entries.slice(0, 20)
  const prefix = entries.filter((e) => e.name.startsWith(q))
  const rest = entries.filter((e) => !e.name.startsWith(q) && (e.name.includes(q) || e.address.toLowerCase().includes(q)))
  return [...prefix, ...rest].slice(0, 20)
}

function sameFelt(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

export function NewMailDialog({ address }: { address: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const directory = useQuery(directoryQuery())
  const matches = useMemo(() => searchDirectory(directory.data ?? [], query), [directory.data, query])
  const raw = query.trim()
  const rawIsAddress = RAW_ADDRESS.test(raw)

  function start(peer: string) {
    if (!RAW_ADDRESS.test(peer)) {
      notify.refused(MAIL_PEER_INVALID)
      return
    }
    if (sameFelt(peer, address)) {
      notify.refused(MAIL_PEER_SELF)
      return
    }
    setOpen(false)
    setQuery('')
    // No local record is made: a thread exists on chain or not at all, and the route renders either.
    void navigate({ to: '/mail/$peer', params: { peer: peer.toLowerCase() } })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <SquarePen data-icon="inline-start" aria-hidden />
        New
      </DialogTrigger>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{MAIL_NEW}</DialogTitle>
          <DialogDescription>{MAIL_DIRECTORY_IS_LOCAL}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="rounded-none! border-t">
          <CommandInput placeholder={MAIL_DIRECTORY_PLACEHOLDER} value={query} onValueChange={setQuery} autoFocus />
          <CommandList>
            <CommandEmpty>
              {directory.isPending
                ? 'Loading the directory…'
                : directory.isError
                  ? 'Names could not be loaded. Paste an address instead.'
                  : 'Nobody by that name. Paste an address starting 0x.'}
            </CommandEmpty>
            {rawIsAddress ? (
              <CommandGroup heading="Address">
                <CommandItem value={`addr:${raw}`} onSelect={() => start(raw)}>
                  {/* The face is derived from the address alone, so a pasted stranger still has one. */}
                  <IdentityAvatar address={raw} size="sm" />
                  <span className="font-mono text-mono">{shortAddress(raw, 12, 8)}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {matches.length ? (
              <CommandGroup heading="Directory">
                {matches.map((entry) => (
                  <CommandItem key={entry.address} value={`name:${entry.name}`} onSelect={() => start(entry.address)}>
                    {/* Identicon only, never the uploaded picture: twenty search hits must not be twenty fetches. */}
                    <IdentityAvatar address={entry.address} name={entry.name} size="sm" />
                    <span>@{entry.name}</span>
                    <span className="ml-auto font-mono text-mono text-muted-foreground">{shortAddress(entry.address)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        <p className="border-t px-4 py-3 text-body4 text-muted-foreground">{MAIL_NAME_IS_NOT_IDENTITY}</p>
      </DialogContent>
    </Dialog>
  )
}
