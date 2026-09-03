import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Lock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CHAT_PRESENCE_HERE,
  CHAT_PRESENCE_MEANING,
  CHAT_PRESENCE_UNKNOWN,
  CHAT_THREAD_EMPTY,
  CHAT_TYPING_IS_A_HINT,
  CHAT_TYPING_LABEL,
} from '@strk20/protocol/chat-copy'
import { CHAT_AUDITOR_DERIVES } from '@strk20/protocol/disclosure-copy'
import { PAY_ASSETS, type PayAsset } from '@strk20/protocol/pay-link'
import { disclosureFor } from '@strk20/protocol/disclosure'
import type { ChatLogEntry } from '@strk20/protocol/chat-log'
import type { PositionShare } from '@strk20/protocol/position-share'

import { Amount } from '@/components/money/amount'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notify'
import { useRefusal } from '@/components/money/refusal'

import { useChatContext } from './chat-context'
import { Composer } from './composer'
import { peerKey, setActiveThread, useThread } from './chat-log-store'
import { MessageBubble } from './message-bubble'
import type { PayAsk } from './message-bubble'
import { AttachMoneyDialog, type MoneyAttachment } from './money-attachment'
import { ShareHandleDialog } from '@/components/share/share-handle-dialog'
import { ShareMarketDialog } from '@/components/share/share-market-dialog'
import { TypingBubble } from './typing-bubble'
import { PeerAvatar, peerLabel } from './peer-avatar'
import { peerRoomQuery, statusLine, type RoomInputs } from './queries'
import { usePresence } from './room-presence'
import { useChatMoney } from './use-chat-money'
import { usePeerIdentity } from './use-peers'
import { useSendMessage } from './use-send-message'
import { useTypingPing } from './use-typing-ping'
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
  const [sharingMarket, setSharingMarket] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const { bubbles, reactions } = useMemo(() => fold(entries), [entries])
  const room = status.data?.kind === 'open' ? status.data.room : null
  const presence = usePresence(peerKey(peer))
  const ping = useTypingPing(room)

  useEffect(() => {
    setActiveThread(me.address, peer)
    return () => setActiveThread(me.address, null)
  }, [me.address, peer])

  // The LIST is scrolled, never the document. `scrollIntoView` walks up to whatever scrolls and on
  // a phone that used to be the page — so a new message yanked the whole screen, header and all.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [bubbles.length, presence.typing])

  const blocker = room ? null : status.isPending ? 'Still reading their key…' : statusLine(status.data)
  const { refusal, refuse, clear: clearRefusal } = useRefusal()
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

  /** A bet card carries no value either — it is a claim the other side checks. Straight in. */
  function shareMarket(share: PositionShare) {
    if (!room) return
    setSharingMarket(false)
    send.mutate({ address: me.address, peer, room, message: { kind: 'market', share } }, { onError: (e) => notify.refused(e.message) })
  }

  /** Their ask, answered: the money dialog opens already holding the numbers they named. */
  function payAsk(ask: PayAsk) {
    const asset = (PAY_ASSETS as readonly string[]).includes(ask.symbol) ? (ask.symbol as PayAsset) : undefined
    setAttaching({ kind: 'payment', seed: { ...(asset ? { asset } : {}), amount: ask.amount } })
  }

  const confirmPayment = async (sponsored: boolean) => {
    if (!room || !attachment || attachment.kind !== 'payment') return
    clearRefusal()
    const moved = await money.pay({
      address: me.address,
      peer,
      room,
      attachment,
      note: draft.trim(),
      sponsored,
      onRefused: refuse,
    })
    // A refusal KEEPS THE SHEET OPEN. Closing it and raising a toast was how a failed payment came
    // to look like a payment that simply vanished.
    if (!moved) return
    setReviewing(false)
    clear()
  }

  // The second line under the name. Live state outranks the room derivation, which never changes
  // once it is known and does not need to hold that slot for the life of the conversation.
  const subtitle = presence.typing
    ? CHAT_TYPING_LABEL
    : status.isPending
      ? 'Reading their key…'
      : presence.others > 0
        ? CHAT_PRESENCE_HERE
        : statusLine(status.data)

  return (
    // `min-h-0` at every size: the section is a bounded column whose middle scrolls, so the
    // composer sits on the bottom edge of the screen rather than the bottom of the document.
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card @max-3xl:rounded-none @max-3xl:border-x-0">
      {/* The name keeps a phone's width; the badges drop to a second line. Money lives in the composer. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <Button size="icon-sm" variant="ghost" className="@3xl:hidden" render={<Link to="/chat" aria-label="All conversations" />}>
          <ArrowLeft aria-hidden />
        </Button>
        <PeerAvatar peer={peer} identity={identity} here={presence.others > 0} />
        <div className="min-w-0 flex-1 basis-32">
          <p className="truncate font-medium">{peerLabel(peer, identity)}</p>
          <Tooltip>
            <TooltipTrigger
              render={
                <p
                  className={cn(
                    'truncate text-left text-body4',
                    presence.typing ? 'text-primary' : presence.others > 0 ? 'text-settled' : 'text-muted-foreground',
                  )}
                />
              }
            >
              {subtitle}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {presence.others > 0 ? CHAT_PRESENCE_MEANING : CHAT_PRESENCE_UNKNOWN}
            </TooltipContent>
          </Tooltip>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Badge variant="outline" className="gap-1 uppercase text-navLabel" />}>
            <Lock aria-hidden />
            Sealed
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            {CHAT_AUDITOR_DERIVES}
            {/* The typing hint is the one frame on this socket that is not sealed, so it is named
                where the seal is claimed rather than in a footnote nobody opens. */}
            <span className="mt-2 block border-t pt-2">{CHAT_TYPING_IS_A_HINT}</span>
          </TooltipContent>
        </Tooltip>
        {/* Only when something is WRONG. A permanent "Live" chip is a third thing saying what the
            green dot and the subtitle already say, and on a phone it is a third thing competing for
            a header that has to fit a name. Silence here means the socket is fine. */}
        {connection === 'live' ? null : (
          <Badge variant="secondary" className="shrink-0">
            {connection === 'connecting' || connection === 'retrying' ? <Spinner /> : null}
            {CONNECTION_LABEL[connection]}
          </Badge>
        )}
      </header>

      <div ref={listRef} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-4">
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
        {presence.typing ? <TypingBubble /> : null}
      </div>

      <Composer
        draft={draft}
        onDraft={(next) => {
          setDraft(next)
          ping()
        }}
        attachment={attachment}
        onAttach={(kind) => setAttaching({ kind })}
        onShareHandle={() => setSharing(true)}
        onShareMarket={() => setSharingMarket(true)}
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
      <ShareMarketDialog open={sharingMarket} onOpenChange={setSharingMarket} onShare={shareMarket} />

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
          sponsor={{ kind: 'eligible' }}
          onConfirm={(sponsored) => void confirmPayment(sponsored)}
          busy={money.busy}
          problem={refusal}
        />
      ) : null}
    </section>
  )
}
