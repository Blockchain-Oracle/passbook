// Where a screen points when it has more to say than fits on it.
//
// ABSOLUTE, AND THEY HAVE TO BE. The docs are a separate deployment (`apps/site`, Next.js +
// Fumadocs) and are never routes inside this app — a relative `/docs` here would 404 against the
// SPA router and look like a broken link rather than a missing site.
const SITE_URL = 'https://strk20.run'

/** One docs page, by its path under `/docs`. */
export const docsPage = (path: string): string => `${SITE_URL}/docs/${path}`

/** What a sponsored transaction is, why shielding cannot use one, and what runs out. */
export const SPONSORED_DOCS = docsPage('how-it-works/sponsored-transactions')
