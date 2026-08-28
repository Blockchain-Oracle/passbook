//
// The bearer positions this browser holds on the launch surface — the private half of a public
// sale. Each is a secret whose commitment rode a buy (or a create); the secret IS the claim, and
// the section says so rather than implying an account somewhere remembers you.
//
import { usePositions } from '../../shell/use-positions'
import { shortenFelt } from '../../shell/session'
import { Text } from '../ui/Text'

export function YourPositions({ launchId }: { launchId?: number }) {
  const positions = usePositions()
  const held = positions.filter(
    (p) => p.venue === 'launch' && (launchId === undefined || p.id === launchId),
  )
  if (held.length === 0) return null

  return (
    <section className="flex flex-col gap-s6 rounded-large border border-solid border-surface3 p-s16">
      <Text variant="kicker">Your positions</Text>
      {held.map((p) => (
        <div key={p.commitment} className="flex flex-col">
          <Text variant="body4" className="text-neutral1">
            {p.label ?? `Launch ${p.id}`}
          </Text>
          <Text variant="mono" className="truncate text-neutral3">
            {shortenFelt(p.commitment, 10, 8)}
          </Text>
        </div>
      ))}
      <Text variant="body4" className="text-neutral3">
        Each position is a bearer secret this browser keeps — it rides the recovery backup with
        your notes.
      </Text>
    </section>
  )
}
