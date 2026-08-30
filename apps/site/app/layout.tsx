//
// The document both halves of the site are rendered into.
//
// `className="dark"` on `<html>` is not a preference that can be changed — Fumadocs reads it, the
// STUDIO palette in `global.css` is defined under it, and `themeSwitch` is disabled in
// `lib/layout.shared.tsx`. One committed look, exactly like the app.
//
import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Metadata } from 'next'

import './global.css'

export const metadata: Metadata = {
  title: { default: 'strk20.run — everything on Starknet, from one private account', template: '%s — strk20.run' },
  // Mechanism claims live HERE rather than in the H1 — the pattern Aztec and Miden both use, and
  // the reason our headline can be short without being vague.
  description:
    'Send, swap, bridge, bet, launch a token and run a House from one private account on Starknet’s STRK20 pool. No wallet, no seed phrase. Your first three transactions are on us, on mainnet.',
  themeColor: '#0A0A0A',
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ enabled: false, defaultTheme: 'dark' }}>{children}</RootProvider>
      </body>
    </html>
  )
}
