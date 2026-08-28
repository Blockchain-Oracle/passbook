//
// The token table — every token this launchpad has born or is bearing, one row each.
//
// Uniswap's explore-table grammar (`TokensTable.tsx`: rank · identity · numbers · shape) at this
// product's scale, with one honest difference: every column here is computable from our own chain
// reads, so there is no "volume (—)" theatre. A row is a launch; a graduated row leads to the
// token page, a live one to its curve.
//
// WIDE CONTENT SCROLLS IN ITS OWN CONTAINER — the table wrapper owns `overflow-x`, the page
// never grows a horizontal scrollbar.
//
import { Link } from '@tanstack/react-router'

import {
  UNITS_PER_EPOCH,
  currentEpoch,
  soldPct,
  timeLeft,
  unitPriceAt,
  type OnChainLaunch,
} from '@strk20/protocol/app-reads'
import { toPlainText } from '@strk20/protocol/amount'
import { logoDisplayUrl } from '@strk20/protocol/token-media'

import { shortenFelt } from '../../shell/session'
import { findToken, useTokenList } from '../../shell/use-token-list'
import { Text } from '../ui/Text'
import { TokenLogo } from '../TokenLogo'
import { PHASE_CHIP, phaseOf, type Phase } from './phase'

const CHIP_TONE: Record<Phase, string> = {
  selling: 'text-accent1 border-accent1',
  'sold-out': 'text-exposed border-exposed',
  graduated: 'text-settled border-settled',
  failed: 'text-irreversible border-irreversible',
  missed: 'text-irreversible border-irreversible',
}

export function TokenTable({
  launches,
  now,
  emptyLine,
}: {
  launches: readonly OnChainLaunch[]
  now: number
  emptyLine: string
}) {
  const { tokens } = useTokenList()

  if (launches.length === 0) {
    return (
      <Text variant="body3" className="text-neutral3">
        {emptyLine}
      </Text>
    )
  }

  return (
    <div className="overflow-x-auto rounded-large border border-solid border-surface3">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-solid border-surface3">
            {['#', 'Token', 'Phase', 'Price / unit', 'Raised', 'Progress', 'Closes'].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-s12 py-s8 text-left font-mono text-mono font-normal uppercase tracking-[0.08em] text-neutral3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {launches.map((launch) => {
            const stake = findToken(tokens, launch.stakeToken)
            const symbol = stake?.symbol ?? shortenFelt(launch.stakeToken, 4, 3)
            const decimals = stake?.decimals ?? 18
            const phase = phaseOf(launch, now)
            const pct = soldPct(launch)
            const price = unitPriceAt(launch, currentEpoch(launch))
            return (
              <tr
                key={launch.id}
                className="border-b border-solid border-surface3 transition-colors last:border-b-0 hover:bg-inset"
              >
                <td className="px-s12 py-s8 font-mono text-mono text-neutral3">{launch.id + 1}</td>
                <td className="px-s12 py-s8">
                  <Link
                    to={phase === 'graduated' && launch.token !== '0x0' ? '/token/$address' : '/launch/$id'}
                    params={
                      phase === 'graduated' && launch.token !== '0x0'
                        ? { address: launch.token }
                        : { id: String(launch.id) }
                    }
                    preload="intent"
                    className="focus-ring flex items-center gap-s8 no-underline"
                  >
                    <TokenLogo
                      url={logoDisplayUrl(launch.logoUri)}
                      symbol={launch.symbol}
                      name={launch.name}
                      size={28}
                    />
                    <span className="flex min-w-0 flex-col">
                      <Text variant="body3" className="truncate font-medium text-neutral1">
                        {launch.name || `Launch ${launch.id}`}
                      </Text>
                      <Text variant="mono" className="text-neutral3">
                        {launch.symbol}
                      </Text>
                    </span>
                  </Link>
                </td>
                <td className="px-s12 py-s8">
                  <span
                    className={`inline-flex rounded-pill border border-solid px-s8 py-s2 font-mono text-mono ${CHIP_TONE[phase]}`}
                  >
                    {PHASE_CHIP[phase]}
                  </span>
                </td>
                <td className="numeric px-s12 py-s8 font-mono text-body4 text-neutral1">
                  {toPlainText(price, decimals)} {symbol}
                </td>
                <td className="numeric px-s12 py-s8 font-mono text-body4 text-neutral1">
                  {toPlainText(launch.raised, decimals)} {symbol}
                </td>
                <td className="px-s12 py-s8">
                  <span className="flex items-center gap-s8">
                    <span className="h-s6 w-[72px] overflow-hidden rounded-pill bg-inset">
                      <span
                        aria-hidden="true"
                        className="block h-full rounded-pill bg-accent1"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <Text variant="mono" className="text-neutral3">
                      {launch.sold}/{launch.epochs * UNITS_PER_EPOCH}
                    </Text>
                  </span>
                </td>
                <td className="px-s12 py-s8 font-mono text-mono text-neutral3">
                  {phase === 'selling' ? timeLeft(launch.deadline, now) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
