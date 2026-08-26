//
// The app harness: the real `apps/web` entry, bundled in process, running in a real browser.
//
// Test-support only — nothing in the build imports this, and it is deliberately not named
// `*.test.mjs` so the runner does not collect it as a suite.
//
// WHY IT EXISTS. `vitest` does not collect `apps/web` at all (its include globs are `packages/*/test`,
// the legacy `web/`, and `scripts/`), so a test file planted under the app is never run and the suite
// reports green having skipped it. And jsdom is provably vacuous for everything this story has to
// prove: it has no layout engine (every rect is 0x0), no cascade to speak of (colours come back as
// UA defaults) and `getPropertyValue('--color-neutral2')` returns the EMPTY STRING — so even the
// weakest "the token is defined" assertion passes on nothing. The only place the shell's geometry,
// painted theme and history behaviour are real is a browser.
//
// ZERO NEW DEPENDENCIES. `vite` and `playwright-core` are already devDependencies and the browser is
// the one `build:web` already needs.
//
// ---- three things about the shape of this file, each measured -------------------------------------
//
//   THE `NODE_ENV` DEFINE IS MANDATORY. React's ESM build reads `process.env.NODE_ENV`, and a browser
//   has no `process`. Without the define the page throws `process is not defined` before anything
//   mounts, and — because the throw happens during module evaluation — every downstream failure
//   presents as a 30 s selector timeout in whichever test happened to run first. It reads as a
//   flaky harness rather than as a missing three-word option.
//
//   THE BUNDLE IS THE REAL `src/main.tsx`, NOT A RE-DESCRIPTION OF IT. A hand-written entry that
//   calls `createRouter({ routeTree })` itself would be a second copy of the router configuration —
//   including the two default fallbacks, which are the whole error contract — and the day the two
//   disagree is the day this harness starts proving something the app does not do. Building the
//   shipped entry costs one `@tailwindcss/vite` plugin in the list and buys exact fidelity.
//
//   THE DOCUMENT IS SERVED FROM AN INTERCEPTED ORIGIN, NOT `page.setContent`. This is a deliberate
//   departure from the story's sketch and the reason is not style: `about:blank` is an OPAQUE origin.
//   `localStorage` throws there, so the theme writer cannot be exercised at all; and `history` cannot
//   be moved to a path, so neither the `/` -> `/wallet` redirect nor "one Back leaves the document"
//   can be observed. Playwright's own request interception gives a real origin with real storage,
//   real history and real reloads while still starting no server and adding no dependency — and it
//   fulfils EVERY path with the same document, which is exactly the SPA-fallback behaviour the
//   recorded host is configured for.
//
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..')
export const WEB_ROOT = join(REPO_ROOT, 'apps/web')
export const APP_ENTRY = join(WEB_ROOT, 'src/main.tsx')
export const APP_INDEX_HTML = join(WEB_ROOT, 'index.html')

/**
 * The origin every harness page is served from.
 *
 * A name that resolves to nothing, on purpose: every request is fulfilled by the route handler
 * below, so a URL that escaped it would fail loudly rather than reach the network.
 */
export const SHELL_ORIGIN = 'http://passbook.test'

const VIRTUAL_ENTRY = 'passbook-shell-virtual-entry'
const VIRTUAL_ENTRY_ID = `\0${VIRTUAL_ENTRY}`

/**
 * Serves a source string as a module, for the cases that need to reach INTO the app rather than
 * drive it — exposing a module on `window` so its return values can be read directly.
 *
 * The id is prefixed with a NUL so nothing else in the graph can resolve it by accident. Relative
 * specifiers cannot be resolved from a virtual module, so such an entry must import by absolute
 * path; `APP_ENTRY` and its siblings are exported above for exactly that.
 */
function virtualEntryPlugin(source) {
  return {
    name: 'passbook:shell-virtual-entry',
    // `endsWith`, not equality: Vite normalizes `build.lib.entry` against the project root before
    // any plugin sees it, so the id that arrives here is `apps/web/passbook-shell-virtual-entry`
    // rather than the bare name. Equality fails with `[UNRESOLVED_ENTRY]` and a stack pointing at
    // rolldown, which reads as a broken bundler rather than a naming mismatch.
    resolveId: (id) => (id === VIRTUAL_ENTRY || id.endsWith(`/${VIRTUAL_ENTRY}`) ? VIRTUAL_ENTRY_ID : null),
    load: (id) => (id === VIRTUAL_ENTRY_ID ? source : null),
  }
}

/**
 * Makes ONE real surface throw on every render, without editing a byte of `apps/web`.
 *
 * "A surface throws" is a row in the story's edge-case matrix and it is the reason
 * `defaultErrorComponent` is set at all — so it has to be exercised against the real route tree, the
 * real root and the real entry, not against a fixture that merely says `__error__`.
 *
 * WHY THE SEAM IS `Route.options.component` AND NOT A TEXT SUBSTITUTION IN THE COMPONENT BODY. It is
 * the route object's own public shape: `BaseRoute` keeps its option bag on `this.options`, and the
 * generated tree's `update({ id, path, getParentRoute })` is an `Object.assign` of those three keys
 * onto it — so an assignment appended after the module body survives tree construction, and
 * `MatchInner` reads `route.options.component` at render. Nothing here depends on what the route
 * file's component is CALLED or how it is written, which is what a `code.replace()` on a function
 * name would have depended on.
 *
 * `buildEnd` refuses when the transform never matched. A plant that does not land is the failure
 * this whole harness is careful about: the control reports green having poisoned nothing.
 */
function throwingRoutePlugin(routeFile, message) {
  const target = join(WEB_ROOT, 'src/routes', `${routeFile}.tsx`)
  let applied = false
  return {
    name: 'passbook:throwing-route',
    // Ahead of the TypeScript/JSX transform, so what is appended is plain JavaScript that is valid
    // in the file either way round.
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0] !== target) return null
      applied = true
      return `${code}
;Route.options.component = function PlantedThrowingSurface() {
  throw new Error(${JSON.stringify(message)})
};
`
    },
    buildEnd(error) {
      // A build that already failed has a real reason, and it is not this one. Throwing here would
      // replace it with "the transform never reached …", which is true and useless — the transform
      // never ran because the build died first.
      if (error) return
      if (!applied) {
        throw new Error(
          `the throwing-surface transform never reached ${target}, so the bundle it produced is a ` +
            `HEALTHY app. Every assertion about a broken surface would then pass against a surface ` +
            `that is not broken. Check the path — this refuses rather than planting nothing.`,
        )
      }
    },
  }
}

/**
 * Bundles are expensive (seconds) and pure functions of their input, so they are built once.
 *
 * The PROMISE is cached, not the result: two suites asking for the same bundle before either
 * finishes would otherwise each run a full build, and the second would overwrite the first's entry
 * with an identical one having paid for it twice.
 */
const bundles = new Map()

/**
 * Builds one IIFE bundle plus the stylesheet that goes with it.
 *
 * @param {object} [o]
 * @param {string} [o.entry]   absolute path to an entry module. Defaults to the app's real entry.
 * @param {string} [o.source]  entry source, served as a virtual module. Mutually exclusive with
 *   `entry`; must import by ABSOLUTE path.
 * @param {string} [o.throwingRoute]  a file under `src/routes` (no extension) whose component is
 *   replaced with one that throws on every render.
 * @param {string} [o.throwMessage]
 * @returns {Promise<{code: string, css: string}>}
 */
export function buildShell({
  entry,
  source,
  throwingRoute,
  throwMessage = `planted: /${throwingRoute} throws on every render`,
} = {}) {
  if (entry && source) throw new Error('buildShell takes `entry` or `source`, never both')
  //
  // EVERY INPUT THAT CHANGES THE BYTES IS IN THE KEY. The poisoned variants are different bundles,
  // so keying on the entry alone would hand the healthy bundle to the test that asked for a broken
  // one — a green run against an app with nothing wrong with it. `throwMessage` is in here for the
  // same reason and not for symmetry: two calls for the same route with different messages are two
  // different bundles, and the assertion that reads the message back would be reading the other
  // one's.
  //
  const key = [source ?? entry ?? APP_ENTRY, throwingRoute ?? 'none', throwingRoute ? throwMessage : ''].join('::')
  const cached = bundles.get(key)
  if (cached) return cached

  const pending = buildShellUncached({ entry, source, throwingRoute, throwMessage })
  // The PROMISE goes in before it settles, so a concurrent caller waits on this build instead of
  // starting a second one. A rejected build is evicted: a transient failure must not be cached as
  // the permanent answer for the rest of the run.
  bundles.set(key, pending)
  pending.catch(() => bundles.delete(key))
  return pending
}

async function buildShellUncached({ entry, source, throwingRoute, throwMessage }) {
  const built = await build({
    root: WEB_ROOT,
    configFile: false,
    logLevel: 'warn',
    // The one option without which every failure in this file lies about where it came from.
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    plugins: [
      ...(source ? [virtualEntryPlugin(source)] : []),
      ...(throwingRoute ? [throwingRoutePlugin(throwingRoute, throwMessage)] : []),
      react(),
      // Present so the app entry's `import './index.css'` resolves the framework, the generated
      // token sheet and the typeface — i.e. so the page is styled by the sheet that ships rather
      // than by a copy of it. In library mode every asset is inlined as a data URI, so the fonts
      // come with it and the page makes no subresource requests at all.
      tailwindcss(),
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: source ? VIRTUAL_ENTRY : (entry ?? APP_ENTRY),
        formats: ['iife'],
        name: 'PassbookShell',
        fileName: 'shell',
      },
    },
  })

  const output = (Array.isArray(built) ? built[0] : built).output
  const chunk = output.find((o) => o.type === 'chunk' && o.isEntry)
  if (!chunk) throw new Error('the shell build emitted no entry chunk')
  const stylesheet = output.find((o) => o.fileName.endsWith('.css'))

  return { code: chunk.code, css: String(stylesheet?.source ?? '') }
}

/**
 * The SHIPPED blocking theme reader, lifted out of `apps/web/index.html`.
 *
 * Read rather than re-typed, and it refuses rather than falling back: the reload half of the theme
 * contract is a round trip through THAT script, and a harness carrying its own copy would keep
 * passing after the real one was deleted — which is the exact failure the theme story is about.
 */
export function themeReaderScript(indexHtmlPath = APP_INDEX_HTML) {
  const html = readFileSync(indexHtmlPath, 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script || !script.includes('localStorage')) {
    throw new Error(
      `${indexHtmlPath} no longer carries a blocking inline theme reader. That script is what paints ` +
        `a pinned theme before the first frame; without it the pin is applied late and every user ` +
        `who pinned one sees a flash. Refusing to test a contract that has been deleted.`,
    )
  }
  return script
}

/**
 * Makes a string safe to sit inside a raw text element.
 *
 * THIS IS NOT DEFENSIVE PADDING. The HTML parser ends a `<script>` or `<style>` at the first
 * `</script` / `</style` in its text, wherever that appears — a route file containing the string in
 * a comment or a piece of copy would truncate the tag, and the rest of the bundle would be parsed as
 * markup. The page dies before anything mounts, which arrives as a selector timeout in whichever
 * test happens to run first: the exact misdiagnosis the NODE_ENV note at the top of this file is
 * about. Breaking the `<` is the standard escape and changes nothing about what the JS engine sees.
 */
function escapeForRawText(source) {
  return String(source).replace(/<\/(script|style)/gi, '<\\/$1')
}

/**
 * The document the harness serves: the app's own head shape, its stylesheet, and the bundle.
 *
 * `<div id="root">` because that is what `main.tsx` mounts into and it throws by name when it is
 * absent. The reader script is first and blocking, as it is in `index.html`.
 */
export function shellDocument({ code, css, reader = themeReaderScript() }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Passbook harness</title>
    <script>${escapeForRawText(reader)}</script>
    <style>${escapeForRawText(css)}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${escapeForRawText(code)}</script>
  </body>
</html>
`
}

/**
 * Opens the shell at `path` and starts collecting everything that went wrong.
 *
 * COLLECTED AND RE-THROWN, never merely recorded. An uncaught page error or a console error is the
 * failure most of this harness exists to notice, and a bundle defect that is only visible in a
 * variable nobody reads presents instead as a selector timeout in an unrelated test.
 *
 * `close()` is where that assertion runs, so nothing can be forgotten — with the consequence that a
 * page error thrown from a `finally` will replace an assertion failure that was already in flight.
 * When both are plausible, call `assertClean()` as the last line of the try block and read them in
 * the order they happened.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {object} o
 * @param {{code: string, css: string}} o.bundle
 * @param {string} [o.path]              where to open. Defaults to the cold open, `/`.
 * @param {'light'|'dark'} [o.colorScheme]  what the operating system is asking for.
 * @param {boolean} [o.storageThrows]    emulate the private-mode failure: every `localStorage`
 *   write throws, on every navigation, including the blocking reader's read.
 * @param {{width: number, height: number}} [o.viewport]
 * @param {Record<string,string>} [o.seedSession]  `sessionStorage` entries written before any page
 *   script runs, on every navigation. For starting the app in a state it would otherwise have to
 *   reach by failing first.
 * @param {string|null} [o.waitFor]      selector to wait for before returning. Defaults to the
 *   route-identity marker, which is what "the app has painted" means. `null` for a bundle that
 *   mounts nothing — a module put on `window` to be called directly.
 */
export async function openShell(
  browser,
  {
    bundle,
    path = '/',
    colorScheme = 'light',
    storageThrows = false,
    viewport,
    seedSession,
    waitFor = '[data-route-id]',
  } = {},
) {
  const context = await browser.newContext({ colorScheme, ...(viewport ? { viewport } : {}) })
  const document = shellDocument(bundle)

  if (storageThrows) {
    //
    // Safari's private mode does not hide `localStorage` — it throws on use. Overriding the
    // prototype methods reproduces that exactly, and `addInitScript` runs before ANY page script,
    // so it is in place before the blocking reader in `<head>` runs. Re-applied on every
    // navigation, which is what makes the reload half of this case real.
    //
    await context.addInitScript(() => {
      const boom = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      Storage.prototype.setItem = boom
      Storage.prototype.removeItem = boom
      Storage.prototype.getItem = boom
    })
  }

  if (seedSession) {
    await context.addInitScript((entries) => {
      try {
        for (const [key, value] of entries) sessionStorage.setItem(key, value)
      } catch {
        // Seeding a store that refuses writes is not a failure of the test that asked for it.
      }
    }, Object.entries(seedSession))
  }

  const page = await context.newPage()
  await page.route(`${SHELL_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: document }),
  )

  const errors = []
  const consoleErrors = []
  // Counted here rather than in the page, because a reload wipes anything the page was counting in
  // — and a reload is exactly what some of these tests are trying to observe.
  let loads = 0
  page.on('load', () => {
    loads += 1
  })
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  const tolerated = []

  const handle = {
    page,
    context,
    errors,
    consoleErrors,
    /** How many documents this page has loaded. One after `openShell`; two after a reload. */
    get loads() {
      return loads
    },
    /** Register a failure this test is deliberately causing, so `assertClean()` ignores it. */
    tolerate(pattern) {
      tolerated.push(pattern)
      return handle
    },
    assertClean() {
      const kept = (list) => list.filter((m) => !tolerated.some((p) => p.test(m)))
      const problems = [
        ...kept(errors).map((e) => `uncaught page error: ${e}`),
        ...kept(consoleErrors).map((e) => `console error: ${e}`),
      ]
      if (problems.length) {
        throw new Error(`the shell did not run cleanly:\n  - ${problems.join('\n  - ')}`)
      }
    },
    async close() {
      try {
        handle.assertClean()
      } finally {
        await context.close()
      }
    },
  }

  //
  // The context is closed on the way out of a FAILED open. Without this a bundle that throws on
  // load, or a marker that never attaches, leaks a browser context per attempt — and a suite that
  // leaks contexts eventually fails for reasons that have nothing to do with what it was testing.
  //
  try {
    await page.goto(`${SHELL_ORIGIN}${path}`, { waitUntil: 'load' })
    if (waitFor) await page.waitForSelector(waitFor, { state: 'attached', timeout: 10_000 })
  } catch (e) {
    // Whatever the page managed to say before it failed is the most useful thing here — a bare
    // "selector timed out" hides a `process is not defined` that is sitting right there.
    const said = [...errors, ...consoleErrors]
    await context.close()
    throw new Error(
      `the shell did not open at ${path}: ${e?.message ?? e}` +
        (said.length ? `\n  the page reported:\n  - ${said.join('\n  - ')}` : ''),
    )
  }
  return handle
}

/**
 * Plants a failure and REFUSES TO CONTINUE UNTIL IT HAS LANDED.
 *
 * This shape is not caution. The obvious form — mutate, then assert — ran before React had
 * committed and reported GREEN having planted nothing: a negative control that silently proves the
 * assertion it was written to challenge. So the mutation is followed by an in-page poll on a
 * predicate the caller supplies, and only then is `data-planted` set, which is the fact this
 * function waits on. If the plant never takes, this throws rather than letting the test pass.
 *
 * @param {import('playwright-core').Page} page
 * @param {object} o
 * @param {() => void} o.mutate  runs in the page
 * @param {() => boolean} o.until  runs in the page; true once the mutation is observable
 */
export async function plant(page, { mutate, until, timeoutMs = 5_000 }) {
  await page.evaluate(() => document.documentElement.removeAttribute('data-planted'))
  await page.evaluate(mutate)
  try {
    await page.waitForFunction(until, undefined, { timeout: timeoutMs })
  } catch (e) {
    throw new Error(
      `the planted failure never became observable within ${timeoutMs} ms, so the assertion that ` +
        `follows would have run against an unchanged page and passed. A control that cannot plant ` +
        `is a control that cannot fail.\n  ${e?.message ?? e}`,
    )
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-planted', 'yes'))
  await page.waitForSelector('[data-planted]', { state: 'attached', timeout: timeoutMs })
}

/**
 * Runs INSIDE the page. Every element that is standing in front of the product.
 *
 * GEOMETRIC, never a class name or a `modal` prop. Measured: a gate that counts opt-in modal markers
 * reports ZERO modals in a fully scrimmed, scroll-locked app, because modality is the DEFAULT on the
 * library's dialog roots. What cannot be dodged is the box.
 *
 * FOUR THINGS THIS GETS RIGHT THAT THE OBVIOUS VERSION DOES NOT:
 *
 *   `sticky` COUNTS. A sticky box is out of normal flow and paints over what follows it exactly as a
 *   fixed one does; leaving it out is a hole in the shape of the very positioning this app's header
 *   already uses.
 *
 *   THE TOP LAYER IS NOT REACHABLE BY GEOMETRY AT ALL. A modal `<dialog>`'s ::backdrop is not an
 *   element, and the dialog itself is usually a small centred box — so a fully scrimmed, click-
 *   blocked app measures as clean. `:modal` is the direct question, and it is the only one that gets
 *   a true answer here.
 *
 *   `opacity: 0` IS NOT A SCRIM. A full-viewport box that paints nothing and is fully transparent is
 *   invisible; flagging it is a false red that gets this check deleted.
 *
 *   IT NAMES WHAT IT FOUND, including which of the two reasons it was flagged for, because "1
 *   overlay" tells the reader nothing about where to look.
 */
export function scrimProbe() {
  const found = []
  const describe = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className ? `.${el.className}` : ''}`

  // The top layer, first: nothing below can see it.
  for (const el of document.querySelectorAll('dialog, [popover]')) {
    if (typeof el.matches === 'function' && el.matches(':modal')) {
      found.push(`${describe(el)} (modal, top layer — its backdrop covers everything)`)
    }
  }

  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el)
    if (!['fixed', 'absolute', 'sticky'].includes(style.position)) continue
    if (style.pointerEvents === 'none') continue
    if (style.display === 'none' || style.visibility === 'hidden') continue
    if (Number(style.opacity) === 0) continue
    const box = el.getBoundingClientRect()
    if (box.width >= window.innerWidth && box.height >= window.innerHeight) {
      found.push(`${describe(el)} (${style.position}, ${Math.round(box.width)}x${Math.round(box.height)})`)
    }
  }
  return found
}
