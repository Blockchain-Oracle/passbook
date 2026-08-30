import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Lock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CHAT_THREAD_EMPTY } from '@strk20/protocol/chat-copy'
import { CHAT_AUDITOR_DERIVES } from '@strk20/protocol/disclosure-copy'
import { PAY_ASSETS, type PayAsset } from '@strk20/protocol/pay-link'
import { disclosureFor } from '@strk20/protocol/disclosure'
import type { ChatLogEntry } from '@strk20/protocol/chat-log'

import { Amount } from '@/components/money/amount'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortAddress } from '@/lib/format'
import { notify } from '@/lib/notify'

import { useChatContext } from './chat-context'
import { Composer } from './composer'
import { setActiveThread, useThread } from './chat-log-store'
import { MessageBubble } from './message-bubble'
import type { PayAsk } from './message-bubble'
import { AttachMoneyDialog, type MoneyAttachment } from './money-attachment'
import { ShareHandleDialog } from './share-handle-dialog'
import { PeerAvatar, peerLabel } from './peer-avatar'
import { peerRoomQuery, statusLine, type RoomInputs } from './queries'
import { useChatMoney } from './use-chat-money'
import { usePeerIdentity } from './use-peers'
import { useSendMessage } from './use-send-message'
import type { StreamState } from './use-room-stream'

const CONNECTION_LABEL: Record<StreamState, string> = {
  idle: 'Offline',
  connecting: 'Connecting…',
  live: 'Live',
  retrying: 'Reconnecting…',
}

// The purpose-built one: paying inside a thread is not the same disclosure as paying from /send.
const CHAT_PAYMENT_DISCLOSURE = disclosureFor('chat-payment')

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
  const money = useChatMoney()
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<MoneyAttachment | null>(null)
  // What the money dialog should open as, and prefilled with what. `seed` only arrives from an ask.
  const [attaching, setAttaching] = useState<{ kind: MoneyAttachment['kind']; seed?: { asset?: PayAsset; amount?: string } } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [sharing, setSharing] = useState(false)
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

  const blocker = room ? null : status.isPending ? 'Still reading their key…' : statusLine(status.data)
  const busy = send.isPending || money.busy

  const clear = () => {
    setDraft('')
    setAttachment(null)
  }

  /** The composer's one action. What it does depends on what is staged, and the button says so. */
  function submit() {
    if (blocker || !room) {
      notify.refused(blocker ?? 'This thread is not open yet.')
      return
    }
    if (attachment?.kind === 'payment') {
      // Money is reviewed before it moves, here as everywhere else in the app.
      setReviewing(true)
      return
    }
    if (attachment?.kind === 'request') {
      void money.ask({ address: me.address, peer, room, attachment, note: draft.trim() }).then(clear)
      return
    }
    const text = draft.trim()
    if (!text) return
    setDraft('')
    send.mutate({ address: me.address, peer, room, message: { kind: 'text', text } }, { onError: (e) => notify.refused(e.message) })
  }

  /** A handle carries no value, so it posts straight into the thread — nothing to review. */
  function shareHandle(share: { handle: string; houseId: number; houseName: string }) {
    if (!room) return
    setSharing(false)
    send.mutate(
      { address: me.address, peer, room, message: { kind: 'handle', ...share } },
      { onError: (e) => notify.refused(e.message) },
    )
  }

  /** Their ask, answered: the money dialog opens already holding the numbers they named. */
  function payAsk(ask: PayAsk) {
    const asset = (PAY_ASSETS as readonly string[]).includes(ask.symbol) ? (ask.symbol as PayAsset) : undefined
    setAttaching({ kind: 'payment', seed: { ...(asset ? { asset } : {}), amount: ask.amount } })
  }

  const confirmPayment = async () => {
    if (!room || !attachment || attachment.kind !== 'payment') return
    const moved = await money.pay({ address: me.address, peer, room, attachment, note: draft.trim() })
    setReviewing(false)
    if (moved) clear()
  }

  return (
    <section className="flex min-h-[60vh] flex-1 flex-col rounded-xl border bg-card @3xl:min-h-0">
      {/* The name keeps a phone's width; the badges drop to a second line. Money lives in the composer. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <Button size="icon-sm" variant="ghost" className="@3xl:hidden" render={<Link to="/chat" aria-label="All conversations" />}>
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
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
        {bubbles.length === 0 ? (
          <p className="m-auto max-w-sm text-center text-body3 text-muted-foreground">{CHAT_THREAD_EMPTY}</p>
        ) : (
          bubbles.map((entry) => (
            <MessageBubble
              key={entry.id}
              entry={entry}
              reactions={reactions.get(entry.id) ?? []}
              peer={peer}
              identity={identity}
              onPay={payAsk}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      <Composer
        draft={draft}
        onDraft={setDraft}
        attachment={attachment}
        onAttach={(kind) => setAttaching({ kind })}
        onShareHandle={() => setSharing(true)}
        onRemoveAttachment={() => setAttachment(null)}
        onSubmit={submit}
        blocker={blocker}
        busy={busy}
      />

      {/* Keyed on the seed: the form's initial values are read once, so a new prefill needs a new form. */}
      <AttachMoneyDialog
        key={JSON.stringify(attaching?.seed ?? null)}
        open={attaching !== null}
        onOpenChange={(open) => (open ? undefined : setAttaching(null))}
        kind={attaching?.kind ?? 'payment'}
        peer={peer}
        seed={attaching?.seed}
        onAttach={setAttachment}
      />

      <ShareHandleDialog open={sharing} onOpenChange={setSharing} onShare={shareHandle} />

      {attachment?.kind === 'payment' ? (
        <ReviewSheet
          open={reviewing}
          onOpenChange={(open) => (open || money.busy ? undefined : setReviewing(false))}
          title="Review payment"
          description={`To ${peerLabel(peer, identity)}`}
          boundary="shielded"
          rows={[
            { label: 'To', value: identity.name ? `@${identity.name}` : shortAddress(peer, 10, 6) },
            { label: 'You send', value: <Amount wei={attachment.wei} decimals={attachment.decimals} symbol={attachment.symbol} /> },
            { label: 'Message', value: draft.trim() || '—' },
            { label: 'Lands as', value: 'A card in this thread, naming the transaction' },
          ]}
          disclosure={CHAT_PAYMENT_DISCLOSURE}
          confirmLabel={`Send ${attachment.amountText} ${attachment.symbol}`}
          onConfirm={() => void confirmPayment()}
          busy={money.busy}
        />
      ) : null}
    </section>
  )
}
