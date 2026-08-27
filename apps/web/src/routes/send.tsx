import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { meterFor } from '@strk20/protocol/linkability'
import { maxSeverity } from '@strk20/protocol/privacy'
import type { TokenInfo } from '@strk20/protocol/token-list'
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import { BlockedButton } from '../components/BlockedButton'
import { CurrencyPanel } from '../components/CurrencyPanel'
import { LinkabilityMeter } from '../components/LinkabilityMeter'
import { RecipientField } from '../components/RecipientField'
import { SendReview } from '../components/SendReview'
import { SpeedBump, type SpeedBumpModel } from '../components/SpeedBump'
import { TokenSelector } from '../components/TokenSelector'
import { Text } from '../components/ui/Text'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import { useBalance } from '../shell/use-balance'
import { useCrowd } from '../shell/use-crowd'
import { useRecipient } from '../shell/use-recipient'
import { useSend } from '../shell/use-send'
import { useSession, shortenFelt } from '../shell/session'
import { findToken, useTokenList } from '../shell/use-token-list'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/send')({
  component: Send,
})

//
// THE SEND SURFACE — a shielded transfer from one pool account to another.
//
// ── WHY THIS IS THE FLOOR AND NOT A FEATURE ───────────────────────────────────────────────
//
// Every other surface in this app is a send with something bolted on: a swap withdraws to a venue
// and comes back, a crossing withdraws to a helper and does not. This is the send with nothing
// bolted on, and it is the one an ordinary person actually needs — pay a contractor, settle with a
// friend, move money to your own second account without the chain narrating it.
//
// The pipeline underneath it is the one that has been proven on mainnet twice over. What was
// missing until now was the screen: `README` said "the wallet has no Send form" and the wallet
// itself carried the hole with a comment rather than a button that could not submit.
//
// ── THE ONE THING A PRIVATE TRANSFER REQUIRES, SAID BEFORE THE FEE IS SPENT ───────────────
//
// The recipient must have registered a viewing key with the pool — without one there is no key to
// encrypt a note to, and the protocol refuses the transfer. That check is a free view call, so it
// runs while the address is still being typed rather than after a proof has been built and paid
// for. `useRecipient` holds it; `sendShielded` runs it again on the way through, and that second
// one is the gate that actually decides.
//
// ── WHAT YOU CAN SEND IS WHAT THE WALK FOUND ──────────────────────────────────────────────
//
// The asset list here is not AVNU's routable set — it is the tokens this account actually holds
// notes in, off the same discovery walk the balance on screen came from. A picker offering assets
// with nothing behind them would be a list of ways to be told no.
//

function Send() {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const { tokens } = useTokenList()
  const crowd = useCrowd()

  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  // ONE FLAG FOR THE WHOLE REVIEW FLOW, not one per dialog — the bumps take their turn while any
  // remain unacknowledged, and the review takes it once none do. See `bridge.tsx` for the full
  // reasoning; two booleans make "the last bump was cleared" and "the review is open" two facts
  // that have to be kept in step by hand.
  const [asked, setAsked] = useState(false)
  const [acknowledged, setAcknowledged] = useState<readonly string[]>([])

  const status = useRecipient(recipient, ready?.address ?? null)

  //
  // WHAT THIS ACCOUNT CAN SEND, AND WHY A HOLDING CAN BE MISSING FROM IT.
  //
  // A `TokenBalance` whose `decimals` is `null` is one whose scale this app has not verified
  // against the token's own contract. `TokenInfo` has no way to express that — its `decimals` is a
  // number — and picking 18 to fill the gap is how a 6-decimal balance gets misplaced by a factor
  // of a million, in the direction that looks like dust. So an unverified holding is not offered
  // here, and the count of them is carried out so the form can say so rather than silently show a
  // shorter list than the wallet does.
  //
  const { sendable, unverified } = useMemo(() => {
    const rows = balance?.tokens ?? []
    const out: TokenInfo[] = []
    let skipped = 0
    for (const holding of rows) {
      if (holding.wei <= 0n) continue
      if (holding.decimals === null) {
        skipped += 1
        continue
      }
      const listed = findToken(tokens, holding.token)
      out.push({
        address: holding.token,
        symbol: listed?.symbol ?? shortenFelt(holding.token),
        name: listed?.name ?? holding.token,
        // THE WALK'S SCALE, NOT THE LIST'S. `balances.ts` only fills this in when it has been
        // confirmed on chain; the list is consulted for the name and the logo and nothing that
        // arithmetic touches.
        decimals: holding.decimals,
        logoUri: listed?.logoUri ?? null,
        volumeUsd: listed?.volumeUsd ?? null,
        verified: listed?.verified ?? false,
      })
    }
    return { sendable: out, unverified: skipped }
  }, [balance, tokens])

  // The first holding is the default so the form is usable on arrival rather than asking for a
  // decision before anything can happen. An explicit choice always wins, and survives a refetch
  // that reorders the list.
  const token = useMemo(() => {
    if (chosen === null) return sendable[0] ?? null
    return sendable.find((t) => BigInt(t.address) === BigInt(chosen)) ?? sendable[0] ?? null
  }, [chosen, sendable])

  /** What this account holds in the chosen token, from the same walk the amount is checked against. */
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

  const parsed = useMemo(
    () => parseAmountInput(amount, token?.decimals ?? null),
    [amount, token],
  )

  const meter = useMemo(
    () =>
      meterFor({
        reading: crowd,
        amountWei: parsed.wei,
        decimals: token?.decimals ?? null,
      }),
    [crowd, parsed.wei, token],
  )

  const meterSeverity = maxSeverity(
    meter.state === 'measured' && meter.severity !== null ? [meter.severity] : [],
  )

  //
  // THE SPEED-BUMP CHAIN. One bump, and its id carries the AMOUNT.
  //
  // What was acknowledged was a claim about a specific size — "at this amount, your crowd is N" —
  // so any edit re-raises it. Re-using that acknowledgement for a figure ten times larger would be
  // one warning silently covering a different risk.
  //
  const bumps = useMemo<readonly SpeedBumpModel[]>(() => {
    if (meter.state !== 'measured' || meter.tier !== 2) return []
    return [
      {
        id: `crowd:${parsed.wei ?? 0n}`,
        title: meter.headline,
        lines: meter.lines,
        confirmLabel: meter.ctaLabel ?? 'Continue anyway',
        detail: <LinkabilityMeter meter={meter} />,
      },
    ]
  }, [meter, parsed.wei])

  const pendingBump = bumps.find((b) => !acknowledged.includes(b.id)) ?? null

  //
  // THE BLOCKER CHAIN (§7.10), ordered so the reason a person can act on comes first.
  //
  // The global stop leads: a paused pool outranks every local question. Then the account, then what
  // this account has to send at all, then what was typed — amount before recipient, because the
  // amount is the field the eye starts on and a form should not report the second problem while the
  // first is still there.
  //
  const reviewBlocker = useMemo((): string | null => {
    const paused = currentBlocker(health)
    if (paused) return paused
    if (!ready) return 'This browser has no account yet'
    if (read === null) return 'Reading your balance'
    if (read.state !== 'walked') return 'Your balance could not be read'
    if (sendable.length === 0) {
      return unverified > 0
        ? 'Nothing here can be sent — this account holds only tokens whose scale is unverified'
        : 'Nothing to send yet'
    }
    if (token === null) return 'Select an asset'
    if (parsed.problem) return parsed.problem
    if (parsed.wei === null || parsed.wei === 0n) return 'Enter an amount'
    // The protocol's own relabel, word for word. "Insufficient funds" is a bank's sentence and it
    // is wrong here twice: the user may hold plenty of public {SYMBOL}, and what is short is
    // specifically the shielded side.
    if (heldWei !== null && parsed.wei > heldWei) return `Not enough shielded ${token.symbol}`
    if (recipient.trim() === '') return 'Enter a recipient'
    switch (status.kind) {
      case 'idle':
      case 'checking':
        return 'Checking the recipient'
      case 'invalid':
        return 'That is not a Starknet address'
      case 'self':
        return 'That is your own address'
      case 'unregistered':
        return status.door.message
      case 'unreadable':
        return 'The recipient could not be checked'
      case 'registered':
        return null
    }
  }, [health, ready, read, sendable, unverified, token, parsed, heldWei, recipient, status])

  //
  // WHAT LANDED, KEPT AFTER THE REVIEW CLOSES.
  //
  // A send that succeeds and says nothing is worse than one that fails: the money has moved and the
  // only proof is a hash the user never saw. The review closes on success and the form keeps the
  // receipt — the amount, the recipient, and a link that can be checked.
  //
  const [sent, setSent] = useState<{
    hash: string
    amount: string
    symbol: string
    recipient: string
  } | null>(null)

  const onConfirm = useCallback(async () => {
    if (!token || parsed.wei === null) return
    const outcome = await sending.send({
      kind: 'transfer',
      recipient: recipient.trim(),
      token: token.address,
      symbol: token.symbol,
      amount: parsed.wei,
    })

    if (!outcome.ok) return
    setSent({
      hash: outcome.transactionHash,
      // Frozen at the moment it was sent. Re-deriving these later would let a form the user has
      // since edited rewrite the receipt for a transaction that already happened.
      amount: toPlainText(parsed.wei, token.decimals),
      symbol: token.symbol,
      recipient: recipient.trim(),
    })
    setAsked(false)
    setAmount('')
    setAcknowledged([])
  }, [token, parsed.wei, recipient, sending])

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s8">
        <div className="flex items-center justify-between gap-s12">
          <Text variant="heading3" as="h1">
            Send
          </Text>
        </div>

        <Text variant="body4" className="text-neutral2">
          A private transfer to another pool account. The recipient sees who sent it — private is not
          anonymous to the person you are paying.
        </Text>

        {sent ? <Sent {...sent} onDismiss={() => setSent(null)} /> : null}

        {/* The two fields, welded: 2px apart with their facing corners squared, so they read as one
            control with a seam rather than two stacked cards. */}
        <div className="flex flex-col gap-s2">
          <CurrencyPanel
            label="Send"
            corners="top"
            value={amount}
            onValueChange={setAmount}
            token={token}
            onSelectToken={sendable.length > 0 ? () => setPicking(true) : undefined}
            balanceLabel={
              heldWei === null || token === null
                ? null
                : `Balance: ${toPlainText(heldWei, token.decimals)} ${token.symbol}`
            }
            onPreset={
              heldWei === null || heldWei === 0n || token === null
                ? undefined
                : (fraction) =>
                    setAmount(
                      toPlainText(
                        // Integer arithmetic on the wei, never a float on the display value — a
                        // quarter of an 18-decimal balance through `Number` loses the last digits.
                        (heldWei * BigInt(Math.round(fraction * 100))) / 100n,
                        token.decimals,
                      ),
                    )
            }
            invalid={heldWei !== null && parsed.wei !== null && parsed.wei > heldWei}
          />

          <RecipientField value={recipient} onValueChange={setRecipient} status={status} />
        </div>

        {/*
          The holdings this form cannot offer, named rather than quietly missing. Someone looking at
          a wallet with three rows and a picker with two is owed the difference.
        */}
        {unverified > 0 ? (
          <Text variant="body4" className="text-neutral2">
            {unverified === 1 ? 'One holding is' : `${unverified} holdings are`} not listed above:
            their scale has not been verified on chain, and sending an amount at a guessed scale is
            how money goes missing by a factor of a million.
          </Text>
        ) : null}

        {/* The crowd as a line on the form, and as the full drawing at the moment of action. */}
        <LinkabilityMeter meter={meter} variant="row" />

        <BlockedButton
          blocker={reviewBlocker}
          action="Review send"
          // The bumps are walked BEFORE the review, which is Uniswap's order and the right one: a
          // warning shown alongside a confirm button competes with it, and one shown first is read.
          onPress={() => setAsked(true)}
          severity={meterSeverity}
        />
      </div>

      <SpeedBump
        bump={asked ? pendingBump : null}
        onAcknowledge={(id) => setAcknowledged((previous) => [...previous, id])}
        onDismiss={() => {
          // Backing out of a warning drops every acknowledgement. Somebody who read a risk and chose
          // not to proceed has not agreed to the ones they already clicked past.
          setAsked(false)
          setAcknowledged([])
        }}
      />

      {token ? (
        <SendReview
          open={asked && pendingBump === null}
          onOpenChange={(open) => {
            if (!open) setAsked(false)
          }}
          token={token}
          amountDisplay={parsed.wei === null ? '0' : toPlainText(parsed.wei, token.decimals)}
          recipient={recipient.trim()}
          meter={meter}
          onConfirm={onConfirm}
          //
          // THE BUTTON SAYS WHAT IS HAPPENING, or why it cannot. A stage label occupies the same
          // slot as a blocker because a button that still said "Send" while a proof was generating
          // invites a second press, and a second press is a double-spend one of the two pays a
          // revert for.
          //
          blocker={
            sending.stage
              ? (STAGE_LABEL[sending.stage] ?? 'Working…')
              : sending.problem
          }
        />
      ) : null}

      <TokenSelector
        open={picking}
        onOpenChange={setPicking}
        tokens={sendable}
        selectedAddress={token?.address ?? null}
        balanceFor={(candidate) => {
          const holding = balance?.tokens.find((t) => {
            try {
              return BigInt(t.token) === BigInt(candidate.address)
            } catch {
              return false
            }
          })
          return holding ? toPlainText(holding.wei, candidate.decimals) : null
        }}
        onSelect={(next) => {
          setChosen(next.address)
          setPicking(false)
          // The amount does NOT survive an asset change, and this is the opposite of the swap
          // surface's rule on purpose. There the figure is a size being re-quoted; here it is a
          // quantity of a specific thing, and 12 USDC silently becoming 12 ETH is the one
          // reinterpretation a send form must never make.
          setAmount('')
        }}
      />
    </Surface>
  )
}

/**
 * The receipt for a transfer that landed.
 *
 * It says the transaction succeeded, which is what this browser watched, and nothing about what the
 * recipient can now do with it — their note is theirs and this app cannot see it.
 */
function Sent({
  hash,
  amount,
  symbol,
  recipient,
  onDismiss,
}: {
  hash: string
  amount: string
  symbol: string
  recipient: string
  onDismiss: () => void
}) {
  return (
    <section className="flex flex-col gap-s8 rounded-large bg-inset p-s16" aria-live="polite">
      <div className="flex items-start justify-between gap-s12">
        <Text variant="body2" className="text-neutral1">
          Sent {amount} {symbol}
        </Text>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="focus-ring -m-s4 shrink-0 rounded-control p-s4 text-neutral3 hover:bg-raised hover:text-neutral1"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <Text variant="body4" className="numeric break-all text-neutral2">
        {recipient}
      </Text>

      <a
        href={voyagerTxUrl(hash) ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="focus-ring w-fit rounded-control text-body4 text-accent1 underline"
      >
        Check the transaction ↗
      </a>
    </section>
  )
}

/**
 * What each pipeline stage is called on screen.
 *
 * `relay` is reworded, as it is on every other surface and for the same reason: this browser is not
 * relaying to anyone, it is signing and broadcasting. `mature` is the wait nobody expects — a note
 * exists on chain before the pool will let it be spent — so it says what is being waited for rather
 * than naming the state.
 */
const STAGE_LABEL: Record<string, string> = {
  build: 'Building the send…',
  prove: 'Proving…',
  relay: 'Signing and broadcasting…',
  mature: 'Waiting for the pool to accept it…',
  confirmed: 'Confirming on chain…',
}
