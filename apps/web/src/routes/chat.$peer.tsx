import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { disclosureFor } from '@strk20/protocol/disclosure'
import { confidenceOf, toPlainText } from '@strk20/protocol/amount'
import {
  CHAT_PEER_INVALID,
  CHAT_PEER_SELF,
  CHAT_PEER_UNREGISTERED,
  CHAT_THREAD_EMPTY,
} from '@strk20/protocol/chat-copy'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { AmountInput, useAmountField } from '../components/AmountInput'
import { ChatThread, type PayableRequest } from '../components/ChatThread'
import { PrivacyRow } from '../components/PrivacyRow'
import { PeerAvatar } from '../components/PeerAvatar'
import { TokenSelector } from '../components/TokenSelector'
import { Button } from '../components/LegacyButton'
import { Icon } from '../components/icons'
import { Text } from '../components/Text'
import { cn } from '../lib/cn'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import {
  openConversation,
  sendMessage,
  setActiveThread,
  useChatBus,
  useThread,
  type PeerStatus,
} from '../shell/chat-bus'
import { nameFor, useAvatars, useDirectory } from '../shell/use-directory'
import { shortenFelt, useSession } from '../shell/session'
import { useBalance } from '../shell/use-balance'
import { useSend } from '../shell/use-send'
import { useTokenList } from '../shell/use-token-list'

export const Route = createFileRoute('/chat/$peer')({
  component: Thread,
})

//
// ONE CONVERSATION.
//
// ── EVERYTHING THE OLD `/chat` CLAIMED IS STILL CLAIMED HERE ─────────────────────────────
//
// The room costs nothing and asks nobody: paste an address that has registered with the pool and a
// conversation exists, from one free view call and the viewing key this browser already holds. No
// handshake, no directory, no account on any server.
//
// Messages are zero-deposit and travel off-chain, so a paused pool cannot stop them — a property
// of the transport rather than a promise. Sending MONEY in a thread is a pool transaction like any
// other and degrades like one: the button relabels with the live reason and stays pressable,
// because a silently dead control in a chat window reads as the app being broken rather than as
// the pool being paused. THE DEGRADED REASON IS READ, NEVER ASSERTED — an earlier draft hardcoded
// the paused blocker to show the wiring, which made the button claim the pool was paused whenever
// anyone opened the surface. That is the overclaim the anti-demo gate exists to catch, committed
// in the file that was supposed to demonstrate honesty about it.
//
// ── WHAT CHANGED IS WHERE THE THREAD LIVES ───────────────────────────────────────────────
//
// The messages are no longer React state. They are in `chat-log`, written by the bus mounted on
// the layout above — so they survive navigating to another conversation and back, and they survive
// a reload. This component reads them and marks the thread read while it is on screen.
//
function Thread() {
  const { peer } = Route.useParams()
  const reading = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const session = useSession()
  const ready = session.status === 'ready' ? session : null

  const bus = useChatBus()
  const entries = useThread(peer)
  const status: PeerStatus = bus.statuses[peer.trim().toLowerCase()] ?? { kind: 'checking' }
  const open = status.kind === 'open'

  const { entries: directory } = useDirectory()
  const name = useMemo(() => nameFor(directory, peer), [directory, peer])
  // The same fetch-and-cache the sidebar uses, scoped to this one peer — so a face shown in the
  // list does not turn back into an identicon the moment the conversation is opened.
  const avatars = useAvatars(directory)
  const avatar = avatars[peer.trim().toLowerCase()]

  const [draft, setDraft] = useState('')
  const [sendProblem, setSendProblem] = useState<string | null>(null)

  // Derive the room for a peer arrived at by deep link, and mark the thread read while it is the
  // one on screen. `null` on unmount matters: a thread left "active" after navigating away would
  // silently swallow every unread it should have counted.
  useEffect(() => {
    void openConversation(peer)
    setActiveThread(peer)
    return () => setActiveThread(null)
  }, [peer])

  const { tokens, loading: tokensLoading } = useTokenList()
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  // One dialog, two meanings: 'pay' moves money then seals the card; 'request' only seals the
  // ask. The distinction is the whole difference between the two cards, so it is state, not copy.
  const [money, setMoney] = useState<'pay' | 'request' | null>(null)
  const [picking, setPicking] = useState(false)
  const [token, setToken] = useState<TokenInfo | null>(null)

  /** What this account holds of the chosen token, from the same walk the balance card shows. */
  const heldWei = useMemo(() => {
    if (!token) return null
    const holding = balance?.tokens.find((t) => {
      try {
        return BigInt(t.token) === BigInt(token.address)
      } catch {
        return false
      }
    })
    return holding?.wei ?? null
  }, [balance, token])

  const amount = useAmountField({ decimals: token?.decimals ?? null, available: heldWei })

  const onSendText = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || !open) return
    setDraft('')
    setSendProblem(await sendMessage(peer, { kind: 'text', text }))
  }, [draft, open, peer])

  //
  // THE TWO HALVES OF A PAYMENT, IN THE ORDER THAT CANNOT LIE.
  //
  // The transfer settles FIRST, and only a confirmed one produces a card. Sealing the card first
  // would put a claim in the thread for a payment that might then fail — and the recipient has no
  // way to tell the difference, because the card is exactly as authentic either way. So the hash
  // is the precondition: no transaction, no card.
  //
  const onSendMoney = useCallback(async () => {
    if (!token || amount.wei === null || amount.wei === 0n || !open) return

    const outcome = await sending.send({
      kind: 'transfer',
      recipient: peer.trim(),
      token: token.address,
      symbol: token.symbol,
      amount: amount.wei,
    })
    if (!outcome.ok) return

    setMoney(null)
    amount.setText('')
    setSendProblem(
      await sendMessage(peer, {
        kind: 'payment',
        amount: toPlainText(amount.wei, token.decimals),
        symbol: token.symbol,
        token: token.address,
        transactionHash: outcome.transactionHash,
        ...(draft.trim() === '' ? {} : { text: draft.trim() }),
      }),
    )
    setDraft('')
  }, [amount, draft, open, peer, sending, token])

  //
  // A REQUEST SEALS AND SENDS — no chain, no quote, no balance. The dialog's confirm branches
  // here rather than in the button's label, so a request can never accidentally move money.
  //
  const onSendRequest = useCallback(async () => {
    if (!token || amount.wei === null || amount.wei === 0n || !open) return
    setMoney(null)
    const asked = toPlainText(amount.wei, token.decimals)
    amount.setText('')
    setSendProblem(
      await sendMessage(peer, {
        kind: 'request',
        amount: asked,
        symbol: token.symbol,
        token: token.address,
        ...(draft.trim() === '' ? {} : { text: draft.trim() }),
      }),
    )
    setDraft('')
  }, [amount, draft, open, peer, token])

  /** Their request card's Pay door: the same dialog, numbers filled in. */
  const onPayRequest = useCallback(
    (request: PayableRequest) => {
      const wanted = tokens.find((t) => {
        try {
          return BigInt(t.address) === BigInt(request.token)
        } catch {
          return false
        }
      })
      if (!wanted) {
        setSendProblem('That request names a token this build does not know — pay it from Send instead.')
        return
      }
      sending.reset()
      setToken(wanted)
      amount.setText(request.amount)
      setMoney('pay')
    },
    [tokens, amount, sending],
  )

  const onReact = useCallback(
    (targetId: string, emoji: string) => {
      void sendMessage(peer, { kind: 'reaction', emoji, target: targetId }).then(setSendProblem)
    },
    [peer],
  )

  const disclosure = disclosureFor('chat-payment')
  // The pool's live reason when there is one; otherwise the reason this particular button cannot
  // be pressed yet. Both are read rather than asserted — see the header.
  const moneyBlocker = currentBlocker(reading) ?? (open ? null : 'This thread is not open yet')

  return (
    <div className="flex min-w-0 flex-col gap-s12">
      <header className="flex items-center gap-s12 border-b border-solid border-surface3 pb-s12">
        {/* Mobile only: on desktop the sidebar is beside this and never went away. */}
        <Link
          to="/chat"
          aria-label="Back to conversations"
          className="focus-ring flex size-s28 shrink-0 items-center justify-center rounded-pill text-body2 text-neutral2 hover:bg-inset lg:hidden"
        >
          <span aria-hidden="true">‹</span>
        </Link>

        <PeerAvatar address={peer} avatar={avatar} size={40} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Text variant="subheading2" className="truncate">
            {name ?? shortenFelt(peer, 10, 8)}
          </Text>
          {/* The address is always shown, even under a name: a name is a label somebody claimed,
              and the address is the part that cannot be swapped. */}
          <Text variant="body4" className="numeric truncate text-neutral3">
            {name ? shortenFelt(peer, 10, 8) : statusLine(status)}
          </Text>
        </div>

        {/*
          [STUDIO] The sealed badge — a shield and the word, never the glyph alone. Rendered only
          while the room is genuinely open, because a sealed badge on a thread that cannot send is
          a claim about a room that does not exist yet.
        */}
        {open ? (
          <span className="flex shrink-0 items-center gap-s6 text-body4 text-neutral3">
            <Icon name="shield" size={13} strokeWidth={1.6} />
            sealed
          </span>
        ) : null}
        <ConnectionChip status={status} connection={bus.connection} />
      </header>

      {/* Every non-open state gets its own sentence in the body, where there is room for one. */}
      {open ? null : (
        <Text variant="body3" className={badStatus(status) ? 'text-exposed' : 'text-neutral2'}>
          {statusLine(status)}
        </Text>
      )}

      <ChatThread
        entries={entries}
        emptyNote={open ? CHAT_THREAD_EMPTY : ''}
        onPayRequest={onPayRequest}
        onReact={onReact}
      />

      {/*
        The composer stays mounted and disabled rather than appearing when a room opens: a control
        that materialises under the cursor is how a person ends up clicking the thing that took its
        place. Money lives IN the composer now — the two chips are the doors, and pressing one
        while the pool is degraded surfaces the live reason where the reply would land, instead of
        a dead button pretending nothing happened.
      */}
      <div className="flex flex-col gap-s8">
        <div className="flex items-end gap-s8">
          <div className="flex shrink-0 gap-s4 pb-s6">
            {(['pay', 'request'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={!open}
                aria-label={kind === 'pay' ? 'Send money in this thread' : 'Request money in this thread'}
                onClick={() => {
                  if (moneyBlocker) {
                    setSendProblem(moneyBlocker)
                    return
                  }
                  sending.reset()
                  amount.setText('')
                  setMoney(kind)
                }}
                className="focus-ring cursor-pointer rounded-pill border border-solid border-surface3 bg-raised px-s10 py-s6 text-buttonLabel4 text-neutral2 hover:text-neutral1 disabled:opacity-60"
              >
                {kind === 'pay' ? '$ Pay' : 'Ask'}
              </button>
            ))}
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — the convention every chat shares, and
              // one people have muscle memory for.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void onSendText()
              }
            }}
            disabled={!open}
            rows={1}
            placeholder={open ? 'Write — it seals before it leaves' : 'This thread is not open'}
            aria-label="Message"
            className="focus-ring max-h-[120px] min-h-[44px] flex-1 resize-y rounded-card bg-inset px-s12 py-s12 text-body3 text-neutral1 placeholder:text-neutral3 disabled:opacity-60"
          />
          <Button
            variant="primary"
            size="md"
            onClick={() => void onSendText()}
            disabled={!open || draft.trim() === ''}
          >
            Send
          </Button>
        </div>

        {sendProblem ? (
          <Text variant="body4" className="text-exposed">
            {sendProblem}
          </Text>
        ) : null}
      </div>

      {/*
        The authored panel, on the surface rather than behind a review dialog. A conversation has no
        confirm step to attach a disclosure to, so it stands next to the thread — which is also
        where it is true for every message, not just the paid ones.

        COLLAPSED TO ONE ROW (Wave 4). A thread is a place people read, and a permanently-open
        privacy panel under every conversation is the furniture Abu named as noise. The headline
        claim stays visible at rest and the detail is one press away — the same treatment the three
        reviews got, so the pattern means the same thing everywhere it appears.

        No `meter`: there is no anonymity set to measure on a conversation. `PrivacyRow` takes it as
        optional for exactly this case, and passing a fabricated one to fill the space would be the
        invented measurement the whole meter story exists to refuse.
      */}
      <PrivacyRow disclosure={disclosure} />

      <ResponsiveDialog
        open={money !== null}
        onOpenChange={(next) => (next ? undefined : setMoney(null))}
        label={money === 'request' ? 'Request money' : 'Send money'}
        modal
        dismissible={sending.stage === null}
      >
        <div className="flex w-full min-w-0 flex-col gap-s16">
          <Text variant="subheading1" as="h2">
            {money === 'request' ? 'Request money' : 'Send money'}
          </Text>
          <Text variant="body4" className="text-neutral2">
            {money === 'request'
              ? `A card in the thread asking ${name ? `@${name}` : shortenFelt(peer.trim())} for the amount — nothing moves until they press Pay.`
              : `It goes to ${shortenFelt(peer.trim())} — the account this thread is with. The amount and the token are the parts that are visible; which of your notes paid is not.`}
          </Text>

          <button
            type="button"
            onClick={() => setPicking(true)}
            className="focus-ring flex items-center justify-between gap-s12 rounded-card bg-inset px-s12 py-s12 text-left hover:bg-insetHovered"
          >
            <Text variant="body3">{token ? token.symbol : 'Choose a token'}</Text>
            <Text variant="body4" className="text-neutral2">
              Change
            </Text>
          </button>

          <AmountInput
            field={amount}
            symbol={token?.symbol ?? ''}
            // `confidenceOf` rather than a literal: `amount.ts` is explicit that a surface must
            // never decide a number looks trustworthy — whether the walk finished and whether it
            // can be dated already live on the balance model.
            balance={
              heldWei !== null && token && balance
                ? {
                    value: `${toPlainText(heldWei, token.decimals)} ${token.symbol}`,
                    confidence: confidenceOf(balance),
                  }
                : null
            }
            label="Amount to send"
          />

          {sending.problem ? (
            <Text variant="body4" className="text-exposed">
              {sending.problem}
            </Text>
          ) : null}

          <Button
            variant="primary"
            size="lg"
            fill
            onClick={() => void (money === 'request' ? onSendRequest() : onSendMoney())}
            disabled={
              sending.stage !== null ||
              !token ||
              amount.wei === null ||
              amount.wei === 0n ||
              // A request asks for money you do not have to hold — `short` only gates the pay arm.
              (money === 'pay' && amount.short)
            }
          >
            {sending.stage !== null
              ? 'Sending…'
              : money === 'request'
                ? 'Ask for it'
                : amount.short
                  ? `Not enough ${token?.symbol ?? ''}`
                  : 'Send'}
          </Button>
        </div>
      </ResponsiveDialog>

      <TokenSelector
        open={picking}
        onOpenChange={setPicking}
        tokens={tokens}
        loading={tokensLoading}
        selectedAddress={token?.address ?? null}
        onSelect={(next) => {
          setToken(next)
          setPicking(false)
        }}
      />
    </div>
  )
}

/** True for the states that are a refusal rather than a wait. */
function badStatus(status: PeerStatus): boolean {
  return status.kind === 'invalid' || status.kind === 'self' || status.kind === 'unregistered'
}

/**
 * One sentence per state.
 *
 * EVERY STATE HAS ITS OWN WORDS. "Not registered" and "we could not read the chain" are different
 * facts about a stranger's account, and collapsing them would tell someone their friend has not
 * signed up when the truth is that an RPC timed out.
 */
function statusLine(status: PeerStatus): string {
  switch (status.kind) {
    case 'checking':
      return 'Reading their key…'
    case 'invalid':
      return CHAT_PEER_INVALID
    case 'self':
      return CHAT_PEER_SELF
    case 'unregistered':
      return CHAT_PEER_UNREGISTERED
    case 'unreadable':
      return `The chain could not be read, so nothing is known about this address yet: ${status.because}`
    case 'open':
      // The room id is shown because it is what the relay sees. Nobody has to check it; showing it
      // is the difference between "we route your messages somehow" and a value on the screen.
      return `Room ${status.roomId.slice(0, 8)}… — derived here, from a key neither of you sent anywhere.`
  }
}

/** Live / reconnecting, and nothing when there is no room to be connected for. */
function ConnectionChip({
  status,
  connection,
}: {
  status: PeerStatus
  connection: ReturnType<typeof useChatBus>['connection']
}) {
  if (status.kind !== 'open' || connection === 'idle') return null
  const live = connection === 'live'
  return (
    <span className="flex shrink-0 items-center gap-s6 rounded-pill bg-inset px-s8 py-s4">
      <span aria-hidden="true" className={cn('size-s6 rounded-pill', live ? 'bg-settled' : 'bg-exposed')} />
      <Text variant="body4" className="text-neutral2">
        {live ? 'Live' : 'Reconnecting…'}
      </Text>
    </span>
  )
}
