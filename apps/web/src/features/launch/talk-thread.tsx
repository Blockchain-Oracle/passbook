// The Talk tab — an open thread on a launch. Every mount carries `OPEN_ROOM_DISCLOSURE` verbatim;
// bylines render as claimed, never as proven.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MessageSquare, Send } from 'lucide-react'
import { OPEN_ROOM_DISCLOSURE } from '@strk20/protocol/open-room-tags'

import { useSession } from '@/app/session'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { directoryQuery, nameFor } from '@/queries'
import { useTalkPost, useTalkThread } from './use-talk'

export function TalkThread({ tag, emptyLine }: { tag: string; emptyLine: string }) {
  const thread = useTalkThread(tag)
  const session = useSession()
  const address = session.status === 'ready' ? (session.address ?? null) : null
  const directory = useQuery(directoryQuery())
  const myName = address ? nameFor(directory.data, address) : null
  const post = useTalkPost()
  const [draft, setDraft] = useState('')
  const canPost = address !== null
  const opening = thread.stream === 'idle' || thread.stream === 'connecting'

  const submit = async () => {
    const text = draft.trim()
    if (text === '' || post.isPending) return
    if (!canPost) {
      toast('An account is needed to post.')
      return
    }
    try {
      await post.mutateAsync({ tag, text, name: myName })
      setDraft('')
    } catch (error) {
      toast.error('The post did not send', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {thread.posts.length === 0 ? (
        <Empty className="py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">{opening ? <Spinner /> : <MessageSquare />}</EmptyMedia>
            <EmptyTitle>{opening ? 'Opening the room' : 'Nothing said yet'}</EmptyTitle>
            <EmptyDescription>{opening ? 'Replaying what the relay still holds.' : emptyLine}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-3">
          {thread.posts.map((p) => (
            <li key={p.id} className="flex items-start gap-3">
              <Avatar size="sm">
                <AvatarFallback className="font-mono text-[10px] uppercase">{p.from.slice(2, 4)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-mono text-muted-foreground">{p.name ? `@${p.name} · claimed` : `anon ${p.from.slice(2, 8)}`}</p>
                <p className="whitespace-pre-wrap break-words text-body3">{p.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <InputGroup>
        <InputGroupInput
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={canPost ? 'Say something into the room…' : 'An account is needed to post'}
          aria-label="Post into this thread"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton onClick={() => void submit()} aria-disabled={!canPost || post.isPending || draft.trim() === '' || undefined} aria-label="Post">
            {post.isPending ? <Spinner /> : <Send />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <p className="text-body4 text-muted-foreground">{OPEN_ROOM_DISCLOSURE}</p>
    </div>
  )
}
