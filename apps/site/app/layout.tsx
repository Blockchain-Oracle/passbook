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
  title: { default: 'Passbook — a private account on Starknet', template: '%s — Passbook' },
  description:
    'Open Passbook and you have an account on Starknet’s STRK20 pool. No wallet, no login, no seed phrase — and a straight answer about what that does and does not hide.',
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
