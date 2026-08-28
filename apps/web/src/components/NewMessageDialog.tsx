//
// Starting a conversation: a name, or an address.
//
// ── IT RESOLVES BEFORE IT NAVIGATES, AND THAT IS THE WHOLE VALUE ─────────────────────────
//
// Anyone can be typed into this box; only registered addresses can be talked to. Navigating first
// and discovering that in the thread would leave a dead conversation in the sidebar for every
// mistyped address — so the peer is checked here, and the row is only remembered once a room
// actually derived.
//
// ── THE THREE REFUSALS ARE THREE SENTENCES ───────────────────────────────────────────────
//
// "Not an address", "your own address" and "has not registered" are different facts, and the third
// has an action attached that the other two do not. `chat-copy.ts` carries them.
//
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import {
  CHAT_PEER_INVALID,
  CHAT_PEER_SELF,
  CHAT_PEER_UNREGISTERED,
  DIRECTORY_NAME_IS_NOT_IDENTITY,
  DIRECTORY_SEARCH_IS_LOCAL,
  DIRECTORY_SEARCH_PLACEHOLDER,
} from '@strk20/protocol/chat-copy'

import { cn } from '../lib/cn'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { openConversation, rememberConversation } from '../shell/chat-bus'
import { searchDirectory, useDirectory } from '../shell/use-directory'
import { shortenFelt } from '../shell/session'
import { Button } from './LegacyButton'
import { PeerAvatar } from './PeerAvatar'
import { Text } from './Text'

export interface NewMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewMessageDialog({ open, onOpenChange }: NewMessageDialogProps) {
  const navigate = useNavigate()
  const { entries, problem } = useDirectory()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const matches = useMemo(() => searchDirectory(entries, query), [entries, query])
  // A raw address is offered directly rather than searched for — most peers will never be in the
  // directory, and making them findable only by name would hide the majority of the protocol.
  const looksLikeAddress = /^0x[0-9a-fA-F]{1,64}$/.test(query.trim())

  const start = useCallback(
    async (peer: string) => {
      setBusy(true)
      setRefusal(null)
      const status = await openConversation(peer)
      setBusy(false)

      if (status.kind === 'open') {
        // Remembered only now, so a mistyped address never becomes a sidebar row.
        rememberConversation(peer)
        setQuery('')
        onOpenChange(false)
        void navigate({ to: '/chat/$peer', params: { peer: peer.trim().toLowerCase() } })
        return
      }

      setRefusal(
        status.kind === 'invalid'
          ? CHAT_PEER_INVALID
          : status.kind === 'self'
            ? CHAT_PEER_SELF
            : status.kind === 'unregistered'
              ? CHAT_PEER_UNREGISTERED
              : status.kind === 'unreadable'
                ? `The chain could not be read, so nothing is known about this address yet: ${status.because}`
                : 'Still reading their key…',
      )
    },
    [navigate, onOpenChange],
  )

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} label="New message" modal>
      <div className="flex w-full min-w-0 flex-col gap-s12">
        <Text variant="subheading1" as="h2">
          New message
        </Text>

        <label className="flex flex-col gap-s4">
          <span className="text-body4 text-neutral2">To</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setRefusal(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && looksLikeAddress) {
                event.preventDefault()
                void start(query)
              }
            }}
            placeholder={DIRECTORY_SEARCH_PLACEHOLDER}
            aria-label="A name or an address"
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'focus-ring min-h-s48 w-full rounded-card border border-solid bg-raised px-s12',
              'text-body3 text-neutral1 placeholder:text-neutral3',
              refusal ? 'border-irreversible' : 'border-surface3',
            )}
          />
        </label>

        {refusal ? (
          <Text variant="body3" className="text-exposed" role="alert">
            {refusal}
          </Text>
        ) : null}

        {/* The raw-address door, offered as its own row so it is obvious that names are optional. */}
        {looksLikeAddress ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void start(query)}
            className={cn(
              'focus-ring flex w-full items-center gap-s12 rounded-card px-s12 py-s8 text-left',
              'transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide',
              'cursor-pointer hover:bg-inset disabled:cursor-default disabled:opacity-60',
            )}
          >
            <PeerAvatar address={query.trim()} size={32} />
            <span className="flex min-w-0 flex-col">
              <span className="numeric truncate text-body3 text-neutral1">
                {shortenFelt(query.trim(), 10, 8)}
              </span>
              <span className="text-body4 text-neutral3">
                {busy ? 'Reading their key…' : 'Message this address'}
              </span>
            </span>
          </button>
        ) : null}

        {matches.length > 0 ? (
          <ul className="flex flex-col gap-s2">
            {matches.map((entry) => (
              <li key={entry.address}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void start(entry.address)}
                  className={cn(
                    'focus-ring flex w-full items-center gap-s12 rounded-card px-s12 py-s8 text-left',
                    'transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide',
                    'cursor-pointer hover:bg-inset disabled:cursor-default disabled:opacity-60',
                  )}
                >
                  <PeerAvatar address={entry.address} size={32} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body3 text-neutral1">{entry.name}</span>
                    <span className="numeric truncate text-body4 text-neutral3">
                      {shortenFelt(entry.address, 10, 8)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {query.trim() !== '' && matches.length === 0 && !looksLikeAddress ? (
          <Text variant="body4" className="text-neutral2">
            No name matches that. Addresses starting <span className="numeric">0x</span> always
            work, whether or not their owner claimed a name.
          </Text>
        ) : null}

        {problem ? (
          <Text variant="body4" className="text-exposed">
            {problem}
          </Text>
        ) : null}

        <div className="flex flex-col gap-s4 border-t border-solid border-surface3 pt-s12">
          <Text variant="body4" className="text-neutral3">
            {DIRECTORY_SEARCH_IS_LOCAL}
          </Text>
          <Text variant="body4" className="text-neutral3">
            {DIRECTORY_NAME_IS_NOT_IDENTITY}
          </Text>
        </div>

        <Button variant="tertiary" size="md" fill onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </div>
    </ResponsiveDialog>
  )
}
