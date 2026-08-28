import { createFileRoute } from '@tanstack/react-router'

import { WalletHome } from '@/features/wallet/wallet-home'

export const Route = createFileRoute('/wallet')({
  component: WalletHome,
})
