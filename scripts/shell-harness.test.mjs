//
// The shell's own suite: the real `apps/web` entry, bundled and run in a real browser.
//
// Everything here is a fact about a PAINTED page — which surface mounted, how many markers it
// carries, what colour the body actually is after a reload, whether a box the size of the viewport
// is sitting in front of the product. None of it is checkable any other way: `vitest` does not
// collect `apps/web`, and jsdom has no layout engine, no cascade worth the name, and returns the
// empty string for a custom property that is demonstrably defined.
//
// EVERY NEGATIVE CONTROL PLANTS THROUGH `plant()`, which refuses to continue until the planted
// failure is observable. The obvious shape — mutate, then assert — ran before React committed and
// reported GREEN having planted nothing, which is a control that proves the opposite of what it was
// written for. That happened once in this epic already.
//
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from 'playwright-core'

import { assertBrowserAvailable, BROWSER_INSTALL_COMMAND } from './build-web.mjs'
import { expectedGrounds, toRgb } from './assert-design-shipped.mjs'
import { appBaseClasses } from './lint-tokens.mjs'
import {
  buildShell,
  openShell,
  plant,
  scrimProbe,
  shellDocument,
  themeReaderScript,
  WEB_ROOT,
} from './shell-harness.mjs'

/** The six modes and their routes, mirroring `apps/web/src/shell/modes.ts` in nav order. */
const MODES = [
  ['wallet', '/wallet', 'Wallet'],
  ['chat', '/chat', 'Chat'],
  ['swap', '/swap', 'Swap'],
  ['bridge', '/bridge', 'Bridge'],
  ['markets', '/markets', 'Markets'],
  ['launch', '/launch', 'Launch'],
]

/** The design authority's two ground colours, as the browser reports them. */
const GROUND = expectedGrounds(join(WEB_ROOT, 'design/tokens.yaml'))
const PAINTED = { light: toRgb(GROUND.light), dark: toRgb(GROUND.dark) }

let browser
let bundle

beforeAll(async () => {
  try {
    assertBrowserAvailable('shell-harness')
    browser = await chromium.launch({ channel: 'chromium-headless-shell' })
  } catch (e) {
    throw new Error(`${e.message}\n\n  (install with: ${BROWSER_INSTALL_COMMAND})`)
  }
  bundle = await buildShell()
}, 180_000)

afterAll(async () => {
  await browser?.close()
})

const open = (options) => openShell(browser, { bundle, ...options })

/** Every `[data-route-id]` on the page, and the shell around it. */
const readShell = () => ({
  markers: Array.from(document.querySelectorAll('[data-route-id]'), (el) =>
    el.getAttribute('data-route-id'),
  ),
  surfaceText: (document.querySelector('[data-route-id]')?.textContent ?? '').trim(),
  headers: document.querySelectorAll('header.app-header').length,
  mains: document.querySelectorAll('main').length,
  navLinks: Array.from(document.querySelectorAll('nav[aria-label="Modes"] a'), (a) => ({
    text: (a.textContent ?? '').trim(),
    href: a.getAttribute('href'),
    ariaDisabled: a.getAttribute('aria-disabled'),
    hasDisabled: a.hasAttribute('disabled'),
    ariaCurrent: a.getAttribute('aria-current'),
  })),
  pathname: location.pathname,
  historyLength: history.length,
})

// ---- the cold open --------------------------------------------------------------------------------

describe('the cold open lands on the product', () => {
  it('paints `/wallet` at `/`, with `/` absent from history', async () => {
    const shell = await open({ path: '/' })
    try {
      const seen = await shell.page.evaluate(readShell)

      // The redirect is in-app, thrown from `beforeLoad` — there is no host rule in front of this.
      expect(seen.markers).toEqual(['/wallet'])
      expect(seen.pathname).toBe('/wallet')

      // Exactly one landmark and exactly one identity. The root renders chrome around the outlet
      // and no `<main>` of its own, so a second of either would mean a layout had started claiming
      // to be a route.
      expect(seen.mains).toBe(1)
      expect(seen.headers).toBe(1)

      // `replace`, observed rather than asserted from a flag: `followRedirect()` hardcodes it, so
      // passing or omitting the option is byte-identical and only the history says which happened.
      expect(seen.historyLength).toBe(2)
      await shell.page.goBack({ waitUntil: 'load' }).catch(() => {})
      expect(shell.page.url()).toBe('about:blank')
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('shows six enabled, unbadged nav items from first paint', async () => {
    const shell = await open({ path: '/' })
    try {
      const seen = await shell.page.evaluate(readShell)

      expect(seen.navLinks.map((l) => l.text)).toEqual(MODES.map(([, , label]) => label))
      expect(seen.navLinks.map((l) => l.href)).toEqual(MODES.map(([, path]) => path))

      for (const link of seen.navLinks) {
        expect(link.hasDisabled, `${link.text} is disabled`).toBe(false)
        expect(link.ariaDisabled, `${link.text} is aria-disabled`).toBeNull()
        // A badge would be an element inside the link beyond its own label. The label IS the
        // content: nothing counts, nothing is new, nothing needs attention on a cold open.
        expect(link.text).toBe(link.text.trim())
      }

      // The mode the cold open landed on is the one marked current, and it is the only one.
      expect(seen.navLinks.filter((l) => l.ariaCurrent === 'page').map((l) => l.text)).toEqual([
        'Wallet',
      ])

      // ON THE WHOLE PAGE, not just inside the nav. The brand also points at `/wallet`, so on the
      // cold open the router marks it active too unless it is told not to — and two elements
      // announcing as the current page is a worse answer for a screen reader than none.
      expect(
        await shell.page.evaluate(() =>
          Array.from(document.querySelectorAll('[aria-current="page"]'), (el) =>
            (el.textContent ?? '').trim(),
          ),
        ),
      ).toEqual(['Wallet'])

      // Settings is reachable and is NOT a seventh mode: it lives outside the modes nav.
      const settings = await shell.page.evaluate(() => ({
        inModesNav: Boolean(document.querySelector('nav[aria-label="Modes"] a[href="/settings"]')),
        inHeader: Boolean(document.querySelector('header.app-header a[href="/settings"]')),
      }))
      expect(settings).toEqual({ inModesNav: false, inHeader: true })
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('THE RED — the enabled assertion notices a nav item that has been disabled', async () => {
    const shell = await open({ path: '/' })
    try {
      await plant(shell.page, {
        mutate: () =>
          document
            .querySelector('nav[aria-label="Modes"] a[href="/markets"]')
            ?.setAttribute('aria-disabled', 'true'),
        until: () =>
          document
            .querySelector('nav[aria-label="Modes"] a[href="/markets"]')
            ?.getAttribute('aria-disabled') === 'true',
      })

      const seen = await shell.page.evaluate(readShell)
      const disabled = seen.navLinks.filter((l) => l.ariaDisabled !== null || l.hasDisabled)
      expect(disabled.map((l) => l.text)).toEqual(['Markets'])
    } finally {
      await shell.close()
    }
  }, 90_000)

  it.each([320, 1280])('is legible at %ipx: no clipping, no sideways scroll', async (width) => {
    //
    // 320 is the narrowest viewport this app targets and 1280 is where nothing should wrap at all.
    // The bottom tab bar, the safe-area inset and the compact/expanded scroll behaviour are a later
    // story — all this one owes is six readable modes and a page that does not scroll sideways.
    //
    // WHAT THIS DELIBERATELY DOES NOT ASSERT: that the header wrapped. Wrapping is a CONSEQUENCE of
    // six labels not fitting, not a goal — shortening a label or tightening the padding until all
    // six fit on one line is an improvement, and a test demanding more than one row would call it a
    // regression. The failure worth catching is the other one, and it is caught: with `flex-nowrap`
    // planted, the document measures 678px wide inside a 320px viewport.
    //
    const shell = await open({ path: '/', viewport: { width, height: 700 } })
    try {
      const seen = await shell.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('nav[aria-label="Modes"] a'))
        return {
          documentScrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          headerHeight: document.querySelector('header.app-header').getBoundingClientRect().height,
          scrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
          links: links.map((a) => ({
            text: (a.textContent ?? '').trim(),
            width: a.getBoundingClientRect().width,
            height: a.getBoundingClientRect().height,
            right: a.getBoundingClientRect().right,
            // A label wider than its own box is one the browser has clipped or ellipsised.
            clipped: a.scrollWidth > a.clientWidth,
          })),
        }
      })

      expect(seen.documentScrollWidth).toBeLessThanOrEqual(seen.innerWidth)
      expect(seen.links).toHaveLength(6)
      for (const link of seen.links) {
        expect(link.width, `${link.text} has no width at ${width}px`).toBeGreaterThan(0)
        expect(link.height, `${link.text} has no height at ${width}px`).toBeGreaterThan(0)
        expect(link.clipped, `${link.text} is clipped at ${width}px`).toBe(false)
        expect(link.right, `${link.text} runs past the viewport at ${width}px`).toBeLessThanOrEqual(
          seen.innerWidth,
        )
      }

      //
      // The sticky header's clearance, checked where it is hardest: `scroll-padding-top` is one
      // static value and the header's height is not. Keyboard focus and anchor jumps land under the
      // header the moment this stops holding, and nothing else in the repo would notice.
      //
      expect(
        Number.parseFloat(seen.scrollPaddingTop),
        `scroll-padding-top ${seen.scrollPaddingTop} is under the ${seen.headerHeight}px header at ${width}px`,
      ).toBeGreaterThanOrEqual(seen.headerHeight)
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('has nothing standing in front of the product', async () => {
    const shell = await open({ path: '/' })
    try {
      expect(await shell.page.evaluate(scrimProbe)).toEqual([])
    } finally {
      await shell.close()
    }
  }, 90_000)

  it.each([
    ['a fixed full-viewport div', 'position:fixed;inset:0;background:rgba(0,0,0,0.6)'],
    // Sticky is out of flow and paints over what follows it exactly as fixed does. A probe that
    // only knew `fixed` and `absolute` would call this page clean.
    ['a sticky full-viewport div', 'position:sticky;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.6)'],
  ])('THE RED — the scrim probe sees %s, whatever it is called', async (_label, css) => {
    const shell = await open({ path: '/' })
    try {
      await plant(shell.page, {
        mutate: () => {
          const scrim = document.createElement('div')
          scrim.id = 'planted-scrim'
          document.body.append(scrim)
        },
        until: () => Boolean(document.getElementById('planted-scrim')),
      })
      await shell.page.evaluate((style) => {
        document.getElementById('planted-scrim').style.cssText = style
      }, css)

      const found = await shell.page.evaluate(scrimProbe)
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('planted-scrim')
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('THE RED — a modal dialog is found even though its backdrop is not an element', async () => {
    // Geometry alone cannot see this: the ::backdrop that covers the product is not in the DOM, and
    // the dialog itself is a small centred box. A fully scrimmed, click-blocked app measures clean.
    const shell = await open({ path: '/' })
    try {
      await plant(shell.page, {
        mutate: () => {
          const dialog = document.createElement('dialog')
          dialog.id = 'planted-dialog'
          dialog.textContent = 'planted'
          document.body.append(dialog)
          dialog.showModal()
        },
        until: () => document.getElementById('planted-dialog')?.matches(':modal') === true,
      })

      const found = await shell.page.evaluate(scrimProbe)
      expect(found.some((f) => f.includes('planted-dialog'))).toBe(true)
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('does not flag a full-viewport box that paints nothing', async () => {
    // The other direction, and the one that gets a check like this deleted: a fully transparent
    // overlay is invisible and blocks nothing a user can see. A false red here is worse than no
    // check, because someone in a hurry removes the check rather than the element.
    const shell = await open({ path: '/' })
    try {
      await plant(shell.page, {
        mutate: () => {
          const ghost = document.createElement('div')
          ghost.id = 'planted-ghost'
          document.body.append(ghost)
        },
        until: () => Boolean(document.getElementById('planted-ghost')),
      })
      await shell.page.evaluate(() => {
        document.getElementById('planted-ghost').style.cssText =
          'position:fixed;inset:0;opacity:0;background:rgba(0,0,0,0.6)'
      })

      expect(await shell.page.evaluate(scrimProbe)).toEqual([])
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('carries the query and the fragment through the cold-open redirect', async () => {
    // `/` is the address every link, bookmark and campaign points at, so it is the one visit where
    // dropping the query costs something. The redirect is in-app, so nothing else preserves it.
    const shell = await open({ path: '/?ref=judge&tab=notes#anchor' })
    try {
      expect(
        await shell.page.evaluate(() => ({
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
          marker: document.querySelector('[data-route-id]').getAttribute('data-route-id'),
        })),
      ).toEqual({
        pathname: '/wallet',
        search: '?ref=judge&tab=notes',
        hash: '#anchor',
        marker: '/wallet',
      })
    } finally {
      await shell.close()
    }
  }, 90_000)
})

// ---- every surface --------------------------------------------------------------------------------

describe('six coequal surfaces behind one chrome', () => {
  it('reaches each mode from its own nav link, and each one names itself', async () => {
    const shell = await open({ path: '/' })
    try {
      for (const [, path, label] of MODES) {
        await shell.page.click(`nav[aria-label="Modes"] a[href="${path}"]`)
        await shell.page.waitForFunction(
          (expected) => document.querySelector('[data-route-id]')?.getAttribute('data-route-id') === expected,
          path,
          { timeout: 10_000 },
        )

        const seen = await shell.page.evaluate(readShell)
        expect(seen.markers, `${label} rendered the wrong markers`).toEqual([path])
        expect(seen.headers, `${label} lost the shell`).toBe(1)
        expect(seen.navLinks).toHaveLength(6)
        expect(seen.navLinks.filter((l) => l.ariaCurrent === 'page').map((l) => l.text)).toEqual([label])

        // A surface with a correct marker and no content is a broken route wearing a true name.
        //
        // TWELVE IS THIS SUITE'S FLOOR, not the build gate's — the gate rejects only text that is
        // FALSY (`if (!text)`), so a one-character surface passes `build:web` with nothing to say.
        // The number matches the CI crawler's rule so the two agree; do not go looking for it in
        // `assertEvaluatedClean`, because it is not there.
        expect(seen.surfaceText.length, `${label} rendered ${seen.surfaceText.length} chars`)
          .toBeGreaterThanOrEqual(12)
      }
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('answers an address that names nothing with the reserved marker, and keeps the shell', async () => {
    const shell = await open({ path: '/nfts' })
    try {
      const seen = await shell.page.evaluate(readShell)

      expect(seen.markers).toEqual(['__not_found__'])
      expect(seen.headers).toBe(1)
      expect(seen.navLinks).toHaveLength(6)

      // Honest about what happened, and not a stack trace: the reader is someone who mistyped a
      // URL, not the person who wrote the router.
      expect(seen.surfaceText.length).toBeGreaterThanOrEqual(12)
      expect(seen.surfaceText).not.toMatch(/\bat\s+\w+\s*\(|\.tsx?:\d+|Error:/)
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('carries the network the artifact resolved to, which is what `smoke:sdk` reads', async () => {
    const shell = await open({ path: '/' })
    try {
      const published = await shell.page.evaluate(() => window.__PASSBOOK__)
      const shown = await shell.page.textContent('[data-testid="network"]')
      expect(published.network).toBe('mainnet')
      expect(shown).toContain(published.network)
      expect(shown).toContain(published.chainId)
    } finally {
      await shell.close()
    }
  }, 90_000)
})

// ---- one surface throws ---------------------------------------------------------------------------

const THROW_MESSAGE = 'planted: /markets throws on every render'
const ROOT_THROW_MESSAGE = 'planted: the root shell throws on every render'

/**
 * The same route tree and the same root, mounted by a router with NO `defaultErrorComponent`.
 *
 * This is the control the story's Design Notes name by name, and it is the whole argument for the
 * option: without it `Match.js` resolves the catch boundary to `SafeFragment`, which is not a
 * boundary, so a leaf's throw travels up to the ROOT's boundary and takes the header and all six
 * nav links with it. Written out rather than derived from `main.tsx` because the difference between
 * the two IS the thing under test — there is no way to have the option and not have it in one file.
 *
 * `createElement` rather than JSX: the entry is a virtual module with no extension, so the React
 * plugin never transforms it. `smoke/entry.ts` mounts the same way, for the same reason.
 */
const NO_DEFAULT_ERROR_COMPONENT_ENTRY = `
import ${JSON.stringify(join(WEB_ROOT, 'src/index.css'))}
import { StrictMode, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from ${JSON.stringify(join(WEB_ROOT, 'src/routeTree.gen.ts'))}

const router = createRouter({ routeTree })
createRoot(document.getElementById('root')).render(
  createElement(StrictMode, null, createElement(RouterProvider, { router })),
)
`

/**
 * Navigates to the poisoned surface and REFUSES TO CONTINUE until the failure is on the page.
 *
 * The click is the mutation; `until` is what makes this a plant rather than a hope. Asserting
 * straight after the click would run before React had committed the boundary's fallback — the shape
 * that has already reported GREEN in this epic having planted nothing.
 */
const plantTheThrow = (page, until) =>
  plant(page, {
    mutate: () => document.querySelector('nav[aria-label="Modes"] a[href="/markets"]')?.click(),
    until,
  })

/** React and the router both log a caught render error. Neither is a defect of the app under test. */
const PLANTED_NOISE = [/planted: \/markets/, /Error in route match/, /above error occurred/]

describe('a surface that throws degrades to `__error__` and leaves the shell standing', () => {
  let brokenBundle
  let brokenWithoutDefaultBundle
  beforeAll(async () => {
    brokenBundle = await buildShell({ throwingRoute: 'markets', throwMessage: THROW_MESSAGE })
    brokenWithoutDefaultBundle = await buildShell({
      source: NO_DEFAULT_ERROR_COMPONENT_ENTRY,
      throwingRoute: 'markets',
      throwMessage: THROW_MESSAGE,
    })
  }, 240_000)

  it('renders the reserved marker on the broken route, and the header and six links survive', async () => {
    const shell = await openShell(browser, { bundle: brokenBundle, path: '/' })
    for (const pattern of PLANTED_NOISE) shell.tolerate(pattern)
    try {
      // The shell is intact before the click, so anything asserted after it is a change this
      // planted throw caused rather than a page that never worked.
      expect((await shell.page.evaluate(readShell)).navLinks).toHaveLength(6)

      await plantTheThrow(
        shell.page,
        () => document.querySelector('[data-route-id]')?.getAttribute('data-route-id') === '__error__',
      )

      const broken = await shell.page.evaluate(readShell)
      expect(broken.markers).toEqual(['__error__'])
      expect(broken.navLinks.map((l) => l.text), 'the throw took the nav with it').toEqual(
        MODES.map(([, , label]) => label),
      )
      expect(broken.headers, 'the throw took the header with it').toBe(1)
      // Still exactly one landmark and one identity: the fallback replaced the surface rather than
      // being rendered beside it.
      expect(broken.mains).toBe(1)

      // Honest about the blast radius, and no stack trace in front of a user.
      expect(broken.surfaceText.length).toBeGreaterThanOrEqual(12)
      expect(broken.surfaceText).not.toContain(THROW_MESSAGE)
      expect(broken.surfaceText).not.toMatch(/\bat\s+\w+\s*\(|\.tsx?:\d+|Error:/)

      // And the claim the copy makes — "the rest of Passbook is unaffected" — is true: the shell
      // still navigates, and the boundary does not follow you to the next surface.
      await shell.page.click('nav[aria-label="Modes"] a[href="/wallet"]')
      await shell.page.waitForFunction(
        () => document.querySelector('[data-route-id]')?.getAttribute('data-route-id') === '/wallet',
      )
      expect((await shell.page.evaluate(readShell)).navLinks).toHaveLength(6)

      // The error was surfaced, never swallowed: it reached the console with its own message.
      expect(shell.consoleErrors.join('\n')).toContain(THROW_MESSAGE)
    } finally {
      await shell.close()
    }
  }, 180_000)

  it('when the ROOT throws, the root boundary answers — the other half of the two-layer contract', async () => {
    //
    // The layer `defaultErrorComponent` deliberately never reaches. It gives every match its own
    // boundary, so a child's throw is caught below the root and this component never fires for one —
    // which leaves it exercised by nothing at all unless the ROOT itself is what breaks. That is the
    // failure it exists for: the shell is gone, so "the rest of Passbook still works" would be a lie
    // and the copy says something else.
    //
    // The plant is the build-time transform, and it proves it landed the same way: `buildEnd`
    // refuses when the transform matched no file, so a bundle that reaches here is one where the
    // root component really was replaced.
    //
    const shell = await openShell(browser, {
      bundle: await buildShell({ throwingRoute: '__root', throwMessage: ROOT_THROW_MESSAGE }),
      path: '/',
    })
    for (const pattern of [...PLANTED_NOISE, /planted: \/__root/]) shell.tolerate(pattern)
    try {
      const seen = await shell.page.evaluate(readShell)

      expect(seen.markers).toEqual(['__error__'])
      expect(seen.headers, 'the root threw, so there is no shell to keep').toBe(0)
      expect(seen.navLinks).toHaveLength(0)

      // And it says the RIGHT thing: the root's copy describes the app failing to start, not a
      // screen failing to load. Sharing one sentence between the two layers would have lost that.
      expect(seen.surfaceText).toMatch(/could not start/i)
      expect(seen.surfaceText).not.toMatch(/rest of Passbook is unaffected/i)
      expect(seen.surfaceText).not.toContain(ROOT_THROW_MESSAGE)
      expect(shell.consoleErrors.join('\n')).toContain(ROOT_THROW_MESSAGE)
    } finally {
      await shell.close()
    }
  }, 180_000)

  it('refuses to hand back a bundle it failed to poison', async () => {
    // The build-time half of "prove the plant landed". A transform that matched nothing would
    // produce a perfectly healthy app, and every assertion above about a broken surface would pass
    // against a surface that is not broken — the most expensive kind of green there is.
    await expect(buildShell({ throwingRoute: 'no-such-surface' })).rejects.toThrow(
      /never reached .*no-such-surface\.tsx/,
    )
  }, 120_000)

  it('THE RED — without `defaultErrorComponent` the same throw takes the whole shell down', async () => {
    const shell = await openShell(browser, { bundle: brokenWithoutDefaultBundle, path: '/' })
    for (const pattern of PLANTED_NOISE) shell.tolerate(pattern)
    try {
      expect((await shell.page.evaluate(readShell)).navLinks).toHaveLength(6)

      await plantTheThrow(
        shell.page,
        () => document.querySelectorAll('nav[aria-label="Modes"] a').length === 0,
      )

      const destroyed = await shell.page.evaluate(readShell)
      expect(destroyed.navLinks).toHaveLength(0)
      expect(destroyed.headers).toBe(0)

      // The marker alone cannot tell the two builds apart — the root's own boundary emits the same
      // reserved value. What separates them is what is left of the app around it, which is exactly
      // what `defaultErrorComponent` buys and the only reason it is set.
      expect(destroyed.markers).toEqual(['__error__'])
    } finally {
      await shell.close()
    }
  }, 180_000)
})

// ---- the harness's own contracts ------------------------------------------------------------------

describe('the harness cannot quietly hand back the wrong page', () => {
  it('escapes `</script>` and `</style>` on the way into the document', () => {
    // The HTML parser ends a raw-text element at the first `</script`, wherever it appears — one
    // such sequence in a comment or a piece of copy truncates the tag and the rest of the bundle is
    // parsed as markup. The page then dies before anything mounts, which arrives as a selector
    // timeout in whichever test ran first.
    const html = shellDocument({
      code: 'const s = "</script>"; window.ok = true',
      css: '/* </style> */ body { color: red }',
      reader: '/* reader */',
    })

    expect(html).not.toMatch(/<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/)
    expect(html).toContain('<\\/script>')
    expect(html).toContain('<\\/style>')
    // Exactly the tags the document is supposed to have, and no extra closers smuggled in by the
    // content: two scripts (reader + bundle) and one style.
    expect(html.match(/<\/script>/g)).toHaveLength(2)
    expect(html.match(/<\/style>/g)).toHaveLength(1)
  })

  it('keys its cache on everything that changes the bytes, including the planted message', async () => {
    // Same route, different message. Keyed on the route alone, the second call hands back the first
    // bundle and any assertion reading the message back is reading the other one's.
    const first = await buildShell({ throwingRoute: 'markets', throwMessage: 'planted: first' })
    const second = await buildShell({ throwingRoute: 'markets', throwMessage: 'planted: second' })

    expect(first.code).toContain('planted: first')
    expect(second.code).toContain('planted: second')
    expect(second.code).not.toContain('planted: first')

    // And an identical request is the SAME promise, not a second multi-second build.
    expect(buildShell({ throwingRoute: 'markets', throwMessage: 'planted: first' })).toBe(
      buildShell({ throwingRoute: 'markets', throwMessage: 'planted: first' }),
    )
  }, 240_000)
})

// ---- the stale-deploy reload, and the loop it must not become -------------------------------------

const RELOADED_KEY = 'passbook-preload-reloaded'

/** Fires Vite's own event shape and reports whether anyone claimed it. */
const dispatchPreloadError = (page) =>
  page.evaluate(() => {
    const event = new Event('vite:preloadError', { cancelable: true })
    window.dispatchEvent(event)
    // Vite's helper ends `if (!e.defaultPrevented) throw err`. This is the only observable that
    // says whether the listener claimed the error or let it become an uncaught crash.
    return { defaultPrevented: event.defaultPrevented }
  })

/**
 * Opens the shell with the guard SEEDED, then waits for the warm to release it.
 *
 * Both halves are load-bearing. Seeding is what makes the release observable at all — against an
 * empty store, "the key is absent" is true before anything has run. And waiting for the release is
 * what makes everything after it deterministic: the warm has finished, so nothing will touch this
 * key again and a test can put it back by hand and know it stays there.
 */
async function openAfterWarmRelease(options) {
  const shell = await open({ path: '/', seedSession: { [RELOADED_KEY]: '1' }, ...options })
  await shell.page.waitForFunction((key) => sessionStorage.getItem(key) === null, RELOADED_KEY, {
    timeout: 10_000,
  })
  return shell
}

describe('a stale deploy reloads once, and never in a loop', () => {
  it('claims the event, so Vite does not rethrow the failure as an uncaught error', async () => {
    // Vite's helper ends `if (!e.defaultPrevented) throw err`. Without `preventDefault()` every
    // stale-chunk failure ships an uncaught page error alongside the recovery — a red build, and a
    // crash racing a reload for the user. The record is put back first so this measures one thing.
    const shell = await openAfterWarmRelease()
    try {
      await shell.page.evaluate((key) => sessionStorage.setItem(key, '1'), RELOADED_KEY)
      expect(await dispatchPreloadError(shell.page)).toEqual({ defaultPrevented: true })
      expect(shell.errors).toEqual([])
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('does not reload when a previous attempt is already on record', async () => {
    //
    // THE LOOP THIS BREAKS IS AUTOMATIC, not click-driven: the deferred warm fetches chunks with no
    // user interaction, so a host that cannot serve them would reload, warm, fail, reload… forever.
    // `sessionStorage` is the only place a flag survives the reload it is guarding against.
    //
    // Observed as a real navigation rather than by stubbing `location.reload`, which Chromium does
    // not permit: assignment to it silently fails, `defineProperty` on it throws, and replacing
    // `window.location` throws. Counting document loads is the only honest instrument here.
    //
    const shell = await openAfterWarmRelease()
    try {
      expect(shell.loads, 'the page under test has not loaded once').toBe(1)
      await shell.page.evaluate((key) => sessionStorage.setItem(key, '1'), RELOADED_KEY)

      await dispatchPreloadError(shell.page)
      await shell.page.waitForTimeout(500)
      expect(shell.loads, 'the guard let a second reload through').toBe(1)
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('DOES reload once the warm has proved that fetching works', async () => {
    //
    // The other side of the same guard, and the reason it is released at all: without releasing it,
    // a tab open across two deploys freezes on the next click with no reload and no message.
    //
    // The release is chained off the warm rather than off mounting because a preload can only fail
    // AFTER the app is running — a flag cleared at mount would always be clear by the time it
    // mattered, and the automatic loop above would be back with the guard still sitting in the
    // source looking like it did something.
    //
    const shell = await openAfterWarmRelease()
    try {
      expect(shell.loads).toBe(1)
      await dispatchPreloadError(shell.page)
      await shell.page.waitForFunction(() => document.querySelector('[data-route-id]') !== null, undefined, {
        timeout: 10_000,
      })
      await shell.page.waitForTimeout(300)
      expect(shell.loads, 'a preload failure after the release did not reload').toBe(2)
    } finally {
      await shell.close()
    }
  }, 120_000)
})

// ---- the theme ------------------------------------------------------------------------------------

/** Chooses one of the three options on `/settings` and waits for the page to repaint. */
async function chooseTheme(page, id) {
  await page.check(`input[name="theme"][value="${id}"]`)
  await page.waitForFunction(
    (expected) =>
      (document.documentElement.getAttribute('data-theme') ?? 'system') === expected,
    id,
    { timeout: 5_000 },
  )
}

/**
 * The sentence that promises the pin will be there next time.
 *
 * One pattern, asserted in BOTH directions: present when storage worked, absent when it threw. A
 * one-sided check would pass on copy that never makes the promise at all, which is a different bug
 * with the same green.
 */
const PERSISTENCE_PROMISE = /opens in this theme/i

const painted = () => ({
  background: getComputedStyle(document.body).backgroundColor,
  colorScheme: getComputedStyle(document.documentElement).colorScheme,
  attribute: document.documentElement.getAttribute('data-theme'),
  checked: document.querySelector('input[name="theme"]:checked')?.getAttribute('value') ?? null,
  status: (document.querySelector('[aria-live="polite"]')?.textContent ?? '').trim(),
})

describe('the theme writer: six states, live and after a reload', () => {
  //
  // OS x pin, exhaustively. The two states CSS cannot reach on its own are the ones where the pin
  // disagrees with the operating system, and they are the reason `index.html` carries a blocking
  // script at all.
  //
  const STATES = [
    { os: 'light', pin: 'system', expect: 'light' },
    { os: 'light', pin: 'light', expect: 'light' },
    { os: 'light', pin: 'dark', expect: 'dark' },
    { os: 'dark', pin: 'system', expect: 'dark' },
    { os: 'dark', pin: 'light', expect: 'light' },
    { os: 'dark', pin: 'dark', expect: 'dark' },
  ]

  for (const state of STATES) {
    it(`OS ${state.os} + pin ${state.pin} paints ${state.expect}, and still does after a reload`, async () => {
      const shell = await open({ path: '/settings', colorScheme: state.os })
      try {
        await chooseTheme(shell.page, state.pin)

        const live = await shell.page.evaluate(painted)
        expect(live.background).toBe(PAINTED[state.expect])
        expect(live.colorScheme).toBe(state.expect)
        expect(live.attribute).toBe(state.pin === 'system' ? null : state.pin)

        // The round trip: storage -> the blocking reader -> the attribute -> the sheet. Everything
        // that could be true only in this tab is gone by the time this runs.
        await shell.page.reload({ waitUntil: 'load' })
        await shell.page.waitForSelector('[data-route-id]', { state: 'attached' })

        const afterReload = await shell.page.evaluate(painted)
        expect(afterReload.background).toBe(PAINTED[state.expect])
        expect(afterReload.colorScheme).toBe(state.expect)
        expect(afterReload.attribute).toBe(state.pin === 'system' ? null : state.pin)

        // The control shows the state it is in, not the state it was left in.
        expect(afterReload.checked).toBe(state.pin)
      } finally {
        await shell.close()
      }
    }, 120_000)
  }

  it('follow-system is a real third state: clearing a pin hands the page back to the OS', async () => {
    const shell = await open({ path: '/settings', colorScheme: 'dark' })
    try {
      await chooseTheme(shell.page, 'light')
      expect((await shell.page.evaluate(painted)).background).toBe(PAINTED.light)

      await chooseTheme(shell.page, 'system')
      const back = await shell.page.evaluate(painted)
      expect(back.attribute).toBeNull()
      expect(back.background).toBe(PAINTED.dark)

      await shell.page.reload({ waitUntil: 'load' })
      await shell.page.waitForSelector('[data-route-id]', { state: 'attached' })
      expect((await shell.page.evaluate(painted)).background).toBe(PAINTED.dark)
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('private mode: the page repaints, the control says so, and the pin does not survive', async () => {
    const shell = await open({ path: '/settings', colorScheme: 'light', storageThrows: true })
    try {
      await chooseTheme(shell.page, 'dark')

      // The live page IS repainted — the DOM write happens first and does not depend on storage.
      const live = await shell.page.evaluate(painted)
      expect(live.background).toBe(PAINTED.dark)
      expect(live.attribute).toBe('dark')

      // And the control reads its own state off the DOM, so it agrees with what is on the screen.
      // A storage-first read would say "follow system" while the user looks at a dark page.
      expect(live.checked).toBe('dark')

      // It does not claim persistence it does not have. `PERSISTENCE_PROMISE` is the sentence the
      // healthy state makes and this one may not — asserted in both directions by the case below,
      // so neither half can quietly stop being true.
      expect(live.status).toMatch(/could not be stored/i)
      expect(live.status).not.toMatch(PERSISTENCE_PROMISE)

      // And the honest claim is the true one: after a real reload the pin is gone.
      await shell.page.reload({ waitUntil: 'load' })
      await shell.page.waitForSelector('[data-route-id]', { state: 'attached' })
      const afterReload = await shell.page.evaluate(painted)
      expect(afterReload.attribute).toBeNull()
      expect(afterReload.background).toBe(PAINTED.light)
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('makes the persistence promise only when it can keep it', async () => {
    // The other half of the private-mode case. Same click, working storage: the control says the
    // pin will still be there next time — which is a claim, and it is true here.
    const shell = await open({ path: '/settings', colorScheme: 'light' })
    try {
      await chooseTheme(shell.page, 'dark')
      expect((await shell.page.evaluate(painted)).status).toMatch(PERSISTENCE_PROMISE)
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('THE RED — the same attribute on `<body>` pins nothing at all', async () => {
    // The sheet selects `:root[data-theme="dark"]`. One element down and the write is silent: no
    // error, no warning, and a writer that targeted `<body>` would look entirely correct in review.
    const shell = await open({ path: '/settings', colorScheme: 'light' })
    try {
      await plant(shell.page, {
        mutate: () => document.body.setAttribute('data-theme', 'dark'),
        until: () => document.body.getAttribute('data-theme') === 'dark',
      })

      const seen = await shell.page.evaluate(painted)
      expect(seen.background).toBe(PAINTED.light)
      expect(seen.attribute).toBeNull()
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('the control reads the DOM, so a pin storage never received still shows as the pin', async () => {
    //
    // THE CASE THAT SEPARATES A DOM-FIRST READ FROM A STORAGE-FIRST ONE, and the only one that
    // does. After the click, the control knows its own state from the click. After a RELOAD with
    // working storage, both reads agree. What tells them apart is a pin that is in force on the
    // document and absent from storage — private mode — read on a FRESH mount. Navigating away and
    // back remounts `/settings` without reloading, so the attribute survives and storage is still
    // empty. A storage-first read reports "follow system" while the user is looking at a dark page.
    //
    const shell = await open({ path: '/settings', colorScheme: 'light', storageThrows: true })
    try {
      await chooseTheme(shell.page, 'dark')

      await shell.page.click('nav[aria-label="Modes"] a[href="/markets"]')
      await shell.page.waitForFunction(
        () => document.querySelector('[data-route-id]')?.getAttribute('data-route-id') === '/markets',
      )
      await shell.page.click('header.app-header a[href="/settings"]')
      await shell.page.waitForSelector('input[name="theme"]', { state: 'attached' })

      const remounted = await shell.page.evaluate(painted)
      expect(remounted.attribute).toBe('dark')
      expect(remounted.background).toBe(PAINTED.dark)
      expect(remounted.checked).toBe('dark')

      //
      // AND THE SENTENCE SURVIVES THE REMOUNT, which is the half that was wrong. The status used to
      // come from click-session state, and click-session state resets when the component unmounts —
      // so coming back to `/settings` in this exact situation fell through to the durable promise
      // and claimed a pin had been stored on a device that had just refused to store it.
      //
      expect(remounted.status).toMatch(/could not be stored/i)
      expect(remounted.status).not.toMatch(PERSISTENCE_PROMISE)
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('a pin that could not be CLEARED says a reload will bring it back, not that it is gone', async () => {
    //
    // The failure this closes is the mirror image of private mode and it reads the same from inside
    // `pinTheme()`: the DOM took the change, storage did not. But storage is not EMPTY here — it is
    // still holding the pin the user just dropped, so the reload the copy used to describe would
    // have brought dark back while the sentence promised the system setting.
    //
    // Which is why the copy is derived from a comparison of two places rather than from one call's
    // return value: `'dom-only'` is true of both situations and can only ever describe one of them.
    //
    const shell = await open({ path: '/settings', colorScheme: 'light' })
    try {
      await chooseTheme(shell.page, 'dark')
      expect((await shell.page.evaluate(painted)).status).toMatch(PERSISTENCE_PROMISE)

      // Only the CLEAR fails. The pin is already stored, and stays stored.
      await plant(shell.page, {
        mutate: () => {
          Storage.prototype.removeItem = () => {
            throw new DOMException('nope', 'InvalidAccessError')
          }
          document.documentElement.setAttribute('data-clear-blocked', 'yes')
        },
        until: () => document.documentElement.getAttribute('data-clear-blocked') === 'yes',
      })

      await chooseTheme(shell.page, 'system')

      const cleared = await shell.page.evaluate(painted)
      // The page really is following the system again…
      expect(cleared.attribute).toBeNull()
      expect(cleared.background).toBe(PAINTED.light)
      expect(cleared.checked).toBe('system')
      // …and the copy says the true thing about what happens next.
      expect(cleared.status).toMatch(/reload will use the dark theme/i)
      expect(cleared.status).not.toMatch(PERSISTENCE_PROMISE)
      expect(cleared.status).not.toMatch(/follow your system setting again/i)
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('the blocking reader it round-trips through is the one `index.html` ships', () => {
    // Read, not re-typed. A harness carrying its own copy would keep passing after the real script
    // was deleted — and a deleted reader is a flash of the wrong theme for every pinned user.
    expect(themeReaderScript()).toContain('passbook-theme')
    expect(themeReaderScript()).toContain('documentElement')
  })
})

// ---- the writer's own return values ---------------------------------------------------------------

//
// A second bundle that mounts nothing and puts the theme module on `window`.
//
// The `/settings` cases above are the product path and prove the outcome; they cannot see what
// `pinTheme()` RETURNED or what `effectiveTheme()` answers, and those are contract, not decoration:
// `'dom-only'` is what the settings copy is derived from, and `effectiveTheme()` exists for the
// surfaces that come later. Untested exports are how a module ends up meaning something different
// from what its callers assume. It imports the real stylesheet too, so "what it answers" can be
// compared against what the page is actually painted.
//
const THEME_MODULE_ENTRY = `
import ${JSON.stringify(join(WEB_ROOT, 'src/index.css'))}
import { pinTheme, themeChoice, storedChoice, effectiveTheme, systemTheme } from ${JSON.stringify(join(WEB_ROOT, 'src/shell/theme.ts'))}
window.__THEME__ = { pinTheme, themeChoice, storedChoice, effectiveTheme, systemTheme }
document.documentElement.setAttribute('data-theme-module', 'ready')
`

describe('theme.ts answers about the DOM, and says what it actually managed to do', () => {
  let themeBundle
  beforeAll(async () => {
    themeBundle = await buildShell({ source: THEME_MODULE_ENTRY })
  }, 180_000)

  const openModule = (options) =>
    openShell(browser, { bundle: themeBundle, waitFor: '[data-theme-module]', ...options })

  it('with no pin, it reports the operating system — and `themeChoice` says "follow system"', async () => {
    const shell = await openModule({ colorScheme: 'dark' })
    try {
      expect(
        await shell.page.evaluate(() => ({
          choice: window.__THEME__.themeChoice(),
          system: window.__THEME__.systemTheme(),
          effective: window.__THEME__.effectiveTheme(),
          background: getComputedStyle(document.body).backgroundColor,
        })),
      ).toEqual({ choice: null, system: 'dark', effective: 'dark', background: PAINTED.dark })
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('with a pin that disagrees with the OS, it reports the pin — and the pin is what painted', async () => {
    const shell = await openModule({ colorScheme: 'dark' })
    try {
      expect(
        await shell.page.evaluate(() => ({
          result: window.__THEME__.pinTheme('light'),
          choice: window.__THEME__.themeChoice(),
          system: window.__THEME__.systemTheme(),
          effective: window.__THEME__.effectiveTheme(),
          background: getComputedStyle(document.body).backgroundColor,
        })),
      ).toEqual({
        result: true,
        choice: 'light',
        system: 'dark',
        effective: 'light',
        background: PAINTED.light,
      })
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('when storage refuses, it says `dom-only` — and still answers with what is painted', async () => {
    // The storage-first read this rules out would answer 'dark' here (nothing was stored, so the OS
    // wins) while the page in front of the user is light. Reported as the opposite of the truth.
    const shell = await openModule({ colorScheme: 'dark', storageThrows: true })
    try {
      expect(
        await shell.page.evaluate(() => ({
          result: window.__THEME__.pinTheme('light'),
          effective: window.__THEME__.effectiveTheme(),
          background: getComputedStyle(document.body).backgroundColor,
        })),
      ).toEqual({ result: 'dom-only', effective: 'light', background: PAINTED.light })
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('`storedChoice` answers the question `pinTheme`\'s return value structurally cannot', async () => {
    //
    // `'dom-only'` means "storage did not take this". It does NOT mean "storage is empty", and the
    // difference is a whole state: a pin that failed to CLEAR leaves the old value behind, so the
    // page follows the system while a reload would bring the pin back. One call cannot report that,
    // because it is a fact about two places.
    //
    const shell = await openModule({ colorScheme: 'light' })
    try {
      expect(
        await shell.page.evaluate(() => {
          const t = window.__THEME__
          const seen = { empty: t.storedChoice() }
          t.pinTheme('dark')
          seen.afterPin = t.storedChoice()

          // Only the clear fails, exactly as `removeItem` throwing would.
          Storage.prototype.removeItem = () => {
            throw new DOMException('nope', 'InvalidAccessError')
          }
          seen.clearResult = t.pinTheme(null)
          seen.paintedAfterClear = t.themeChoice()
          seen.storedAfterClear = t.storedChoice()
          return seen
        }),
      ).toEqual({
        empty: null,
        afterPin: 'dark',
        // The write's own verdict — true of a failed clear and of private mode alike…
        clearResult: 'dom-only',
        // …while these two, together, are what actually happened: nothing is pinned any more, and a
        // reload restores dark.
        paintedAfterClear: null,
        storedAfterClear: 'dark',
      })
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('`storedChoice` reports `unreadable` rather than guessing at what a reload will do', async () => {
    // Private mode throws on read. Answering `null` there would be stating the outcome of a reload
    // this code cannot see — the one thing it must not do.
    const shell = await openModule({ colorScheme: 'light', storageThrows: true })
    try {
      expect(await shell.page.evaluate(() => window.__THEME__.storedChoice())).toBe('unreadable')
    } finally {
      await shell.close()
    }
  }, 120_000)

  it('reports `false` when there was nothing to write to, rather than claiming a write', async () => {
    const shell = await openModule({})
    try {
      expect(await shell.page.evaluate(() => window.__THEME__.pinTheme('dark', { root: null }))).toBe(
        false,
      )
      // And nothing was painted, which is what `false` is claiming.
      expect(
        await shell.page.evaluate(() => document.documentElement.getAttribute('data-theme')),
      ).toBeNull()
    } finally {
      await shell.close()
    }
  }, 120_000)
})

// ---- the authored classes -------------------------------------------------------------------------

const scratchDirs = []
afterAll(() => {
  while (scratchDirs.length) rmSync(scratchDirs.pop(), { recursive: true, force: true })
})

function scratchFile(name, source) {
  const dir = mkdtempSync(join(tmpdir(), 'passbook-shell-classes-'))
  scratchDirs.push(dir)
  const file = join(dir, name)
  writeFileSync(file, source)
  return file
}

function lintTokens(file) {
  try {
    // stderr is PIPED, not inherited: the red control below deliberately produces findings, and
    // letting them print would put a real-looking lint failure in the middle of a passing run.
    return {
      code: 0,
      out: execFileSync('node', [resolve('scripts/lint-tokens.mjs'), '--scan', file], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    }
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** The classes `index.css` defines beyond the two primitives 6-2 shipped. */
const SHELL_CLASSES = ['app-header', 'nav-item', 'focus-ring']

describe('the shell writes CSS instead of banned utilities — and it is allowed to', () => {
  it('defines each shell class as a bare rule, which is what registers it with the lint', () => {
    // `appBaseClasses()` harvests `^\s*\.name\s*(?:,|\{)`. A class that exists ONLY as
    // `.name[data-x]` or `.name:hover` registers nothing, and every use of it becomes a finding —
    // so the bare rule is load-bearing rather than a formatting habit.
    const registered = appBaseClasses()
    for (const name of SHELL_CLASSES) {
      expect(registered, `.${name} is not registered by a bare rule in index.css`).toContain(name)
    }
    expect(registered).toContain('numeric')
    expect(registered).toContain('dotted-grid')
  })

  it('accepts them planted in a real className, and still rejects an off-sheet class beside them', () => {
    const good = scratchFile(
      'shell-classes.tsx',
      `export const C = () => <header className="${SHELL_CLASSES.join(' ')} flex flex-wrap items-center gap-s8 p-s16" />\n`,
    )
    const { code, out } = lintTokens(good)
    expect(out).toMatch(/token lint: 1 file\(s\) clean/)
    expect(code).toBe(0)

    // The control that makes the pass mean something: the same file, one banned utility added. If
    // this were green too, the file was being skipped rather than approved.
    const bad = scratchFile(
      'shell-classes-red.tsx',
      `export const C = () => <header className="${SHELL_CLASSES.join(' ')} z-50" />\n`,
    )
    const red = lintTokens(bad)
    expect(red.code).toBe(1)
    expect(red.out).toContain('z-50')
  })

  it('paints: the header, the nav item and the ring are real rules, not dead class names', async () => {
    const shell = await open({ path: '/' })
    try {
      const seen = await shell.page.evaluate(() => {
        const header = document.querySelector('header.app-header')
        const link = document.querySelector('nav[aria-label="Modes"] a.nav-item')
        const active = document.querySelector('nav[aria-label="Modes"] a[data-status="active"]')
        const inactive = document.querySelector('nav[aria-label="Modes"] a:not([data-status="active"])')
        return {
          headerBackground: getComputedStyle(header).backgroundColor,
          headerPosition: getComputedStyle(header).position,
          navRadius: getComputedStyle(link).borderTopLeftRadius,
          ringBeforeFocus: getComputedStyle(link).outlineStyle,
          activeText: (active?.textContent ?? '').trim(),
          activeBackground: active ? getComputedStyle(active).backgroundColor : null,
          activeColor: active ? getComputedStyle(active).color : null,
          inactiveBackground: inactive ? getComputedStyle(inactive).backgroundColor : null,
        }
      })

      // `raised`, not the page ground: an unstyled header would inherit `transparent`.
      expect(seen.headerBackground).not.toBe('rgba(0, 0, 0, 0)')
      expect(seen.headerPosition).toBe('sticky')
      expect(seen.navRadius).not.toBe('0px')

      //
      // YOU CAN SEE WHICH MODE YOU ARE IN. Delete the `[data-status='active']` rule and all six
      // paint identically while every gate in the repo stays green — the tests that check
      // current-ness read `aria-current`, which is a different attribute this rule does not use.
      // Compared against a sibling rather than against a colour literal, so a re-themed palette
      // never turns this red for the wrong reason.
      //
      expect(seen.activeText).toBe('Wallet')
      expect(seen.activeBackground, 'the active mode paints like every other one').not.toBe(
        seen.inactiveBackground,
      )
      expect(seen.activeBackground).not.toBe('rgba(0, 0, 0, 0)')

      // The ring is off until a keyboard says otherwise — `:focus-visible`, never `:focus`.
      expect(seen.ringBeforeFocus).toBe('none')

      await shell.page.keyboard.press('Tab')
      await shell.page.keyboard.press('Tab')
      const focused = await shell.page.evaluate(() => {
        const el = document.activeElement
        return {
          tag: el?.tagName.toLowerCase(),
          hasRingClass: el?.classList.contains('focus-ring') ?? false,
          outlineStyle: el ? getComputedStyle(el).outlineStyle : null,
          outlineWidth: el ? getComputedStyle(el).outlineWidth : null,
        }
      })
      expect(focused.tag).toBe('a')
      expect(focused.hasRingClass).toBe(true)
      expect(focused.outlineStyle).toBe('solid')
      expect(focused.outlineWidth).not.toBe('0px')
    } finally {
      await shell.close()
    }
  }, 90_000)
})
