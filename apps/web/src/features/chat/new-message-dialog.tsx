import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { AtSign, Hash, SquarePen } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  CHAT_PEER_INVALID,
  CHAT_PEER_SELF,
  DIRECTORY_NAME_IS_NOT_IDENTITY,
  DIRECTORY_SEARCH_IS_LOCAL,
  DIRECTORY_SEARCH_PLACEHOLDER,
} from '@strk20/protocol/chat-copy'
import type { DirectoryEntry } from '@strk20/protocol/directory-name'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { shortAddress } from '@/lib/format'
import { directoryQuery } from '@/queries'

import { chatLogFor, peerKey } from './chat-log-store'

const RAW_ADDRESS = /^0x[0-9a-fA-F]{1,64}$/

/** Prefix-on-name first, then substring on name or address. Runs here, never on the relay. */
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

export function NewMessageDialog({ address }: { address: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const directory = useQuery(directoryQuery())
  const matches = useMemo(() => searchDirectory(directory.data ?? [], query), [directory.data, query])
  const raw = query.trim()
  const rawIsAddress = RAW_ADDRESS.test(raw)

  function start(peer: string) {
    if (!RAW_ADDRESS.test(peer)) {
      toast.error(CHAT_PEER_INVALID)
      return
    }
    if (sameFelt(peer, address)) {
      toast.error(CHAT_PEER_SELF)
      return
    }
    const key = peerKey(peer)
    chatLogFor(address).ensure(key)
    setOpen(false)
    setQuery('')
    void navigate({ to: '/chat/$peer', params: { peer: key } })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <SquarePen data-icon="inline-start" aria-hidden />
        New
      </DialogTrigger>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>{DIRECTORY_SEARCH_IS_LOCAL}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="rounded-none! border-t">
          <CommandInput placeholder={DIRECTORY_SEARCH_PLACEHOLDER} value={query} onValueChange={setQuery} autoFocus />
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
                  <Hash aria-hidden />
                  <span className="font-mono text-mono">{shortAddress(raw, 12, 8)}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {matches.length ? (
              <CommandGroup heading="Directory">
                {matches.map((entry) => (
                  <CommandItem key={entry.address} value={`name:${entry.name}`} onSelect={() => start(entry.address)}>
                    <AtSign aria-hidden />
                    <span>{entry.name}</span>
                    <span className="ml-auto font-mono text-mono text-muted-foreground">{shortAddress(entry.address)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
        <p className="border-t px-4 py-3 text-body4 text-muted-foreground">{DIRECTORY_NAME_IS_NOT_IDENTITY}</p>
      </DialogContent>
    </Dialog>
  )
}
