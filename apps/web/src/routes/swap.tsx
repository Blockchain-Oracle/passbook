import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { meterFor } from '@strk20/protocol/linkability'
import { maxSeverity } from '@strk20/protocol/privacy'
import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { DEFAULT_SLIPPAGE_BPS, minimumOut, priceImpact } from '@strk20/protocol/quote'
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
import { useCrowd } from '../shell/use-crowd'
import { useQuote } from '../shell/use-quote'
import { useTokenList } from '../shell/use-token-list'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/swap')({
  component: Swap,
})

//
// THE SWAP SURFACE.
//
// ── WHAT IS REAL ON THIS SCREEN AND WHAT IS NOT, STATED PLAINLY ───────────────────────────
//
// REAL: the asset list (fetched from AVNU's routable set, every entry's `decimals()` confirmed
// against its own contract), the token marks, the crowd reading behind the linkability meter (a
// live bounded read over on-chain events), and every state the CTA can be in.
//
// NOT REAL YET: the quote and the execution. There is no price on this screen, and the CTA says so
// rather than showing a number nobody computed. When the quote pipeline lands, it fills the output
// panel and the blocker chain loses its last link — nothing else here moves.
//
// That split is the same discipline the progress machine below keeps: `preview` steps are an
// HONEST render of a pipeline that has not started, not a fixture made to look busy.
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

  // The list is volume-ordered, so the first entry is the deepest market. Defaulting the sell side
  // to it means the form is usable on arrival instead of asking for two decisions before anything
  // can happen. The BUY side is deliberately left empty — picking what you want is the user's
  // decision, and pre-filling it would put a pair on screen nobody chose.
  const defaultedSell = sellToken ?? tokens[0] ?? null

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

  return (
    <Surface routeId={Route.fullPath}>
      {/* The 480px column Uniswap uses for every value form. `mx-auto` so it centres on a desktop
          and `w-full` so it fills a phone. */}
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s8">
        {/* Title left, settings right — Uniswap's header row, and the place a gear is looked for. */}
        <div className="flex items-center justify-between gap-s12">
          <Text variant="heading3" as="h1">
            Swap
          </Text>
          <SwapSettings slippageBps={slippageBps} onSlippageChange={setSlippageBps} />
        </div>

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
            // No balance line: no shielded balance has been read on this surface, and a "Balance: 0"
            // would be a number nobody measured. The row still reserves its height.
            balanceLabel={null}
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
        <LinkabilityMeter meter={meter} variant="row" />

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
          // No `onConfirm`: the submission path is the next piece of work. The review is otherwise
          // entirely real, and its button says which part is not.
          blocker="Submitting is not wired up yet"
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
