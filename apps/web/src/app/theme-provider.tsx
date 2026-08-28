import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ReactNode } from 'react'

// Passbook opens dark. The pin lives in localStorage under `passbook-theme`; next-themes writes
// `data-theme` on <html> and injects its own pre-paint script, so there is no flash to hand-roll.
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      storageKey="passbook-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
