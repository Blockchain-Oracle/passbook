//
// The bearer positions this browser holds on the launch surface — the private half of a public
// sale. Each is a secret whose commitment rode a buy (or a create); the secret IS the claim, and
// the section says so rather than implying an account somewhere remembers you.
//
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import { usePositions } from '../../shell/use-positions'
import { shortenFelt } from '../../shell/session'
import { Text } from '../ui/Text'

export function YourPositions({
  launchId,
  venue = 'launch',
}: {
  launchId?: number
  /** Which contract's claims to list — the launch surface's default, the Houses pass their own. */
  venue?: 'launch' | 'market' | 'governance'
}) {
  const positions = usePositions()
  const held = positions.filter(
    (p) => p.venue === venue && (launchId === undefined || p.id === launchId),
  )
  if (held.length === 0) return null

  return (
    <section className="flex flex-col gap-s6 rounded-large border border-solid border-surface3 p-s16">
      <Text variant="kicker">Your positions</Text>
      {held.map((p) => {
        // The row points at its own transaction when the submitting surface recorded one —
        // the ActivityTape's `tx ↗` discipline, applied to the reader's own claims.
        const href = p.txHash ? voyagerTxUrl(p.txHash) : null
        return (
          <div key={p.commitment} className="flex flex-col">
            <Text variant="body4" className="text-neutral1">
              {p.label ?? `Launch ${p.id}`}
            </Text>
            <span className="flex items-baseline gap-s8">
              <Text variant="mono" className="truncate text-neutral3">
                {shortenFelt(p.commitment, 10, 8)}
              </Text>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring shrink-0 font-mono text-body4 text-accent1"
                >
                  tx ↗
                </a>
              ) : null}
            </span>
          </div>
        )
      })}
      <Text variant="body4" className="text-neutral3">
        Each position is a bearer secret this browser keeps — it rides the recovery backup with
        your notes.
      </Text>
    </section>
  )
}
