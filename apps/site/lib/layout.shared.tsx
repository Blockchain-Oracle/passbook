//
// What the docs chrome shows in its top bar: the brand, and the way back out.
//
// The docs layout is Fumadocs' own — sidebar, table of contents, search — and it is deliberately
// NOT the landing page's chrome. Two different jobs: the landing header sells, this one navigates.
// What they share is the mark and the palette, so a reader crossing between them stays on one site.
//
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

import { APP_URL, REPO_URL } from './shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span aria-hidden="true" className="brand-mark" />
          <span className="display text-heading3">Passbook</span>
        </>
      ),
      // Back to the landing page rather than to `/docs`. A brand in a docs sidebar that links to
      // the docs root is a link to where you already are.
      url: '/',
    },
    githubUrl: REPO_URL,
    links: [{ text: 'Open the app', url: APP_URL, external: true }],
    // ONE THEME, so no switch. The site is dark because the app opens dark; a toggle here would
    // be a control that changes nothing a reader came to find out.
    themeSwitch: { enabled: false },
  }
}
