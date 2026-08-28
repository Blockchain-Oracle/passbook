//
// The Talk tab — an open thread on a token, a sale, a market. Yosuku's Takes, on our rails.
//
// Every mount carries `OPEN_ROOM_DISCLOSURE` verbatim: an open room's honesty is the copy, and
// the copy lives in the protocol module so this surface cannot soften it. Bylines render as
// claimed (`@name`, dimmed) beside the identity disc the envelope's pubkey seeds — a stable
// pseudonym even for posters who claimed nothing.
//
import { useState } from 'react'

import { OPEN_ROOM_DISCLOSURE } from '@strk20/protocol/open-room-tags'

import { useDirectory, nameFor } from '../../shell/use-directory'
import { useSession } from '../../shell/session'
import { useTalkComposer, useTalkThread } from '../../shell/use-talk'
import { IdentityDisc } from '../IdentityDisc'
import { Button } from '../LegacyButton'
import { Text } from '../Text'

export function TalkThread({ tag, emptyLine }: { tag: string; emptyLine: string }) {
  const thread = useTalkThread(tag)
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const directory = useDirectory()
  const myName = ready ? nameFor(directory.entries, ready.address) : null
  const composer = useTalkComposer(tag, myName)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const text = draft.trim()
    if (text === '' || busy) return
    setBusy(true)
    try {
      const sent = await composer.post(text)
      if (sent) setDraft('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-s12">
      {thread.posts.length === 0 ? (
        <Text variant="body3" className="text-neutral3">
          {thread.stream === 'idle' || thread.stream === 'connecting' ? 'Opening the room…' : emptyLine}
        </Text>
      ) : (
        <ol className="m-s0 flex list-none flex-col gap-s8 p-s0">
          {thread.posts.map((post) => (
            <li key={post.id} className="flex items-start gap-s8">
              <IdentityDisc address={post.from} size={28} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Text variant="mono" className="text-neutral3">
                  {post.name ? `@${post.name} · claimed` : `anon ${post.from.slice(2, 8)}`}
                </Text>
                <Text variant="body3" className="whitespace-pre-wrap break-words text-neutral1">
                  {post.text}
                </Text>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center gap-s8">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={composer.canPost ? 'Say something into the room…' : 'An account is needed to post'}
          disabled={!composer.canPost || busy}
          aria-label="Post into this thread"
          className="focus-ring min-w-0 flex-1 rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 text-body3 text-neutral1 placeholder:text-neutral3"
        />
        <Button
          variant="secondary"
          size="md"
          onClick={() => void submit()}
          disabled={!composer.canPost || busy || draft.trim() === ''}
        >
          {busy ? 'Posting…' : 'Post'}
        </Button>
      </div>

      <Text variant="body4" className="text-neutral3">
        {OPEN_ROOM_DISCLOSURE}
      </Text>
    </div>
  )
}
