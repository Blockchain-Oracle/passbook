//
// One launch, as the card the grid renders — and now the door to its own page.
//
// THE MARK IS `TokenLogo`, AT LAST. The chain has carried `logo_uri` since the contract shipped
// and this surface rendered a text chip anyway; the card now reads the real logo (M3's pin
// pipeline fills it at create) and falls back to the seeded disc that is the app's designed
// answer for a token with no picture. The card's GLOW is the same seed — `accentFor` — so a
// token's identity colours its whole card, not just its 40 pixels.
//
// THE TITLE IS THE LINK (`ActivityRow`'s rule): the row itself is not an anchor, so the Buy
// button nests legally. Hovering anywhere on the card preloads the detail route — yosuku's
// prefetch-on-hover, TanStack's `preload` doing the work.
//
import { Link } from '@tanstack/react-router'

import {
  UNITS_PER_EPOCH,
  currentEpoch,
  raiseTarget,
  soldPct,
  timeLeft,
  unitPriceAt,
  type OnChainLaunch,
} from '@strk20/protocol/app-reads'
import { toPlainText } from '@strk20/protocol/amount'
import { logoDisplayUrl } from '@strk20/protocol/token-media'

import { shortenFelt } from '../../shell/session'
import { findToken, useTokenList } from '../../shell/use-token-list'
import { Button } from '../ui/Button'
import { Text } from '../ui/Text'
import { TokenLogo, accentFor } from '../TokenLogo'
import { Staircase } from './Staircase'
import { PHASE_SENTENCE, phaseOf } from './phase'

export function LaunchCard({
  launch,
  now,
  onBuy,
}: {
  launch: OnChainLaunch
  now: number
  onBuy: () => void
}) {
  const { tokens } = useTokenList()
  const stake = findToken(tokens, launch.stakeToken)
  const symbol = stake?.symbol ?? shortenFelt(launch.stakeToken, 4, 3)
  const decimals = stake?.decimals ?? 18
  const phase = phaseOf(launch, now)
  const epoch = currentEpoch(launch)
  const price = unitPriceAt(launch, epoch)
  const target = raiseTarget(launch)
  const pct = soldPct(launch)
  const accent = accentFor(launch.name || launch.symbol)

  return (
    <section
      className="group relative flex flex-col gap-s12 overflow-hidden rounded-large border border-solid border-surface3 bg-raised p-s16"
      // The identity glow: the token's own accent, whisper-quiet, from the mark's corner. An
      // inline style because identity colours are the declared off-token exception (TokenLogo.tsx).
      style={{ backgroundImage: `radial-gradient(130% 90% at 0% 0%, ${accent}1F, transparent 55%)` }}
    >
      <div className="flex items-center gap-s12">
        <TokenLogo
          url={logoDisplayUrl(launch.logoUri)}
          symbol={launch.symbol}
          name={launch.name}
          size={40}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <Link
            to="/launch/$id"
            params={{ id: String(launch.id) }}
            preload="intent"
            className="focus-ring truncate no-underline"
          >
            <Text variant="body2" className="truncate font-medium text-neutral1 group-hover:underline">
              {launch.name || `Launch ${launch.id}`}
            </Text>
          </Link>
          <Text variant="mono" className="text-neutral3">
            Epoch {epoch + 1} of {launch.epochs}
          </Text>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <Text variant="mono" className="text-neutral1">
            {toPlainText(price, decimals)} {symbol}
          </Text>
          <Text variant="body4" className="text-neutral3">
            per unit, this epoch
          </Text>
        </span>
      </div>

      <Staircase epochs={launch.epochs} at={epoch} />

      <div className="flex flex-col gap-s6">
        <div className="flex justify-between font-mono text-mono text-neutral3">
          <span>
            {launch.sold} of {launch.epochs * UNITS_PER_EPOCH} units · {pct}%
          </span>
          <span>
            {toPlainText(target, decimals)} {symbol} target
          </span>
        </div>
        <div className="h-s6 overflow-hidden rounded-pill bg-inset">
          <span
            aria-hidden="true"
            className="block h-full rounded-pill bg-accent1"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {phase === 'selling' ? (
        <>
          <Text variant="body4" className="text-neutral2">
            Graduates at {toPlainText(target, decimals)} {symbol} — or every buyer reclaims in full.
            There is no half-launched limbo. Closes in {timeLeft(launch.deadline, now)}.
          </Text>
          <Button variant="primary" size="md" fill onClick={onBuy}>
            Buy this epoch
          </Button>
        </>
      ) : (
        <Text
          variant="body4"
          className={phase === 'graduated' ? 'text-settled' : 'text-neutral2'}
        >
          {PHASE_SENTENCE[phase]}
        </Text>
      )}
    </section>
  )
}
