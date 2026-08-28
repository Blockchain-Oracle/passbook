import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { disclosureFor } from '@strk20/protocol/disclosure'
import { meterFor } from '@strk20/protocol/linkability'
import { maxSeverity } from '@strk20/protocol/privacy'
import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
// `buildSwap` alongside the rest: `quote.ts` is already in this route's chunk for `minimumOut`,
// so importing it lazily would be the `INEFFECTIVE_DYNAMIC_IMPORT` the build gate rejects. It is
// a fetch-only module with no SDK edge, which is why it can sit here at all.
import { buildSwap, DEFAULT_SLIPPAGE_BPS, minimumOut, priceImpact } from '@strk20/protocol/quote'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { BlockedButton } from '../components/BlockedButton'
import { CurrencyPanel } from '../components/CurrencyPanel'
import { LinkabilityMeter } from '../components/LinkabilityMeter'
import { SwapDirectionButton } from '../components/SwapDirectionButton'
import { SwapReview } from '../components/SwapReview'
import { SwapSettings } from '../components/SwapSettings'
import { TokenSelector } from '../components/TokenSelector'
import { Text } from '../components/ui/Text'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import { toast } from '../shell/toast-store'
import { useBalance } from '../shell/use-balance'
import { useCrowd } from '../shell/use-crowd'
import { useQuote } from '../shell/use-quote'
import { useSend } from '../shell/use-send'
import { useSession } from '../shell/session'
import { useTokenList } from '../shell/use-token-list'
import { Surface } from '../shell/Surface'
import { stageLabel } from '../shell/stage-labels'

export const Route = createFileRoute('/swap')({
  component: Swap,
})

//
// THE SWAP SURFACE.
//
// ── WHAT IS REAL ON THIS SCREEN, STATED PLAINLY ───────────────────────────────────────────
//
// All of it, now. The asset list is AVNU's routable set with every entry's `decimals()` confirmed
// against its own contract; the price is a live quote; the linkability meter sits on a bounded
// read of real pool events; and Confirm builds a private route and sends it through the pool.
//
// This comment used to end "NOT REAL YET: the quote and the execution", which was true when it
// was written and is the reason it is being rewritten rather than deleted — a header that
// describes an earlier version of its own file is worse than no header, because it is read as
// current.
//
// What a swap actually does, in one transaction: withdraw the sell token to AVNU's privacy
// executor, mint an open note for the buy token, and invoke the executor with the route and that
// note's id. The proceeds land back in the pool without ever touching a public address of the
// user's. `send.ts` builds that sandwich and refuses it if the two legs ever name different
// contracts.
//
// The one thing this screen cannot do is pay for you: the pool charges its fee per batch, and the
// account needs the sell amount plus that fee.
//

/**
 * Which side of the form a token selection is for.
 *
 * `null` means the picker is closed. One piece of state rather than two booleans, because "both
 * pickers open" is a state that must not be representable.
 */
type PickerSide = 'sell' | 'buy' | null

function Swap() {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const { tokens, loading: tokensLoading } = useTokenList()
  const crowd = useCrowd()

  const [sellToken, setSellToken] = useState<TokenInfo | null>(null)
  const [buyToken, setBuyToken] = useState<TokenInfo | null>(null)
  const [sellAmount, setSellAmount] = useState('')
  const [picker, setPicker] = useState<PickerSide>(null)
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
  const [reviewing, setReviewing] = useState(false)

  // The account, its notes, and the one path that signs. The walk is shared with `/wallet` in the
  // sense that both ask `discoverWallet` the same question; what matters here is that the notes a
  // swap spends come from the same reading the amounts were checked against.
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { balance, read, refresh } = useBalance(ready?.address ?? null, ready?.accountKey ?? null)

  const sending = useSend(read, ready)

  // The list is volume-ordered, so the first entry is the deepest market. Defaulting the sell side
  // to it means the form is usable on arrival instead of asking for two decisions before anything
  // can happen. The BUY side is deliberately left empty — picking what you want is the user's
  // decision, and pre-filling it would put a pair on screen nobody chose.
  const defaultedSell = sellToken ?? tokens[0] ?? null

  //
  // WHAT THE SELL SIDE ACTUALLY SPENDS: the SHIELDED holding of the sell token.
  //
  // A swap withdraws the sell token from the pool to the venue's executor and mints an open note
  // for the proceeds — so the amount available is a note balance, not the account's public one. An
  // earlier version of this line read the PUBLIC balance, which would have been a confident number
  // in the wrong denomination: an account holding public USDC and no USDC notes would have been
  // told it could swap, and the build would have refused it at the last step.
  //
  // `heldWei` is `null` for "not read / not held", which `CurrencyPanel` renders as no line at all
  // rather than a zero — `send.tsx` and `bridge.tsx` take the identical shape, deliberately.
  //
  const heldWei = useMemo(() => {
    if (!balance || !defaultedSell) return null
    const holding = balance.tokens.find(
      (t) => BigInt(t.token) === BigInt(defaultedSell.address),
    )
    return holding?.wei ?? null
  }, [balance, defaultedSell])

  //
  // THE AMOUNT SURVIVES THE FLIP, and the first version of this got it wrong.
  //
  // It cleared the field, reasoning that a figure typed as one asset should not be restated as
  // another. That reasoning is about the UNIT and the unit is not what a person is holding in their
  // head — the SIZE is. Someone typing 100 and flipping means "now quote me the other direction for
  // about that much", and clearing it makes them type it again to find out.
  //
  // Uniswap keeps it, and keeping it is also self-correcting: the quote re-runs against the new
  // pair immediately, so a size that means nothing on the new side is visible as a price within the
  // same second rather than hidden behind an empty field.
  //
  const flip = useCallback(() => {
    setSellToken(buyToken)
    setBuyToken(defaultedSell)
  }, [buyToken, defaultedSell])

  // The typed field, through the protocol's own parser — which owns the comma separator, the
  // second decimal point, and the two pastes that silently change a value's meaning.
  const parsed = useMemo(
    () => parseAmountInput(sellAmount, defaultedSell?.decimals ?? null),
    [sellAmount, defaultedSell],
  )

  const quote = useQuote({
    sellToken: defaultedSell?.address ?? null,
    buyToken: buyToken?.address ?? null,
    sellAmount: parsed.wei,
  })

  const quoted = quote.result?.state === 'quoted' ? quote.result.quote : null

  // What the output panel shows. Empty until there is a real quote — never an echo of the sell
  // figure, which would be a price of 1:1 that nobody computed.
  const buyDisplay =
    quoted && buyToken ? toPlainText(quoted.buyAmount, buyToken.decimals) : ''

  const impact = quoted ? priceImpact(quoted) : null

  //
  // ONE RATE, COMPUTED ONCE. It was inline in the JSX and read by two places, which is two chances
  // for the review to disagree with the form it came from.
  //
  // `(buyAmount x 10^sellDecimals) / sellAmount` in bigint: scale the numerator by the SELL token's
  // decimals first so the division still has the precision to survive, then render with the BUY
  // token's. Dividing first throws away every digit that matters on a small quote.
  //
  const rateLabel = useMemo(() => {
    if (!quoted || !buyToken || !defaultedSell || quoted.sellAmount <= 0n) return '—'
    const perOne =
      (quoted.buyAmount * 10n ** BigInt(defaultedSell.decimals)) / quoted.sellAmount
    return `1 ${defaultedSell.symbol} = ${toPlainText(perOne, buyToken.decimals)} ${buyToken.symbol}`
  }, [quoted, buyToken, defaultedSell])

  // The floor the swap must clear. Computed here so the review step and the eventual transaction
  // read the same number, and so a zero can never reach a call — `minimumOut` throws on one.
  const minOut = quoted ? minimumOut(quoted.buyAmount, slippageBps) : null

  const meter = useMemo(
    () =>
      meterFor({
        reading: crowd,
        amountWei: parsed.wei,
        decimals: defaultedSell?.decimals ?? null,
      }),
    [crowd, parsed.wei, defaultedSell],
  )

  const meterSeverity = maxSeverity(
    meter.state === 'measured' && meter.severity !== null ? [meter.severity] : [],
  )

  //
  // CONFIRM: build the private route, then send it.
  //
  // ── THE ROUTE IS BUILT HERE, NOT AT QUOTE TIME ──────────────────────────────────────────
  //
  // `/swap/v3/build` is what returns the EXECUTOR and the calls, and it is the venue committing
  // to a route rather than describing one. Building at quote time would mean holding a committed
  // route across every keystroke that followed, and executing whichever one happened to be in
  // hand — so it happens once, on the press, against the quote actually on screen.
  //
  // ── AND THE TAKER IS THE EXECUTOR, WHICH LOOKS WRONG AND IS NOT ─────────────────────────
  //
  // The route is executed BY the executor, holding funds the pool withdrew to it. So the address
  // AVNU must build for is the executor's, not this account's — a route built for the user would
  // pull tokens from an address that never receives them, and revert after the fee.
  //
  const [building, setBuilding] = useState(false)
  const [buildProblem, setBuildProblem] = useState<string | null>(null)

  const onConfirm = useCallback(async () => {
    if (!quoted || !buyToken || !defaultedSell || minOut === null) return
    setBuildProblem(null)
    setBuilding(true)
    try {
      const built = await buildSwap(quoted.quoteId, slippageBps)
      if (built.state !== 'built') {
        setBuildProblem(built.because)
        return
      }

      const outcome = await sending.send({
        kind: 'swap',
        // The executor, on BOTH legs. `planSend` refuses the send if these ever disagree — see
        // `SendRequest.recipient` — so naming it once and reusing it is the safe spelling.
        recipient: built.plan.executorAddress,
        token: defaultedSell.address,
        symbol: defaultedSell.symbol,
        amount: quoted.sellAmount,
        swap: {
          executor: built.plan.executorAddress,
          buyToken: buyToken.address,
          buySymbol: buyToken.symbol,
          calls: built.plan.calls,
          minOutWei: minOut,
        },
      })

      //
      // THE RESULT USED TO BE AWAITED AND THROWN AWAY — the whole of what a completed swap did.
      //
      // On success the review sheet stayed open over an unchanged form with the amount still typed
      // in it, no receipt, no toast and no re-read of the balance. On a real mainnet swap that is a
      // user who has just spent money, has been told nothing, and is looking at the button that
      // spent it. A failure was equally silent: `sending.problem` renders as the sheet's blocker,
      // which is why nothing is reported here for the `!ok` case — but the sheet must NOT close on
      // one, or the blocker closes with it and the refusal is never read.
      //
      if (!outcome.ok) return

      setReviewing(false)
      setSellAmount('')
      // Swap has no on-screen receipt of its own — unlike Send, whose `sent` block reports the
      // transfer — so this toast IS the confirmation. It names the pair, because "Swap submitted"
      // over a form the user has just watched empty itself says nothing they did not already know.
      toast({
        kind: 'success',
        title: `Swapping ${defaultedSell.symbol} for ${buyToken.symbol}`,
        detail: 'The batch is away — the pool credits the bought token when it accepts it.',
      })
      // Not awaited, for `BalanceState`'s documented reason: the previous reading stays on screen
      // while the new walk is in flight, so blocking on it would only delay the good news.
      refresh()
    } finally {
      setBuilding(false)
    }
  }, [quoted, buyToken, defaultedSell, minOut, slippageBps, sending, refresh])

  //
  // THE BLOCKER CHAIN (§7.10), ordered so the reason a person can act on comes first.
  //
  // The global stop leads: a paused pool outranks every local question, because entering a valid
  // amount does not become possible when the pool returns — it becomes RELEVANT again.
  //
  // "Swap is not built yet" is LAST even though it is the one nothing can clear. First would be
  // more literal and less useful: the form's own states would never reach the button they are
  // supposed to be reported on, and the user would learn nothing about what they typed.
  //
  //
  // REVIEW IS REACHABLE, EXECUTION IS NOT — and the two blockers are separate on purpose.
  //
  // Everything up to and including the review step is real: the price, the floor, the route, the
  // crowd. So the CTA opens the review as soon as there is a quote to review. The step that does
  // not exist yet is the SUBMISSION, and its reason belongs on the button inside the review, next
  // to the thing it would actually do — not three screens earlier, where it would hide every other
  // state behind itself.
  //
  const reviewBlocker =
    currentBlocker(health) ??
    (tokensLoading ? 'Loading assets' : null) ??
    (tokens.length === 0 ? 'Asset list unavailable' : null) ??
    (defaultedSell === null || buyToken === null ? 'Select an asset' : null) ??
    // The parser's own sentence, when a paste meant something other than what it looked like.
    parsed.problem ??
    (parsed.wei === null || parsed.wei === 0n ? 'Enter an amount' : null) ??
    (quote.loading && !quote.stale ? 'Finding the best price' : null) ??
    (quote.result?.state === 'unavailable' ? quote.result.because : null) ??
    (quote.result?.state === 'no-route' ? 'No route for this pair' : null) ??
    (quoted === null ? 'Enter an amount' : null)

  //
  // WHAT THE STATUS LINE SAYS. Ordered by how much the reader can act on it: a problem they can
  // fix, then the fact that we are asking, then the price itself. `rateLabel` is the live rate the
  // detail rows already show, so the line is never inventing a number of its own.
  //
  const quoteStatus =
    parsed.problem ??
    (parsed.wei === null || parsed.wei === 0n ? 'Enter an amount' : null) ??
    (quote.loading ? (quote.stale ? 'Refreshing quote…' : 'Getting live quote…') : null) ??
    (quote.result?.state === 'unavailable' ? quote.result.because : null) ??
    (quote.result?.state === 'no-route' ? 'No route for this pair' : null) ??
    rateLabel ??
    'Enter an amount'

  return (
    <Surface routeId={Route.fullPath}>
      {/* The 480px column Uniswap uses for every value form. `mx-auto` so it centres on a desktop
          and `w-full` so it fills a phone. */}
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s8">
        <Text variant="kicker">03 — exchange</Text>
        {/* Title left, settings right — the header row, and the place the slippage control is
            looked for. */}
        <div className="flex items-center justify-between gap-s12">
          <Text variant="display2" as="h1" className="text-neutral1">
            Swap
          </Text>
          <SwapSettings slippageBps={slippageBps} onSlippageChange={setSlippageBps} />
        </div>
        <Text variant="body4" className="text-neutral2">
          One transaction inside the pool — the proceeds land back as a shielded note. The amount is
          public; who swapped is not.
        </Text>

        {/* The two panels, welded: 2px apart with their facing corners squared, so they read as one
            control with a seam rather than two stacked cards. */}
        <div className="flex flex-col gap-s2">
          <CurrencyPanel
            label="Sell"
            corners="top"
            value={sellAmount}
            onValueChange={setSellAmount}
            token={defaultedSell}
            onSelectToken={() => setPicker('sell')}
            //
            // THE PUBLIC BALANCE, WHICH THIS SURFACE COULD NOT SEE UNTIL NOW.
            //
            // This read `balanceLabel={null}` with a comment explaining that no shielded balance had
            // been read here — true, and beside the point: what a swap spends from is the account's
            // PUBLIC holding of the sell token, and nothing in the app read that. So the one screen
            // whose entire job is "how much of this do I have" could not answer.
            //
            // The honesty rule survives the change intact. `undefined` (not read yet) and `null`
            // (read and failed) both render no line rather than a zero, because "Balance: 0" is a
            // number nobody measured, and the row reserves its height either way.
            //
            balanceLabel={
              heldWei === null || defaultedSell === null
                ? null
                : `Balance: ${toPlainText(heldWei, defaultedSell.decimals)} ${defaultedSell.symbol}`
            }
            //
            // 25 / 50 / 75 / Max — the prototype's chips, and `CurrencyPanel` has shipped the row
            // since it was written. Send and Bridge both passed `onPreset`; swap was the one
            // surface that never did, so the one screen whose whole job is "how much of this do I
            // have" made you work it out yourself.
            //
            onPreset={
              heldWei === null || heldWei === 0n || defaultedSell === null
                ? undefined
                : (fraction) =>
                    setSellAmount(
                      toPlainText(
                        // Integer arithmetic on the wei, never a float on the display value — a
                        // quarter of an 18-decimal balance through `Number` loses the last digits.
                        (heldWei * BigInt(Math.round(fraction * 100))) / 100n,
                        defaultedSell.decimals,
                      ),
                    )
            }
            // The over-balance state, which this panel could not express without a balance to
            // compare against. Same shape as Send's and Bridge's.
            invalid={heldWei !== null && parsed.wei !== null && parsed.wei > heldWei}
          />

          <SwapDirectionButton onPress={flip} disabled={buyToken === null} />

          <CurrencyPanel
            label="Buy"
            corners="bottom"
            // READ-ONLY: this is the quote's slot, and the venue decides what goes in it. Empty
            // until a real quote arrives — never an echo of the sell figure, which would be a
            // price of 1:1 that nobody computed.
            value={buyDisplay}
            readOnly
            token={buyToken}
            onSelectToken={() => setPicker('buy')}
            // Dimmed while a newer quote is in flight: the figure on screen is a REAL price for a
            // slightly older amount, which is worth showing and worth marking as not-yet-current.
            className={quote.stale ? 'opacity-60' : undefined}
          />
        </div>

        {quoted ? (
          <QuoteDetails
            rate={rateLabel}
            impact={impact}
            minOut={
              minOut !== null && buyToken
                ? `${toPlainText(minOut, buyToken.decimals)} ${buyToken.symbol}`
                : null
            }
            route={quoted.routes.map((r) => r.name).join(' · ') || null}
          />
        ) : null}

        {/*
          THE METER AS A ROW, not as the full panel.

          The full meter is a count, a sentence and a 320px picture — more vertical space than the
          form above it, and the page ended up drawing that same picture TWICE, once here and once
          over the waiting steps. On a form where nothing has been committed to, the honest content
          is one line: how big the crowd is.

          The picture earns its space where `C08:229` puts it — at the moment of action and during
          the wait — which is the review step below.
        */}
        {/*
          THE QUOTE STATUS LINE. One line, always present, that says where the price stands —
          "Enter an amount" before there is one, "Getting live quote…" while the venue is being
          asked, and the live rate once there is one. Uniswap's pattern, and the reason it is worth
          copying is that a form which goes blank between states makes the user wonder whether they
          broke it.

          It reserves its height in every state so the panel stack above it never shifts when the
          sentence changes.
        */}
        <div className="flex min-h-s20 items-baseline justify-between gap-s12 px-s4">
          <Text variant="body4" className="text-neutral2">
            {quoteStatus}
          </Text>
          {/* The crowd, still on the form, still one line — the picture lives in the review. */}
          <LinkabilityMeter meter={meter} variant="row" />
        </div>

        <BlockedButton
          blocker={reviewBlocker}
          action="Review swap"
          onPress={() => setReviewing(true)}
          severity={meterSeverity}
        />

      </div>

      {defaultedSell && buyToken && quoted ? (
        <SwapReview
          open={reviewing}
          onOpenChange={setReviewing}
          sellToken={defaultedSell}
          buyToken={buyToken}
          sellDisplay={toPlainText(quoted.sellAmount, defaultedSell.decimals)}
          buyDisplay={buyDisplay}
          rate={rateLabel}
          impactPercent={impact === null ? null : impact * 100}
          minimumReceived={
            minOut !== null ? `${toPlainText(minOut, buyToken.decimals)} ${buyToken.symbol}` : null
          }
          route={quoted.routes.map((r) => r.name).join(' · ') || null}
          meter={meter}
          disclosure={disclosureFor('swap')}
          onConfirm={onConfirm}
          //
          // THE BUTTON SAYS WHAT IS HAPPENING, or why it cannot.
          //
          // Ordered so the reason a person can act on comes first, the same rule the outer CTA's
          // blocker chain keeps. A stage label is not a blocker — it is the send running — but it
          // occupies the same slot because a button that still said "Confirm swap" while a proof
          // was being generated invites a second press, and a second press is a double-spend one
          // of the two pays a revert for.
          //
          blocker={
            !ready
              ? 'This browser has no account yet'
              : read === null
                ? 'Reading your balance…'
                : read.state !== 'walked'
                  ? 'Your balance could not be read'
                  : building
                    ? 'Getting the route…'
                    : sending.stage
                      ? stageLabel(sending.stage)
                      : (buildProblem ?? sending.problem)
          }
          dismissible={sending.stage === null}
        />
      ) : null}

      <TokenSelector
        open={picker !== null}
        onOpenChange={(open) => setPicker(open ? picker : null)}
        tokens={tokens}
        loading={tokensLoading}
        selectedAddress={picker === 'sell' ? defaultedSell?.address : buyToken?.address}
        onSelect={(token) => {
          if (picker === 'sell') {
            setSellToken(token)
            // Choosing the same asset on both sides is not a swap. Clearing the other side is
            // gentler than refusing the tap, and it leaves the user one decision from a valid pair.
            if (buyToken && BigInt(buyToken.address) === BigInt(token.address)) setBuyToken(null)
          } else {
            setBuyToken(token)
            if (defaultedSell && BigInt(defaultedSell.address) === BigInt(token.address)) {
              setSellToken(null)
            }
          }
        }}
      />
    </Surface>
  )
}

/**
 * The rows under the form: rate, impact, floor, route.
 *
 * ── THE FLOOR IS SHOWN, NOT BURIED ────────────────────────────────────────────────────────
 *
 * Uniswap's review modal shows "Max slippage" as a percentage. This shows the resulting AMOUNT,
 * because a percentage is a setting and an amount is a consequence — and the consequence is the
 * thing a person can actually check against what they expected. It is also the number the
 * transaction will assert on-chain, so what is on screen is what gets enforced.
 *
 * ── AND THE IMPACT IS COLOURED ONLY WHEN IT IS WORTH COLOURING ────────────────────────────
 *
 * Below 1% it is ordinary text. A route that costs a fraction of a percent is not a warning, and
 * colouring every one of them spends the warning colour on the normal case — which is how a real
 * warning stops being read.
 */
function QuoteDetails({
  rate,
  impact,
  minOut,
  route,
}: {
  rate: string
  impact: number | null
  minOut: string | null
  route: string | null
}) {
  const impactPercent = impact === null ? null : impact * 100
  const loud = impactPercent !== null && impactPercent >= 1

  return (
    <dl className="flex flex-col gap-s8 rounded-card border border-solid border-surface3 p-s12">
      <Row label="Rate" value={rate} />
      {impactPercent !== null ? (
        <Row
          label="Price impact"
          value={`${impactPercent >= 0 ? '' : '+'}${Math.abs(impactPercent).toFixed(2)}%`}
          tone={loud ? 'exposed' : 'plain'}
        />
      ) : null}
      {minOut ? <Row label="Minimum received" value={minOut} /> : null}
      {route ? <Row label="Route" value={route} /> : null}
    </dl>
  )
}

function Row({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: string
  tone?: 'plain' | 'exposed'
}) {
  return (
    <div className="flex items-baseline justify-between gap-s12">
      <Text as="dt" variant="body4" className="text-neutral2">
        {label}
      </Text>
      <Text
        as="dd"
        variant="body4"
        className={tone === 'exposed' ? 'numeric text-exposed' : 'numeric text-neutral1'}
      >
        {value}
      </Text>
    </div>
  )
}

/**
 * What each pipeline stage is called on screen.
 *
 * `relay` is reworded, as it is on the account ladder and for the same reason: this browser is not
 * relaying to anyone, it is signing and broadcasting. Showing a user the word for the architecture
 * they are NOT using is how copy ends up describing a different product.
 *
 * `mature` is the wait nobody expects — a note exists on chain before the pool will let it be
 * spent — so it says what is being waited for rather than naming the state.
 */
