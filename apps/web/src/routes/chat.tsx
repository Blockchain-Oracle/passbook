import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { disclosureFor } from '@strk20/protocol/disclosure'
import { confidenceOf, toPlainText } from '@strk20/protocol/amount'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { AmountInput, useAmountField } from '../components/AmountInput'
import { BlockedButton } from '../components/BlockedButton'
import { ChatThread } from '../components/ChatThread'
import { Disclosure } from '../components/Disclosure'
import { TokenSelector } from '../components/TokenSelector'
import { VisibilityMatrix } from '../components/VisibilityMatrix'
import { Button } from '../components/ui/Button'
import { Text } from '../components/ui/Text'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { Surface } from '../shell/Surface'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import { shortenFelt, useSession } from '../shell/session'
import { useBalance } from '../shell/use-balance'
import { useRoom, type RoomStatus } from '../shell/use-room'
import { useSend } from '../shell/use-send'
import { useTokenList } from '../shell/use-token-list'

export const Route = createFileRoute('/chat')({
  component: Chat,
})

//
// MONEY AS A MESSAGE.
//
// ── THE ROOM COSTS NOTHING AND ASKS NOBODY ───────────────────────────────────────────────
//
// Paste an address that has registered with the pool and a conversation exists. The key comes from
// one free view call against the chain and the viewing key this browser already holds — no
// handshake, no directory, no account on any server. `protocol/src/room.ts` holds the derivation.
//
// ── WHAT DEGRADES AND WHAT DOES NOT ──────────────────────────────────────────────────────
//
// Messages are zero-deposit and travel off-chain, so a paused pool cannot stop them. That is a
// property of the transport rather than a promise. Sending MONEY in a thread is a pool transaction
// like any other, so it degrades like any other: the button relabels with the live reason and
// stays pressable, because a silently dead control in a chat window reads as the app being broken
// rather than as the pool being paused.
//
// THE DEGRADED REASON IS READ, NEVER ASSERTED — an earlier draft of this file hardcoded the paused
// blocker to show the wiring, which made the button claim the pool was paused whenever anyone
// opened /chat. That is the overclaim the anti-demo gate exists to catch, committed in the file
// that was supposed to demonstrate honesty about it.
//
// ── THE STANDING DISCLOSURE IS NOT OPTIONAL FURNITURE ────────────────────────────────────
//
// The room key derives from pool viewing keys, and StarkWare's auditor holds an escrowed copy of
// those. So the auditor can read this conversation without asking. `CHAT_AUDITOR_DERIVES` says so
// in the authored panel below, on screen, before anyone types anything.
//
function Chat() {
  const reading = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const session = useSession()
  const ready = session.status === 'ready' ? session : null

  const [peer, setPeer] = useState('')
  const [draft, setDraft] = useState('')
  const [sendProblem, setSendProblem] = useState<string | null>(null)

  const room = useRoom(peer, ready)
  const open = room.status.kind === 'open'

  const { tokens, loading: tokensLoading } = useTokenList()
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  const [paying, setPaying] = useState(false)
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
    setSendProblem(await room.send({ kind: 'text', text }))
  }, [draft, open, room])

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

    setPaying(false)
    amount.setText('')
    setSendProblem(
      await room.send({
        kind: 'payment',
        amount: toPlainText(amount.wei, token.decimals),
        symbol: token.symbol,
        token: token.address,
        transactionHash: outcome.transactionHash,
        ...(draft.trim() === '' ? {} : { text: draft.trim() }),
      }),
    )
    setDraft('')
  }, [amount, draft, open, peer, room, sending, token])

  const disclosure = disclosureFor('chat-payment')
  // The pool's live reason when there is one; otherwise the reason this particular button cannot
  // be pressed yet. Both are read rather than asserted — see the header.
  const moneyBlocker =
    currentBlocker(reading) ?? (open ? null : 'Open a thread first')

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s16">
        <div className="flex items-center justify-between gap-s12">
          <Text variant="heading3" as="h1">
            Chat
          </Text>
          <ConnectionChip status={room.status} />
        </div>

        <PeerField value={peer} onValueChange={setPeer} status={room.status} />

        <ChatThread
          entries={room.thread}
          emptyNote={
            open
              ? 'No messages yet. What you type is sealed in this browser before it leaves.'
              : 'Paste an address above to open a thread.'
          }
        />

        {/*
          The composer stays mounted and disabled rather than appearing when a room opens: a
          control that materialises under the cursor is how a person ends up clicking the thing
          that took its place.
        */}
        <div className="flex flex-col gap-s8">
          <div className="flex items-end gap-s8">
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
              placeholder={open ? 'Message' : 'Open a thread to write'}
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

          <BlockedButton
            blocker={moneyBlocker}
            action="Send money in this thread"
            onPress={() => {
              sending.reset()
              setPaying(true)
            }}
          />
        </div>

        {/*
          The authored panel and the matrix, on the surface rather than behind a review dialog. A
          conversation has no confirm step to attach a disclosure to, so it stands next to the
          thread — which is also where it is true for every message, not just the paid ones.
        */}
        <Disclosure disclosure={disclosure} />
        <VisibilityMatrix
          context="chat-payment"
          statedAbove={disclosure.authored ? disclosure.lines.map((l) => l.text).join(' ') : ''}
        />
      </div>

      <ResponsiveDialog open={paying} onOpenChange={setPaying} label="Send money" modal>
        <div className="flex w-full min-w-0 flex-col gap-s16">
          <Text variant="subheading1" as="h2">
            Send money
          </Text>
          <Text variant="body4" className="text-neutral2">
            It goes to {shortenFelt(peer.trim())} — the account this thread is with. The amount and
            the token are the parts that are visible; which of your notes paid is not.
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
            onClick={() => void onSendMoney()}
            disabled={sending.stage !== null || !token || amount.wei === null || amount.wei === 0n || amount.short}
          >
            {sending.stage !== null
              ? 'Sending…'
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
    </Surface>
  )
}

/**
 * The address that opens a thread, and the sentence for whatever state it is in.
 *
 * EVERY STATE HAS ITS OWN WORDS. "Not registered" and "we could not read the chain" are different
 * facts about a stranger's account, and collapsing them would tell someone their friend has not
 * signed up when the truth is that an RPC timed out.
 */
function PeerField({
  value,
  onValueChange,
  status,
}: {
  value: string
  onValueChange: (next: string) => void
  status: RoomStatus
}) {
  const note = statusNote(status)
  const bad = status.kind === 'invalid' || status.kind === 'self' || status.kind === 'unregistered'

  return (
    <div
      className={[
        'flex flex-col gap-s8 rounded-large border border-solid p-s16',
        status.kind === 'open' ? 'border-surface3 bg-raised' : 'border-transparent bg-inset',
        bad && value.trim() !== '' ? 'border-irreversible' : '',
      ].join(' ')}
    >
      <Text variant="body4" className="text-neutral2">
        Thread with
      </Text>
      <input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="0x…"
        aria-label="Their address"
        spellCheck={false}
        autoComplete="off"
        className="focus-ring numeric w-full rounded-control bg-transparent text-body3 text-neutral1 placeholder:text-neutral3"
      />
      {note ? (
        <Text variant="body4" className={bad ? 'text-exposed' : 'text-neutral2'}>
          {note}
        </Text>
      ) : null}
    </div>
  )
}

function statusNote(status: RoomStatus): string | null {
  switch (status.kind) {
    case 'idle':
      return 'Anyone who has registered with the pool can be reached here. Nothing is published by starting a conversation.'
    case 'invalid':
      return 'That is not a Starknet address.'
    case 'checking':
      return 'Reading their key…'
    case 'unregistered':
      return 'This address has not registered with the pool, so there is no key to derive a room from. They need to open the app once.'
    case 'unreadable':
      return `The chain could not be read, so nothing is known about this address yet: ${status.because}`
    case 'self':
      return 'That is your own address.'
    case 'open':
      // The room id is shown because it is what the relay sees. Nobody has to check it; showing it
      // is the difference between "we route your messages somehow" and a value on the screen.
      return `Room ${status.roomId.slice(0, 8)}… — derived here, from a key neither of you sent anywhere.`
  }
}

/** Live / reconnecting, and nothing when there is no thread to be connected to. */
function ConnectionChip({ status }: { status: RoomStatus }) {
  if (status.kind !== 'open') return null
  const live = status.connection === 'live'
  return (
    <span className="flex items-center gap-s6 rounded-pill bg-inset px-s8 py-s4">
      <span
        aria-hidden="true"
        className={`size-s6 rounded-pill ${live ? 'bg-shielded' : 'bg-exposed'}`}
      />
      <Text variant="body4" className="text-neutral2">
        {live ? 'Live' : 'Reconnecting…'}
      </Text>
    </span>
  )
}
