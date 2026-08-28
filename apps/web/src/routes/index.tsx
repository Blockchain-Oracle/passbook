import { createFileRoute, redirect } from '@tanstack/react-router'

// `/` is the wallet. Search and hash survive the hop so `?ref` and `#note` links keep working.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/wallet', search: true, hash: true })
  },
})
