import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Banknote, Lock, SendHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CHAT_THREAD_EMPTY } from '@strk20/protocol/chat-copy'
import { CHAT_AUDITOR_DERIVES } from '@strk20/protocol/disclosure-copy'
import type { ChatLogEntry } from '@strk20/protocol/chat-log'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { useChatContext } from './chat-context'
import { setActiveThread, useThread } from './chat-log-store'
import { MessageBubble } from './message-bubble'
import { PeerAvatar, peerLabel } from './peer-avatar'
import { peerRoomQuery, statusLine, type RoomInputs } from './queries'
import { usePeerIdentity } from './use-peers'
import { useSendMessage } from './use-send-message'
import type { StreamState } from './use-room-stream'

const CONNECTION_LABEL: Record<StreamState, string> = {
  idle: 'Offline',
  connecting: 'Connecting…',
  live: 'Live',
  retrying: 'Reconnecting…',
}

/** Reactions fold into chips under their target; everything else is a bubble. */
function fold(entries: readonly ChatLogEntry[]): { bubbles: ChatLogEntry[]; reactions: Map<string, string[]> } {
  const reactions = new Map<string, string[]>()
  const bubbles: ChatLogEntry[] = []
  for (const entry of entries) {
    if (entry.message.kind === 'reaction') {
      const list = reactions.get(entry.message.target) ?? []
      list.push(entry.message.emoji)
      reactions.set(entry.message.target, list)
    } else bubbles.push(entry)
  }
  return { bubbles, reactions }
}

/** The thread route's body. Renders nothing outside the chat layout, which provides the context. */
export function Thread({ peer }: { peer: string }) {
  const chat = useChatContext()
  if (!chat) return null
  return <ThreadView me={chat.me} peer={peer} connection={chat.connection} />
}

function ThreadView({ me, peer, connection }: { me: RoomInputs; peer: string; connection: StreamState }) {
  const identity = usePeerIdentity(peer)
  const status = useQuery(peerRoomQuery(me, peer))
  const entries = useThread(me.address, peer)
  const send = useSendMessage()
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const { bubbles, reactions } = useMemo(() => fold(entries), [entries])
  const room = status.data?.kind === 'open' ? status.data.room : null

  useEffect(() => {
    setActiveThread(me.address, peer)
    return () => setActiveThread(me.address, null)
  }, [me.address, peer])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [bubbles.length])

  const blocker = room
    ? null
    : status.isPending
      ? 'Still reading their key…'
      : statusLine(status.data)

  function submit() {
    const text = draft.trim()
    if (!text) return
    if (blocker || !room) {
      toast.error(blocker ?? 'This thread is not open yet.')
      return
    }
    setDraft('')
    send.mutate({ address: me.address, peer, room, message: { kind: 'text', text } }, { onError: (e) => toast.error(e.message) })
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <section className="flex min-h-[60vh] flex-1 flex-col rounded-xl border bg-card lg:min-h-0">
      {/* The name keeps a phone's width; the badges and the money button drop to a second line. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <Button size="icon-sm" variant="ghost" className="lg:hidden" render={<Link to="/chat" aria-label="All conversations" />}>
          <ArrowLeft aria-hidden />
        </Button>
        <PeerAvatar peer={peer} identity={identity} />
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate font-medium">{peerLabel(peer, identity)}</p>
          <p className="truncate text-body4 text-muted-foreground">{status.isPending ? 'Reading their key…' : statusLine(status.data)}</p>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Badge variant="outline" className="gap-1 uppercase text-navLabel" />}>
            <Lock aria-hidden />
            Sealed
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{CHAT_AUDITOR_DERIVES}</TooltipContent>
        </Tooltip>
        <Badge variant={connection === 'live' ? 'default' : 'secondary'}>
          {connection === 'connecting' || connection === 'retrying' ? <Spinner /> : null}
          {CONNECTION_LABEL[connection]}
        </Badge>
        <Button size="sm" variant="outline" render={<Link to="/send" search={{ to: peer }} />}>
          <Banknote data-icon="inline-start" aria-hidden />
          Send money
        </Button>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
        {bubbles.length === 0 ? (
          <p className="m-auto max-w-sm text-center text-body3 text-muted-foreground">{CHAT_THREAD_EMPTY}</p>
        ) : (
          bubbles.map((entry) => <MessageBubble key={entry.id} entry={entry} reactions={reactions.get(entry.id) ?? []} peer={peer} />)
        )}
        <div ref={endRef} />
      </div>

      <footer className="flex items-end gap-2 border-t p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={room ? 'Write — it seals before it leaves' : 'This thread is not open'}
          aria-invalid={blocker ? true : undefined}
          className="min-h-9 resize-none"
        />
        <Button size="icon" onClick={submit} aria-disabled={blocker ? true : undefined} className={cn(blocker && 'opacity-60')} aria-label="Send">
          {send.isPending ? <Spinner /> : <SendHorizontal aria-hidden />}
        </Button>
      </footer>
    </section>
  )
}
