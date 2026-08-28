import { Link, createFileRoute } from '@tanstack/react-router'

import { Text } from '../components/ui/Text'
import { PeerAvatar } from '../components/PeerAvatar'
import { shortenFelt } from '../shell/session'
import { useAvatars, useDirectory } from '../shell/use-directory'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/u/$name')({
  component: Profile,
})

//
// A PERSON'S PAGE, and the whole point is how little is on it.
//
// A profile here is exactly the directory entry its holder signed: a name, a picture if they
// chose one, and the address they proved.
// There is no activity feed, no balance, no graph — not because the page is unfinished but
// because those are exactly what the pool exists to keep off pages like this. The page says so.
//
function Profile() {
  const { name } = Route.useParams()
  const directory = useDirectory()
  const wanted = name.toLowerCase()
  const entry = directory.entries.find((e) => e.name === wanted)
  const avatars = useAvatars(entry ? [entry] : [])

  if (!entry) {
    return (
      <Surface routeId={Route.fullPath}>
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-s12">
          <Text variant="display3" as="h1" className="text-neutral1">
            @{wanted}
          </Text>
          <Text variant="body3" className="text-neutral2">
            {directory.loading
              ? 'Reading the directory…'
              : 'Nobody has claimed this name. A name exists here only after someone proves an address for it.'}
          </Text>
        </div>
      </Surface>
    )
  }

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-s16">
        <header className="flex items-center gap-s16 rounded-large border border-solid border-surface3 p-s16">
          <PeerAvatar address={entry.address} avatar={avatars[entry.address] ?? null} size={64} />
          <div className="flex min-w-0 flex-1 flex-col gap-s2">
            <div className="flex items-center gap-s8">
              <Text variant="display3" as="h1" className="truncate text-neutral1">
                @{entry.name}
              </Text>
            </div>
            <Text variant="mono" className="truncate text-neutral3">
              {shortenFelt(entry.address, 12, 10)}
            </Text>
          </div>
        </header>

        <div className="flex gap-s8">
          <Link
            to="/chat/$peer"
            params={{ peer: entry.address }}
            preload="intent"
            className="focus-ring flex-1 rounded-control border border-solid border-surface3 bg-raised py-s10 text-center text-buttonLabel3 text-neutral1 no-underline hover:bg-inset"
          >
            Message
          </Link>
          <Link
            to="/pay/$address"
            params={{ address: entry.address }}
            preload="intent"
            className="focus-ring flex-1 rounded-control border border-solid border-accent1 bg-accent2 py-s10 text-center text-buttonLabel3 text-accent1 no-underline"
          >
            Pay @{entry.name}
          </Link>
        </div>

        <section className="rounded-large border border-solid border-surface3 p-s16">
          <Text variant="kicker">What this page is</Text>
          <Text variant="body3" className="mt-s4 max-w-[60ch] text-neutral2">
            Exactly what @{entry.name} signed into the public directory: the name, the picture,
            the address — nothing more. Their
            balances, their sends and their positions are not here, because keeping those off a
            page like this is what the whole product is for.
          </Text>
        </section>
      </div>
    </Surface>
  )
}
