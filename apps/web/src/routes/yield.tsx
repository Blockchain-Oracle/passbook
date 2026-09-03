import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/yield` is what people type. The surface is called Earn, matching Vesu's own word for it and the
 * sidebar entry — but nobody should meet a not-found page over a synonym, so this sends them on.
 */
export const Route = createFileRoute('/yield')({
  beforeLoad: () => {
    throw redirect({ to: '/earn' })
  },
})
