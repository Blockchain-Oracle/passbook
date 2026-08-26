import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/pay/$address')({
  component: Pay,
})

// No loader, for the reason written out in `activity.$id.tsx`. Here the constraint it used to
// gesture at is sharper: the build gate visits the literal `/pay/$address`, so `params.address` is
// the eight-character string `"$address"` and not an address at all. Parsing it as a felt wherever
// it is eventually consumed would fail every build.
function Pay() {
  const { address } = Route.useParams()
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Pay</h1>
      <p className="text-body3 text-neutral2">
        A payment addressed to someone by link. The pay surface is built in a later story; the route
        exists now so the shell can link to it.
      </p>
      <p className="text-body4 text-neutral2 numeric">Requested recipient: {address}</p>
    </Surface>
  )
}
