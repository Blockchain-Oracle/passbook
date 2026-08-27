import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import {
  BRIDGE_USDC,
  BRIDGE_USDC_DECIMALS,
  BRIDGE_USDC_SYMBOL,
  DESTINATIONS,
  deliveredWei,
  OUTBOUND_ANONYMIZER,
  parseDestination,
} from '@strk20/protocol/bridge'
import { meterFor } from '@strk20/protocol/linkability'
import { maxSeverity } from '@strk20/protocol/privacy'
import type { TokenInfo } from '@strk20/protocol/token-list'
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import { BlockedButton } from '../components/BlockedButton'
import { BridgeReview } from '../components/BridgeReview'
import { ChainSelector } from '../components/ChainSelector'
import { CurrencyPanel } from '../components/CurrencyPanel'
import { DestinationField } from '../components/DestinationField'
import { LinkabilityMeter } from '../components/LinkabilityMeter'
import { SpeedBump, type SpeedBumpModel } from '../components/SpeedBump'
import { Text } from '../components/ui/Text'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import { useBalance } from '../shell/use-balance'
import { useCrowd } from '../shell/use-crowd'
import { useForwardFee } from '../shell/use-forward-fee'
import { useSend } from '../shell/use-send'
import { useSession } from '../shell/session'
import { findToken, useTokenList } from '../shell/use-token-list'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/bridge')({
  component: Bridge,
})

//
// THE CROSSING SURFACE.
//
// ── WHAT IS REAL ON THIS SCREEN ───────────────────────────────────────────────────────────
//
// All of it. The helper is StarkWare's own `OutboundAnonymizer`, live on mainnet with hundreds of
// successful burns behind it; the fee is Circle's, read per quote; and Send builds the same
// withdraw-then-invoke sandwich the swap surface proved, with the return leg removed.
//
// In one transaction: spend a shielded USDC note, send the change back to yourself, withdraw the
// crossing amount to the helper, and instruct the helper to burn it through CCTP to an address on
// another chain. Nothing ever touches a public Starknet address of the user's, and Circle's
// forwarding service pays the gas at the far end — so the destination needs no gas, no wallet
// software and no prior history.
//
// ── AND WHAT IT DOES NOT DO, SAID HERE RATHER THAN DISCOVERED ─────────────────────────────
//
// Outbound only. Bringing value back needs a different contract, a relayer that must stay alive,
// and a fund-stranding failure path nobody here has rehearsed — so it is not built and the surface
// does not imply it is.
//
// It is also not an unlinkable bridge, and the review says so in the research's own words: the
// crossing hides which shielded note funded the withdrawal, and hides neither the amount, the
// destination, the chain, nor the timing. The anonymity-set meter is on screen for exactly that
// reason — a distinctive amount is a fingerprint across the crossing, and the honest version of
// this pitch is showing the user their real crowd size rather than claiming they have one.
//
// The helper is the SPONSOR'S CAIRO. We did not write, audit or deploy it.
//

function Bridge() {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const { tokens } = useTokenList()
  const crowd = useCrowd()

  const [chain, setChain] = useState(DESTINATIONS[0]!)
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState('')
  const [picking, setPicking] = useState(false)
  //
  // ONE FLAG FOR THE WHOLE REVIEW FLOW, not one per dialog.
  //
  // Pressing Review sets it; the bumps and the review then take their turn off ONE piece of state
  // — bumps while any remain unacknowledged, the review once none do. Two independent booleans
  // would make "the last bump was cleared" and "the review is open" separate facts that have to be
  // kept in step by hand, and the state where both are false is a user who pressed a button and
  // watched nothing happen.
  //
  const [asked, setAsked] = useState(false)

  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, read } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)
  const sending = useSend(read, ready)

  //
  // THE ASSET IS NOT A CHOICE, AND THE DECIMALS ARE NOT THE LIST'S.
  //
  // The helper has one token baked in at construction, so the panel shows it and offers no picker.
  // The list is consulted only for the LOGO: `token-list.ts` verifies decimals on chain and drops
  // any entry that disagrees, which makes it trustworthy — but the arithmetic below still uses the
  // pinned 6 rather than whatever arrived, because a scale read from a network response is a scale
  // that can be absent, and an absent scale on a money field is not a case worth having.
  //
  const usdc: TokenInfo = useMemo(() => {
    const listed = findToken(tokens, BRIDGE_USDC)
    return {
      address: BRIDGE_USDC,
      symbol: BRIDGE_USDC_SYMBOL,
      name: listed?.name ?? 'USDC',
      decimals: BRIDGE_USDC_DECIMALS,
      logoUri: listed?.logoUri ?? null,
      volumeUsd: null,
      verified: listed?.verified ?? false,
    }
  }, [tokens])

  /** What this account can actually send, from the same walk the amount was checked against. */
  const heldWei = useMemo(() => {
    const holding = balance?.tokens.find((t) => {
      try {
        return BigInt(t.token) === BigInt(BRIDGE_USDC)
      } catch {
        return false
      }
    })
    return holding?.wei ?? null
  }, [balance])

  const parsed = useMemo(
    () => parseAmountInput(amount, BRIDGE_USDC_DECIMALS),
    [amount],
  )

  const parsedDestination = useMemo(
    () => parseDestination(destination, chain),
    [destination, chain],
  )
  const resolved = parsedDestination.state === 'ok'

  const fee = useForwardFee({
    destinationDomain: chain.domain,
    amount: parsed.wei,
  })
  const quoted = fee.result?.state === 'quoted' ? fee.result.fee : null

  const delivered =
    quoted && parsed.wei !== null ? deliveredWei(parsed.wei, quoted.maxFeeWei) : null

  const meter = useMemo(
    () =>
      meterFor({
        reading: crowd,
        amountWei: parsed.wei,
        decimals: BRIDGE_USDC_DECIMALS,
      }),
    [crowd, parsed.wei],
  )

  const meterSeverity = maxSeverity(
    meter.state === 'measured' && meter.severity !== null ? [meter.severity] : [],
  )

  //
  // THE SPEED-BUMP CHAIN. Ordered, and each clears only its own flag — see `SpeedBump.tsx`.
  //
  // ACKNOWLEDGEMENTS ARE KEYED BY BUMP ID, AND WHAT EACH ID CARRIES IS THE DECISION.
  //
  // The chain bump's id carries the CHAIN, so it stays cleared while the amount moves — the
  // untested delivery path is a fact about Solana, not about how much is being sent. The crowd
  // bump's id carries the AMOUNT, so any edit re-raises it, because what was acknowledged was a
  // claim about a specific size: "at this amount, your crowd is N". Re-using that acknowledgement
  // for a figure ten times larger would be one warning silently covering a different risk, which
  // is the whole failure the per-bump flag exists to prevent.
  //
  const [acknowledged, setAcknowledged] = useState<readonly string[]>([])

  const bumps = useMemo<readonly SpeedBumpModel[]>(() => {
    const out: SpeedBumpModel[] = []
    if (chain.caveat) {
      out.push({
        id: `chain:${chain.key}`,
        title: `${chain.name} has an untested delivery path`,
        lines: [chain.caveat],
        confirmLabel: `Send to ${chain.name} anyway`,
      })
    }
    // Tier 2 is the meter's loud verdict, and its copy is already authored — headline, lines and
    // the "Exit anyway" label all come out of `linkability.ts` rather than being written here.
    if (meter.state === 'measured' && meter.tier === 2) {
      out.push({
        id: `crowd:${parsed.wei ?? 0n}`,
        title: meter.headline,
        lines: meter.lines,
        confirmLabel: meter.ctaLabel ?? 'Continue anyway',
        detail: <LinkabilityMeter meter={meter} />,
      })
    }
    return out
  }, [chain, meter, parsed.wei])

  const pendingBump = bumps.find((b) => !acknowledged.includes(b.id)) ?? null

  //
  // THE BLOCKER CHAIN (§7.10), ordered so the reason a person can act on comes first.
  //
  // The global stop leads: a paused pool outranks every local question. Then the account, then what
  // was typed, then what the fee service said — the last of which is the only one that can be
  // resolved by waiting rather than by doing something.
  //
  // Written with returns rather than a `??` chain: the last two reasons depend on the amount and
  // the quote being present, and a chain that has already ruled out `null` cannot say so to the
  // type checker. Same order, same rule, and the ordering is still the only thing it encodes.
  const reviewBlocker = useMemo((): string | null => {
    const paused = currentBlocker(health)
    if (paused) return paused
    if (!ready) return 'This browser has no account yet'
    if (parsed.problem) return parsed.problem
    if (parsed.wei === null || parsed.wei === 0n) return 'Enter an amount'
    if (heldWei !== null && parsed.wei > heldWei) return `Not enough ${BRIDGE_USDC_SYMBOL}`
    if (parsedDestination.state === 'refused') return parsedDestination.because
    if (fee.loading && !fee.stale) return 'Reading the bridge fee'
    if (fee.result?.state === 'unavailable') return fee.result.because
    if (quoted === null) return 'Reading the bridge fee'
    // The helper's own `AMOUNT_LE_MAX_FEE`, taken for free and said as a floor rather than a code.
    if (delivered === null) {
      const floor = toPlainText(quoted.maxFeeWei, BRIDGE_USDC_DECIMALS)
      return `Send more than ${floor} ${BRIDGE_USDC_SYMBOL} — below that the fee takes all of it`
    }
    return null
  }, [health, ready, parsed, heldWei, parsedDestination, fee, quoted, delivered])

  //
  // WHAT LANDED, KEPT AFTER THE REVIEW CLOSES.
  //
  // A crossing that succeeds and says nothing is the worst outcome this screen has, worse than a
  // failure: the USDC is gone from the pool, it is on its way to another chain, and the only proof
  // is a hash the user never saw. So the review closes on success and the form keeps the receipt —
  // the amount, the destination, and a link that can be checked.
  //
  const [landed, setLanded] = useState<{
    hash: string
    delivered: string
    chainName: string
    destination: string
  } | null>(null)

  const onConfirm = useCallback(async () => {
    if (parsedDestination.state !== 'ok' || parsed.wei === null || quoted === null) return
    const outcome = await sending.send({
      kind: 'bridge',
      // The helper, on BOTH legs. `planSend` refuses the send if these ever disagree — anything
      // left sitting in the helper is burnable by whoever calls it next.
      recipient: OUTBOUND_ANONYMIZER,
      token: BRIDGE_USDC,
      symbol: BRIDGE_USDC_SYMBOL,
      amount: parsed.wei,
      bridge: {
        helper: OUTBOUND_ANONYMIZER,
        destinationDomain: chain.domain,
        mintRecipient: parsedDestination.mintRecipient,
        maxFeeWei: quoted.maxFeeWei,
        // Carried from the QUOTE, not re-read from the constant: a fee quoted for one finality
        // tier on a burn declaring another is the mismatch that strands transfers.
        minFinalityThreshold: quoted.finalityThreshold,
        chainName: chain.name,
      },
    })

    if (!outcome.ok) return
    setLanded({
      hash: outcome.transactionHash,
      // Frozen at the moment it was sent. Re-deriving these from state later would let a form the
      // user has since edited rewrite a receipt for a transaction that already happened.
      delivered: toPlainText(delivered ?? 0n, BRIDGE_USDC_DECIMALS),
      chainName: chain.name,
      destination: destination.trim(),
    })
    setAsked(false)
    setAmount('')
  }, [parsedDestination, parsed.wei, quoted, chain, sending, delivered, destination])

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s8">
        <div className="flex items-center justify-between gap-s12">
          <Text variant="heading3" as="h1">
            Bridge
          </Text>
        </div>

        {/* Said once, at the top, rather than discovered at the end of a form: this goes one way. */}
        <Text variant="body4" className="text-neutral2">
          Send shielded USDC out to another chain. Outbound only — bringing value back is not built.
        </Text>

        {landed ? <Landed {...landed} onDismiss={() => setLanded(null)} /> : null}

        <div className="flex flex-col gap-s2">
          <CurrencyPanel
            label="Send"
            corners="top"
            value={amount}
            onValueChange={setAmount}
            token={usdc}
            // No picker: the helper has one token baked in and cannot be passed another.
            balanceLabel={
              heldWei === null
                ? null
                : `Balance: ${toPlainText(heldWei, BRIDGE_USDC_DECIMALS)} ${BRIDGE_USDC_SYMBOL}`
            }
            onPreset={
              heldWei === null || heldWei === 0n
                ? undefined
                : (fraction) =>
                    setAmount(
                      toPlainText(
                        // Integer arithmetic on the wei, never a float on the display value —
                        // 0.25 of a 6-decimal balance through `Number` loses the last digits.
                        (heldWei * BigInt(Math.round(fraction * 100))) / 100n,
                        BRIDGE_USDC_DECIMALS,
                      ),
                    )
            }
            invalid={heldWei !== null && parsed.wei !== null && parsed.wei > heldWei}
          />

          <DestinationField
            value={destination}
            onValueChange={setDestination}
            chain={chain}
            onSelectChain={() => setPicking(true)}
            resolved={resolved}
            problem={parsedDestination.state === 'refused' ? parsedDestination.because : null}
          />
        </div>

        {quoted ? (
          <dl className="flex flex-col gap-s8 rounded-card border border-solid border-surface3 p-s12">
            <Row
              label={`Arrives on ${chain.name}`}
              value={
                delivered === null
                  ? '—'
                  : `${toPlainText(delivered, BRIDGE_USDC_DECIMALS)} ${BRIDGE_USDC_SYMBOL}`
              }
            />
            <Row
              label="Fee"
              value={`${toPlainText(quoted.maxFeeWei, BRIDGE_USDC_DECIMALS)} ${BRIDGE_USDC_SYMBOL}`}
            />
            <Row label="Delivery" value="Circle pays the gas at the far end" />
          </dl>
        ) : null}

        {/* The crowd as a line on the form, and as the full drawing at the moment of action. */}
        <LinkabilityMeter meter={meter} variant="row" />

        <BlockedButton
          blocker={reviewBlocker}
          action="Review crossing"
          // The bumps are walked BEFORE the review, which is Uniswap's order and the right one: a
          // warning shown alongside a confirm button competes with it, and a warning shown first
          // is read. Nothing here decides that — `pendingBump` does, off the same flag.
          onPress={() => setAsked(true)}
          severity={meterSeverity}
        />
      </div>

      <SpeedBump
        bump={asked ? pendingBump : null}
        onAcknowledge={(id) => setAcknowledged((previous) => [...previous, id])}
        onDismiss={() => {
          // Backing out of a warning drops every acknowledgement, not just this one. Somebody who
          // read a risk and chose not to proceed has not agreed to the ones they already clicked
          // past, and re-raising them next time costs a press the situation is worth.
          setAsked(false)
          setAcknowledged([])
        }}
      />

      <BridgeReview
        open={asked && pendingBump === null}
        onOpenChange={(open) => {
          if (!open) setAsked(false)
        }}
        chain={chain}
        destination={destination.trim()}
        sendDisplay={parsed.wei === null ? '0' : toPlainText(parsed.wei, BRIDGE_USDC_DECIMALS)}
        deliveredDisplay={delivered === null ? null : toPlainText(delivered, BRIDGE_USDC_DECIMALS)}
        forwardFeeDisplay={
          quoted === null ? null : toPlainText(quoted.forwardFeeWei, BRIDGE_USDC_DECIMALS)
        }
        protocolFeeDisplay={
          quoted === null ? null : toPlainText(quoted.protocolFeeWei, BRIDGE_USDC_DECIMALS)
        }
        meter={meter}
        onConfirm={onConfirm}
        //
        // THE BUTTON SAYS WHAT IS HAPPENING, or why it cannot. Ordered so the reason a person can
        // act on comes first — and a stage label occupies the same slot because a button that
        // still said "Send" while a proof was generating invites a second press, and a second
        // press is a double-spend one of the two pays a revert for.
        //
        blocker={
          read === null
            ? 'Reading your balance…'
            : read.state !== 'walked'
              ? 'Your balance could not be read'
              : fee.stale
                ? 'Re-reading the fee…'
                : sending.stage
                  ? (STAGE_LABEL[sending.stage] ?? 'Working…')
                  : sending.problem
        }
      />

      <ChainSelector
        open={picking}
        onOpenChange={setPicking}
        selectedKey={chain.key}
        onSelect={(next) => {
          setChain(next)
          //
          // THE DESTINATION IS KEPT, NOT CLEARED, AND THE PARSER SORTS IT OUT.
          //
          // Someone switching from Base to Arbitrum means the same address on a different chain,
          // and clearing it makes them paste it again. Switching to Solana means the address is now
          // wrong, and `parseDestination` says so in a sentence naming both halves — which is more
          // useful than an empty field that silently forgot what they typed.
          //
        }}
      />
    </Surface>
  )
}

/**
 * The receipt for a crossing that landed on Starknet.
 *
 * ── IT SAYS "ON ITS WAY", NOT "ARRIVED", AND THAT IS NOT HEDGING ──────────────────────────
 *
 * What this app watched is the Starknet half: the note was spent and the burn happened. The mint at
 * the far end is Circle's to submit and typically lands in seconds — but this browser did not see
 * it, and a receipt claiming an arrival nobody observed is the overclaim the whole product is
 * built against. The Starknet link is offered because it is the half that CAN be checked.
 */
function Landed({
  hash,
  delivered,
  chainName,
  destination,
  onDismiss,
}: {
  hash: string
  delivered: string
  chainName: string
  destination: string
  onDismiss: () => void
}) {
  return (
    <section className="flex flex-col gap-s8 rounded-large bg-inset p-s16" aria-live="polite">
      <div className="flex items-start justify-between gap-s12">
        <Text variant="body2" className="text-neutral1">
          {delivered} {BRIDGE_USDC_SYMBOL} is on its way to {chainName}
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
        {destination}
      </Text>

      <Text variant="body4" className="text-neutral2">
        The burn is on Starknet. Circle submits the transfer at the far end — usually within seconds,
        and this browser does not watch it happen.
      </Text>

      <a
        href={voyagerTxUrl(hash) ?? undefined}
        target="_blank"
        rel="noreferrer"
        className="focus-ring w-fit rounded-control text-body4 text-accent1 underline"
      >
        Check the Starknet transaction ↗
      </a>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-s12">
      <Text as="dt" variant="body4" className="text-neutral2">
        {label}
      </Text>
      <Text as="dd" variant="body4" className="numeric text-neutral1">
        {value}
      </Text>
    </div>
  )
}

/**
 * What each pipeline stage is called on screen.
 *
 * The swap surface's labels, with one word changed: `mature` is not a wait this surface has, since
 * a crossing mints no note to wait for — but the stage exists in the union and a missing key would
 * render "Working…" for a state that has a name. `relay` is reworded for the reason it is
 * everywhere else: this browser is not relaying to anyone, it is signing and broadcasting.
 */
const STAGE_LABEL: Record<string, string> = {
  build: 'Building the crossing…',
  prove: 'Proving…',
  relay: 'Signing and broadcasting…',
  mature: 'Waiting for the pool…',
  confirmed: 'Confirming on chain…',
}
