//
// The wrapped web build, and the warning gate every build in this repository goes through.
//
// WHY A WRAPPER AT ALL. "`vite build` exited 0" is not evidence that the app works. Measured on
// this exact stack: with the privacy SDK's `/testing` alias missing, the build exits 0, reports
// `✓ 324 modules transformed`, writes a 684 kB bundle — and the page then dies at load with
// `ReferenceError: Buffer is not defined`. Every acceptance criterion phrased as "the build
// succeeds" passes on a dead page. So this script does two things the bundler will not do for us:
// it holds the build to an explicit warning contract, and it EVALUATES the artifact in a real
// browser before calling it green.
//
// Also usable as a library: `scripts/smoke-sdk-build.mjs` imports `buildGated`, `evaluate` and
// `classify` so the SDK smoke is held to the same contract as the app.
//
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, createLogger, preview } from 'vite'
import { chromium } from 'playwright-core'

import { designProbe, designProblems, expectedGrounds } from './assert-design-shipped.mjs'

export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..')
export const WEB_ROOT = join(REPO_ROOT, 'apps/web')

//
// The browser this gate needs, and the command that installs it.
//
// `playwright-core` ships NO browser binaries and declares no postinstall hook, so a fresh
// `git clone && npm ci` leaves this gate unable to run. Without the check below it fails deep
// inside Playwright with a stack about a missing executable, which reads like a broken repository
// rather than a one-line setup step. The command is repeated in README.md — this file is
// gitignored-adjacent tooling, and the only other place it was written down was `_bmad-output/`,
// which is gitignored, so a fresh clone could not find it anywhere.
//
const BROWSER_CHANNEL = 'chromium-headless-shell'
export const BROWSER_INSTALL_COMMAND = `npx playwright-core install ${BROWSER_CHANNEL}`

function missingBrowserMessage(label, detail) {
  return (
    `[${label}] the headless browser this gate evaluates in is not installed.\n\n` +
    `    ${BROWSER_INSTALL_COMMAND}\n\n` +
    `  \`playwright-core\` ships no browsers and runs no postinstall, so \`npm ci\` alone does not ` +
    `provide one. This gate refuses to pass without evaluating the bundle: a build that exits 0 ` +
    `and dies at load is exactly the failure it exists to catch.` +
    (detail ? `\n\n  Underlying error: ${detail}` : '')
  )
}

/** Playwright's browser cache, honouring the same override Playwright itself reads. */
function browsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (!home) return null
  if (process.platform === 'darwin') return join(home, 'Library/Caches/ms-playwright')
  if (process.platform === 'win32') return join(home, 'AppData/Local/ms-playwright')
  return join(home, '.cache/ms-playwright')
}

/**
 * Best-effort preflight, so the common failure reads as a setup step rather than a broken repo.
 *
 * Deliberately NOT `chromium.executablePath()`: that ignores the `channel` option entirely and
 * returns a path whether or not anything is there — on this machine it happily returned a
 * `chromium-1234` path for a binary that is not installed. A check that cannot fail is worse than
 * no check, so this probes the cache directory instead, and `launchBrowser()` below translates the
 * real launch failure regardless. The directory probe is the nice error; the launch wrap is the
 * guarantee.
 */
export function assertBrowserAvailable(label = 'evaluate') {
  const root = browsersPath()
  if (!root || !existsSync(root)) {
    throw new Error(missingBrowserMessage(label, `no Playwright browser cache at ${root ?? '(unknown)'}`))
  }
  const installed = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-'))
  if (!installed.length) {
    throw new Error(
      missingBrowserMessage(label, `${root} has no chromium_headless_shell-* directory`),
    )
  }
}

/** Launches the headless shell, translating a missing browser into the actionable message. */
async function launchBrowser(label) {
  try {
    return await chromium.launch({ channel: BROWSER_CHANNEL })
  } catch (e) {
    const text = String(e?.message ?? e)
    if (/executable doesn't exist|Executable doesn't exist|install/i.test(text)) {
      throw new Error(missingBrowserMessage(label, text.split('\n')[0]))
    }
    throw e
  }
}

//
// THE ALLOWLIST. Exactly one warning is permitted, and only this one.
//
// The privacy SDK's `dist/utils/logging.js` imports `async_hooks`; Vite externalizes it for the
// browser and says so. That is expected and harmless — the logger's async-context path is dead code
// in a browser.
//
// Three things about this regex are deliberate:
//   - The `[plugin …] ` prefix is OPTIONAL because the same warning arrives on two channels with
//     two different texts: `customLogger.warn` includes the prefix, `rolldownOptions.onwarn` does
//     not. Both are captured below; a one-channel wrapper misses half the traffic.
//   - The importer path is a REGEX, not a verbatim string. It is absolute and machine-specific, so
//     a literal path would pass here and fail on any other machine or in CI.
//   - The plugin id is `rolldown:vite-resolve`, not the pre-Vite-8 `vite:resolve`. An allowlist
//     written from pre-8 recall silently matches nothing and then rejects the build it should pass.
//
const ALLOWED_WARNING =
  /^(\[plugin rolldown:vite-resolve\] )?Module "async_hooks" has been externalized for browser compatibility, imported by ".*@starkware-libs\/starknet-privacy-sdk\/dist\/utils\/logging\.js"/

/** Bundle-size advice from `builtin:vite-reporter`. Rides the same warn channel; not a defect. */
const CHUNK_SIZE_WARNING = /Some chunks are larger than \d+ kB after minification/

/**
 * The one warning that must be FATAL rather than allowlisted.
 *
 * A namespace import (`import * as t from '…/testing'`) of a name that exists in `index.d.ts` but
 * NOT in the browser barrel builds green with only this warning and yields `undefined` at runtime.
 * `tsc` passes it too, because the types come from `index.d.ts`. A static NAMED import of the same
 * missing name hard-errors with `[MISSING_EXPORT]` and never reaches here — so this is the only
 * shape of that bug that can ship, and this line is the only thing standing in front of it.
 */
const IMPORT_IS_UNDEFINED = /\[IMPORT_IS_UNDEFINED\]/

/** Strip the channel-specific `[plugin <id>] ` prefix so the two channels compare equal. */
function normalize(message) {
  return String(message).replace(/^\[plugin [^\]]+\]\s*/, '').trim()
}

/** @returns {'allowlisted'|'size'|'import-undefined'|'unknown'} */
export function classify(message) {
  const text = String(message)
  if (IMPORT_IS_UNDEFINED.test(text)) return 'import-undefined'
  if (ALLOWED_WARNING.test(text) || ALLOWED_WARNING.test(normalize(text))) return 'allowlisted'
  if (CHUNK_SIZE_WARNING.test(text)) return 'size'
  return 'unknown'
}

class WarningGateError extends Error {}

/**
 * Runs a vite build with both warning channels captured, then holds the result to the contract.
 *
 * @param {object} o
 * @param {string} o.root                     project root passed to vite
 * @param {string|false} o.configFile         path to a config file, or false for none
 * @param {number} o.expectAllowlistedWarnings how many DISTINCT allowlisted warnings must appear
 * @param {object} [o.inlineConfig]           merged over the above
 * @param {string} [o.label]                  what to call this build in the log
 */
export async function buildGated({
  root,
  configFile,
  expectAllowlistedWarnings,
  inlineConfig = {},
  label = 'build',
}) {
  // Deduplicated by normalized text, on purpose. The same warning reaching us on both channels is
  // ONE warning. Two warnings with the same text but different importer paths are NOT one: that is
  // exactly how the duplicated-SDK failure presents (+266 kB raw / +76 kB gzip, from two
  // node_modules roots), and it must survive the dedupe to be caught by the count assertion.
  const seen = new Map()
  const record = (message) => {
    const key = normalize(message)
    if (!seen.has(key)) seen.set(key, String(message))
  }

  const base = createLogger('info', { allowClearScreen: false })
  const logger = {
    ...base,
    warn(msg, opts) {
      record(msg)
      base.warn(msg, opts)
    },
    warnOnce(msg, opts) {
      record(msg)
      base.warnOnce(msg, opts)
    },
  }

  await build({
    root,
    configFile,
    // Native ESM config loading. Without it Vite writes a `vite.config.ts.timestamp-*.mjs` into
    // node_modules on every build and reports guard failures against that temp file instead of
    // against `apps/web/vite.config.ts`, which makes a real failure unreadable.
    configLoader: 'native',
    logLevel: 'info',
    customLogger: logger,
    ...inlineConfig,
    build: {
      ...inlineConfig.build,
      rolldownOptions: {
        ...inlineConfig.build?.rolldownOptions,
        onwarn(warning, defaultHandler) {
          // `warning.code` is undefined on this channel — there is nothing to switch on, so the
          // message text is the only thing that can be classified.
          record(warning.message ?? warning)
          defaultHandler(warning)
        },
      },
    },
  })

  const buckets = { allowlisted: [], size: [], 'import-undefined': [], unknown: [] }
  for (const message of seen.values()) buckets[classify(message)].push(message)

  const problems = []

  if (buckets['import-undefined'].length) {
    problems.push(
      `${buckets['import-undefined'].length} [IMPORT_IS_UNDEFINED] warning(s). A namespace import ` +
        `is resolving to \`undefined\` at runtime — this builds green and fails in the browser:\n` +
        buckets['import-undefined'].map((m) => `    ${m}`).join('\n'),
    )
  }

  if (buckets.unknown.length) {
    problems.push(
      `${buckets.unknown.length} warning(s) that are not on the allowlist. Do NOT widen the ` +
        `allowlist to make this pass — find out what changed:\n` +
        buckets.unknown.map((m) => `    ${m}`).join('\n'),
    )
  }

  if (buckets.allowlisted.length !== expectAllowlistedWarnings) {
    // Both directions are real failures, with OPPOSITE causes — say which one this is rather than
    // printing a menu the reader has to guess from.
    const diagnosis =
      buckets.allowlisted.length > expectAllowlistedWarnings
        ? `The graph reaches the SDK's async_hooks logger more times than it should. Either a ` +
          `module that must not import the SDK now does — for the app build that is the eager ` +
          `load-order rule breaking, and the root chunk has just grown by the whole SDK graph — or ` +
          `the SDK has been duplicated across two node_modules roots, which adds ~266 kB raw / ` +
          `~76 kB gzip and shows up ONLY as this extra line (check resolve.dedupe).`
        : `The graph no longer reaches the SDK at all, so this build has stopped proving what it ` +
          `claims to. An import was probably dropped, renamed, or tree-shaken away.`
    problems.push(
      `expected exactly ${expectAllowlistedWarnings} allowlisted warning(s), got ` +
        `${buckets.allowlisted.length}. ${diagnosis}\n` +
        buckets.allowlisted.map((m) => `    ${m}`).join('\n'),
    )
  }

  // Chunk-size advice is REPORTED, never suppressed and never counted as allowlisted. It is a real
  // signal about a real 698 kB chunk, and route-level code splitting is 6-3's job, not this gate's.
  for (const message of buckets.size) {
    console.log(`[${label}] size advisory (non-fatal): ${normalize(message).split('\n')[0]}`)
  }

  if (problems.length) {
    throw new WarningGateError(`[${label}] warning gate failed:\n  - ${problems.join('\n  - ')}`)
  }

  console.log(
    `[${label}] warning gate clean — ${buckets.allowlisted.length} allowlisted, ` +
      `${buckets.size.length} size advisory, 0 unexpected.`,
  )
  return buckets
}

/** Every file under `dir`, recursively. */
export function walkFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    out.push(...(statSync(p).isDirectory() ? walkFiles(p) : [p]))
  }
  return out
}

/** How long a surface gets to attach its `data-route-id`. Deterministic: it resolves on the fact. */
const MARKER_TIMEOUT_MS = 5_000

//
// THE BEAT AFTER THE MARKER — READ THIS BEFORE DELETING IT.
//
// The old `waitForTimeout(250)` was doing TWO jobs, and only one of them was a race. Job one, waiting
// for the route to render, is now the deterministic marker wait above and that sleep is gone for
// good. Job two was this: letting the async console traffic for THIS route reach the collectors
// before we navigate away. Nothing about waiting for a marker does that, and dropping it was
// measured — a route that attaches its marker synchronously and then `console.error`s at t+150 ms
// gives `consoleErrors: []` without this line and the real message with it. That is a route which
// renders perfectly, logs a failure, and ships `[build:web] OK`.
//
// It is not what decides the marker verdict — that is already settled by the time this runs — so no
// gate here is a race against this number. It is a drain, not a wait.
//
const CONSOLE_SETTLE_MS = 250

/**
 * Serves a built `dist/` and loads it in headless chromium.
 *
 * This is the step that makes "it builds" mean something. Note that `vite preview` reports
 * `command: 'serve'`, so the mainnet guard does NOT run here — preview will happily serve a stale
 * off-mainnet `dist/`. Preview is how we evaluate an artifact, never how we prove the guard fired.
 *
 * @returns {Promise<{errors: string[], consoleErrors: string[], published: unknown,
 *   visited: string[], rendered: Record<string,string>, markers: Record<string,string|null>,
 *   probed: unknown}>}
 */
export async function evaluate({ root, outDir, globalName, paths = ['/'], label = 'evaluate', probe }) {
  if (!existsSync(outDir)) throw new Error(`[${label}] nothing to evaluate: ${outDir} does not exist`)
  assertBrowserAvailable(label)

  const server = await preview({
    root,
    configFile: false,
    logLevel: 'warn',
    build: { outDir },
    preview: { host: '127.0.0.1', open: false },
  })

  const url = server.resolvedUrls?.local?.[0]
  if (!url) {
    await server.close()
    throw new Error(`[${label}] vite preview did not report a local URL`)
  }

  const browser = await launchBrowser(label)
  const errors = []
  const consoleErrors = []
  const visited = []
  const rendered = {}
  const markers = {}
  let published
  let probed
  try {
    //
    // EVERY ROUTE, not just `/`. Loading only the index is a hole with teeth: making the `/settings`
    // component throw passed the whole gate set, because nothing ever navigated there — the
    // approved `dist/` rendered "Something went wrong!" on a route no gate had opened. This gets
    // worse, not better, once most surfaces are lazily loaded and each one is its own chunk that
    // only a real navigation pulls down.
    //
    // The pageerror and console collectors are attached ONCE, to the page, so a failure on any
    // route lands in the same buckets the caller already asserts on.
    //
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    for (const path of paths) {
      const target = new URL(path.replace(/^\//, ''), url).href
      const response = await page.goto(target, { waitUntil: 'load', timeout: 30_000 })
      if (!response || !response.ok()) {
        throw new Error(
          `[${label}] ${target} returned ${response ? response.status() : 'no response'}`,
        )
      }
      visited.push(path)

      //
      // WAIT FOR THE SURFACE TO IDENTIFY ITSELF, then let its console traffic land, then read.
      //
      // `page.goto` resolves at `load`, which is BEFORE React commits and well before an error
      // boundary's `console.error` is emitted. Navigating straight to the next path threw that
      // evidence away: a route component that throws produced a page with an error boundary in it
      // and the gate still passed, because the only signal arrived after we had left.
      //
      // What stood here was `waitForTimeout(250)`, and as a wait for the MARKER it was a race:
      // measured on one identical artifact whose error UI arrives in a lazily-loaded chunk,
      // changing only that number 250 -> 2000 flipped the build from exit 0 to exit 1. A longer
      // sleep is the same bug with a bigger number, so the marker is waited for as a fact.
      //
      // `state: 'attached'`, deliberately, is not the default `visible`: an empty surface has zero
      // height, so `visible` never resolves and would report "no marker" with the marker sitting
      // verbatim in the DOM. A TIMEOUT is swallowed (an absent marker is a verdict this gate
      // reports, not a crash) but nothing else is — a destroyed context or a crashed page is
      // infrastructure failing, and diagnosing that as "this route rendered no marker" sends the
      // reader to the wrong file. The two reads below throw for the same reason.
      //
      let attached = true
      try {
        await page.waitForSelector('[data-route-id]', {
          timeout: MARKER_TIMEOUT_MS,
          state: 'attached',
        })
      } catch (e) {
        if (e?.name !== 'TimeoutError') throw e
        attached = false
      }

      await page.waitForTimeout(CONSOLE_SETTLE_MS)

      //
      // EVERY marker, and each surface's OWN text.
      //
      // Every marker, because `querySelector` takes the first in document order and says nothing
      // about the second: a layout that renders a marker around a leaf that renders its own would
      // silently decide the verdict by nesting order. Two markers is a defect, and one this can see.
      //
      // Own text, because emptiness has to be measured against the SURFACE. The app's root renders
      // persistent chrome, so `body.textContent` is never empty here and an emptiness check against
      // it can never fire — a route rendering `<main data-route-id="/status" />` and nothing else
      // would pass while showing the user a blank screen. The body is the fallback only when no
      // marker exists at all, which is the case where the router's default boundary has replaced
      // the whole document and its text is the evidence.
      //
      const surfaces = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-route-id]'), (el) => ({
          id: el.getAttribute('data-route-id'),
          text: (el.textContent ?? '').trim(),
        })),
      )
      markers[path] = surfaces.map((s) => s.id)
      rendered[path] = surfaces.length
        ? surfaces.map((s) => s.text).join('')
        : ((await page.textContent('body')) ?? '').trim()

      // Says which absence this is. "Nothing ever attached" and "it attached and then went away"
      // read identically in the verdict below, and they are different bugs.
      if (!attached) {
        console.log(
          `[${label}] ${path}: no [data-route-id] attached within ${MARKER_TIMEOUT_MS} ms` +
            (surfaces.length ? ` — ${surfaces.length} present at read time, so it arrived late` : ''),
        )
      }

      // The module graph evaluates after `load`; give the published global a moment to appear
      // rather than racing it, and report an absence as an absence rather than as a timeout. Read
      // on the FIRST path only — later navigations re-publish the same value.
      if (published === undefined) {
        published = await page
          .waitForFunction((name) => Boolean(window[name]), globalName, { timeout: 10_000 })
          .then(() => page.evaluate((name) => window[name], globalName))
          .catch(() => undefined)
      }

      // Read what the browser COMPUTED, on the first route only. `waitUntil: 'load'` has already
      // fired, so a linked stylesheet is applied by now; an absent one is absent for good.
      if (probe && probed === undefined) {
        probed = await page.evaluate(probe).catch(() => undefined)
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  return { errors, consoleErrors, published, visited, rendered, markers, probed }
}

//
// ---- what the evaluation is allowed to believe about the route list -----------------------------
//
// The route files that do NOT produce a `fullPath` of their own, read out of the generator this
// repository actually runs (`@tanstack/router-generator/dist/esm/filesystem/physical/
// getRouteNodes.js`, `getRouteMeta` :182 and `isValidPathlessLayoutRoute` :215), not out of recall.
//
//   - a leading `-` is `routeFileIgnorePrefix` (config.js:23, defaulted) and a leading `.` is a
//     dotfile: the generator drops BOTH, for files and directories alike, before it reads anything;
//   - a last segment starting with `_` is a pathless layout — `_shell.tsx` contributes NO path, and
//     `__root.tsx` is the root. `_shell.wallet.tsx` is NOT one of these: its last segment is
//     `wallet`, and it does own `/wallet`;
//   - `route.tsx` is the layout token: it names the directory's own path, which `index.tsx` in the
//     same directory also names, so counting both would count one path twice;
//   - the split-file suffixes carry no path — they attach to a route declared elsewhere;
//   - a `(group)` segment, in a directory name or a flat filename, erases a path SEGMENT rather
//     than the route. That is exactly why it is skipped: `(app)/index.tsx` and `index.tsx` both
//     resolve to `/`, the generated union carries `/` once, and counting two files against one path
//     is a FALSE RED on a healthy tree. Telling which group files collide would mean
//     re-implementing the generator's path derivation, so they are not counted at all.
//
// Directories named `_shell/` ARE recursed: the layout is pathless, its children are not, and 6-3
// puts most of the app under one — skipping them would empty the floor exactly where it matters.
//
// The extension set is the generator's own (`getRouteNodes.js:73`), minus `.vue`, which this repo
// has no way to render.
//
const ROUTE_FILE_IGNORED_PREFIXES = ['-', '.']
const ROUTE_FILE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js']
const ROUTE_FILE_NON_PATH_SUFFIXES = [
  'lazy',
  'loader',
  'component',
  'pendingComponent',
  'errorComponent',
  'notFoundComponent',
]

/**
 * Every route file under `routesDir` that owns a `fullPath` — the floor the extraction is held to.
 *
 * A deliberate FLOOR, not an equality: every rule above errs towards not counting, so this number
 * can only ever be at or below the real route count. That direction is the whole design. An
 * over-count fails a healthy tree and gets the check deleted by the next person in a hurry; an
 * under-count only softens it. What it must never do is what the prescribed form did — miss
 * `wallet/receive.tsx` entirely because `readdirSync` does not recurse, while counting `_shell.tsx`
 * which owns no path, so that in a mixed tree the two errors cancel and the check reports green.
 *
 * Two files may never map to one path here, which is the invariant every rule above serves.
 */
export function routeLeafFiles(routesDir) {
  if (!existsSync(routesDir)) {
    throw new Error(
      `cannot cross-check the extracted route paths: ${routesDir} does not exist. This check is ` +
        `what stands between a silently-shrunk route list and a throwing surface shipping green, ` +
        `so it refuses rather than skipping — pass the right \`routesDir\`.`,
    )
  }
  const found = []
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name
      if (ROUTE_FILE_IGNORED_PREFIXES.some((p) => name.startsWith(p))) continue
      const rel = prefix ? `${prefix}/${name}` : name
      if (entry.isDirectory()) {
        if (name.startsWith('(')) continue
        walk(join(dir, name), rel)
        continue
      }
      const ext = ROUTE_FILE_EXTENSIONS.find((e) => name.endsWith(e))
      if (!ext) continue
      const segments = name.slice(0, -ext.length).split('.')
      const last = segments[segments.length - 1] ?? ''
      if (segments.some((s) => s.startsWith('('))) continue
      if (last.startsWith('_')) continue
      if (last === 'route') continue
      if (ROUTE_FILE_NON_PATH_SUFFIXES.includes(last)) continue
      found.push(rel)
    }
  }
  walk(routesDir, '')
  return found
}

/**
 * The route paths the app actually has, read out of the GENERATED tree.
 *
 * Hardcoding a list here would rot the moment a route is added, and a stale list means the new
 * route is the one route nothing ever loads — precisely the hole this closes. `routeTree.gen.ts` is
 * regenerated by every build and committed, so it is the one place that cannot drift.
 *
 * TWO THINGS THIS READS THAT THE PREVIOUS VERSION DID NOT.
 *
 * It reads the `fullPaths:` BLOCK, not the `fullPaths:` line. The generator emits the union on one
 * line while it is short and prettifies it across lines once it is not — measured, that happens
 * around 13 routes, which is the size the app's real route tree is about to become. Against the
 * prettified form a single-line regex captures the first line only, the union collapses to `'/'`,
 * and the gate goes on reporting that it evaluated every route while evaluating exactly one. A
 * `/markets` that throws unconditionally shipped `[build:web] OK` that way.
 *
 * And it CROSS-CHECKS the result against the route files on disk. Extraction returning too few
 * paths is not a cosmetic failure — it is the failure above, and it is invisible from the output,
 * because a shrunken list still reads as "evaluated clean on N route(s)". So the number is checked
 * against something the regex cannot influence, and a shortfall throws BEFORE anything is
 * evaluated. It exits 1 or it is decoration: a warning here would be read past.
 *
 * `routesDir` defaults to the `routes/` directory beside the generated tree, which is where the
 * plugin puts it. The default is load-bearing rather than a convenience: `smoke-sdk-build.mjs`
 * calls this with one argument, and a required second parameter would turn that call into
 * `readdirSync(undefined)`.
 */
export function routePathsFromGeneratedTree(
  generatedTreePath,
  routesDir = join(dirname(generatedTreePath), 'routes'),
) {
  const source = readFileSync(generatedTreePath, 'utf8')
  const start = source.search(/^[ \t]*fullPaths:/m)
  if (start < 0) {
    throw new Error(
      `could not find a \`fullPaths:\` declaration in ${generatedTreePath}. That block is how the ` +
        `evaluation knows what to visit; without it the check would silently shrink to '/'.`,
    )
  }
  //
  // The block runs from `fullPaths:` to the next interface member or the interface's closing brace.
  // Every line inside it begins with `|` or a quote, so neither terminator can occur within it —
  // which is why a delimited regex is the right shape here and a TypeScript parser is not. The
  // defect this replaces was the delimiting, never the regex.
  //
  const rest = source.slice(start)
  const end = rest.search(/\n[ \t]*(?:[A-Za-z_$][\w$]*\s*:|\})/)
  const block = end < 0 ? rest : rest.slice(0, end)
  const paths = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])

  if (!paths.length) {
    throw new Error(
      `could not read any route paths out of ${generatedTreePath}. Its \`fullPaths:\` block is how ` +
        `the evaluation knows what to visit; without it the check would silently shrink to '/'.`,
    )
  }

  const leaves = routeLeafFiles(routesDir)
  if (paths.length < leaves.length) {
    throw new Error(
      `route-path extraction returned ${paths.length} path(s) [${paths.join(', ')}] but ` +
        `${routesDir} holds at least ${leaves.length} route file(s) that own a path ` +
        `[${leaves.join(', ')}]. The evaluation is about to visit fewer routes than exist, which ` +
        `is how a throwing surface ships green. Fix the extraction — do not lower this floor.`,
    )
  }
  return paths
}

//
// ---- the route-identity marker ------------------------------------------------------------------
//
// Every surface renders `data-route-id` naming the route it IS, and `__error__`, `__not_found__`
// and any later `__…` fallback are RESERVED: no route may ever emit one as its own id. That rule is
// the whole mechanism, and it was learned the expensive way — an error component wearing
// `routeId="/markets"` made a surface that throws on every single render pass the crawler with
// `failures: []`. Its identity was true and its state was broken, and the marker as originally
// prescribed could not tell those apart.
//
// The PREFIX is what is enforced, not a list of names: a pending or not-found fallback added later
// inherits the rule by being named `__…` and needs no edit here. It is deliberately not a shared
// constant either — this file imports Playwright, so no app module can import from it, and a
// vocabulary that must be re-typed in the app is better re-typed against a rule than against a
// name that looks shared and is not.
//
// THE VALUE IS THE ROUTE'S `fullPath`, NOT ITS `Route.id`. The attribute is named `data-route-id`
// and the id is the wrong one: for `_shell.wallet.tsx` the id is `/_shell/wallet` while the
// fullPath is `/wallet`. This gate visits the paths out of the generated `fullPaths:` union and
// compares against exactly those, so a surface that emits its id gets a red build on a route that
// is perfectly healthy. Emit what the URL says.
//
const RESERVED_MARKER_PREFIX = '__'

//
// Routes whose marker is legitimately a DIFFERENT path than the one requested, because the router
// redirects before anything renders. An explicit map, never a prefix or "starts with" rule: the
// point of the marker is that the gate knows which surface it is looking at, and a fuzzy match
// hands that back.
//
// `/` is not a surface: it throws `redirect({ to: '/wallet' })` from `beforeLoad` and renders
// nothing of its own, so the marker the gate reads at `/` is `/wallet`'s. DECLARING it is what keeps
// that from being a shrug — a `/` that stops redirecting now renders `/` and fails the build,
// instead of quietly becoming a blank page nobody visits on purpose.
//
// This is the module default and BOTH gates inherit it: `main()` below and `smoke-sdk-build.mjs`
// both call `assertEvaluatedClean` without the parameter.
//
// FROZEN because it is a shared default reached through a parameter default, not through an import
// each caller owns. A test that mutated it — to describe a tree without the redirect, say — would
// silently reconfigure `main()` and `smoke:sdk` for the rest of the process, and the gate would go
// on reporting whatever the last mutation asked for.
export const EXPECTED_REDIRECTS = Object.freeze({ '/': '/wallet' })

/** `evaluate()` hands back `string[]` per route; tolerate the one-marker and absent spellings. */
function markerList(value) {
  if (Array.isArray(value)) return value
  return value === null || value === undefined ? [] : [value]
}

/**
 * The shared "the artifact evaluates" assertion.
 *
 * A page error here is the whole point of the exercise: this is precisely what a missing SDK alias
 * looks like from the outside, and it is invisible to the bundler's exit code.
 *
 * @param {object} o
 * @param {string} o.label                          what to call this gate in the failure
 * @param {string[]} o.errors                       uncaught page errors from evaluate()
 * @param {string[]} o.consoleErrors                console errors from evaluate()
 * @param {unknown} o.published                     the value the bundle published, or undefined
 * @param {string} o.globalName                     the global it was supposed to publish
 * @param {string[]} o.visited                      REQUIRED. The routes evaluate() actually
 *   visited, and the list every check below is driven from — see the guard.
 * @param {Record<string,string>} [o.rendered]      each route's own rendered text
 * @param {Record<string,string[]>} [o.markers]     each route's `data-route-id` values
 * @param {Record<string,string>} [o.expectedRedirects] routes whose marker is legitimately another
 *   route's path
 */
export function assertEvaluatedClean({
  label,
  errors,
  consoleErrors,
  published,
  globalName,
  visited,
  rendered = {},
  markers = {},
  expectedRedirects = EXPECTED_REDIRECTS,
}) {
  //
  // `visited` is REQUIRED, and it is required because it is the only argument here with no empty
  // default. Everything else defaults to `{}`, so a caller that threads nothing at all would walk
  // every loop below zero times and be told the artifact is clean — the silent skip this assertion
  // exists to close, moved up one level. `evaluate()` always returns `visited`; a caller that
  // cannot produce it did not evaluate anything.
  //
  if (!Array.isArray(visited)) {
    throw new Error(
      `[${label}] assertEvaluatedClean was called without \`visited\`. It is the list of routes ` +
        `that were actually loaded, and without it this function cannot tell "every route passed" ` +
        `apart from "no route was checked" — so it refuses to answer rather than answer wrongly.`,
    )
  }

  const problems = []

  //
  // WHICH SURFACE ACTUALLY RENDERED — asserted as a fact the page publishes, not inferred from copy.
  //
  // This loop runs BEFORE the text loop below because it is the only one of the two that survives
  // 6-3. The text check greps the router's DEFAULT error boundary string, and that string stops
  // existing the moment a route carries its own `errorComponent` — which is a 6-3 acceptance
  // criterion, not a hypothetical. Measured on exactly that artifact: "Something went wrong!"
  // occurred zero times, the text loop passed, and the surface threw on every render.
  //
  // Unconditional, deliberately. A marker assertion that only runs when markers happen to be
  // present is a gate that has never once been red, and it would arrive in 6-3 untested.
  //
  const unverified = visited.filter((path) => !(path in markers))
  if (unverified.length) {
    problems.push(
      `${unverified.length} of ${visited.length} evaluated route(s) reached this assertion with no ` +
        `marker verdict at all (${unverified.join(', ')}). \`markers\` was not threaded from ` +
        `evaluate(), so the route-identity check did not run — which is indistinguishable, from ` +
        `the outside, from it having passed.`,
    )
  }

  for (const path of visited) {
    if (!(path in markers)) continue // already reported, once, above
    const ids = markerList(markers[path])
    const expected = expectedRedirects[path] ?? path

    if (ids.length > 1) {
      problems.push(
        `route ${path} rendered ${ids.length} [data-route-id] markers ` +
          `(${ids.map((id) => `'${id}'`).join(', ')}) — more than one element on the page claims ` +
          `to be the route. Which one a reader believes comes down to document order, so the ` +
          `identity is not a fact here: exactly one surface per route may carry the marker.`,
      )
      continue
    }

    const marker = ids[0]
    if (marker === undefined || marker === null) {
      problems.push(
        `route ${path} rendered no [data-route-id] marker. Either nothing mounted there, or the ` +
          `surface does not identify itself — and an unidentified surface is one this gate cannot ` +
          `tell apart from a fallback.`,
      )
    } else if (!marker.trim()) {
      problems.push(
        `route ${path} rendered a [data-route-id] with an empty value (${JSON.stringify(marker)}). ` +
          `The element is there and the identity is not — most likely the value came from a ` +
          `variable that was undefined at render time.`,
      )
    } else if (marker.trim().startsWith(RESERVED_MARKER_PREFIX)) {
      problems.push(
        `route ${path} rendered '${marker}' — a fallback, not itself. A component on that route ` +
          `threw or failed to resolve, and its own error UI caught it, so no page error and no ` +
          `default boundary text exists anywhere for this gate to notice.`,
      )
    } else if (marker.trim() !== expected) {
      problems.push(
        `route ${path} rendered '${marker}' — a DIFFERENT route's surface (expected ` +
          `'${expected}'). The router resolved somewhere other than where it was asked to, or the ` +
          `surface emitted its Route.id where its fullPath belongs.`,
      )
    }
  }

  //
  // A route that rendered NOTHING, or rendered an error boundary, is a broken route — and neither
  // shape produces an uncaught page error. TanStack Router catches a throwing component and renders
  // its default error component, so the only other trace is a `console.error` that arrives after
  // navigation; both signals are checked, because relying on console timing alone is fragile.
  //
  for (const [path, text] of Object.entries(rendered)) {
    if (!text) {
      problems.push(`route ${path} rendered an empty document — nothing mounted there`)
    } else if (/Something went wrong!/.test(text)) {
      problems.push(
        `route ${path} rendered the router's error boundary ("Something went wrong!"). A component ` +
          `on that route threw; the boundary swallowed it, so nothing else in this gate would see ` +
          `it. Rendered: ${JSON.stringify(text.slice(0, 120))}`,
      )
    }
  }
  if (errors.length) {
    problems.push(`${errors.length} uncaught page error(s):\n${errors.map((e) => `    ${e}`).join('\n')}`)
  }
  if (consoleErrors.length) {
    problems.push(
      `${consoleErrors.length} console error(s):\n${consoleErrors.map((e) => `    ${e}`).join('\n')}`,
    )
  }
  if (published === undefined) {
    problems.push(
      `the bundle never published \`window.${globalName}\`. Either the entry did not evaluate, or ` +
        `the value it publishes was tree-shaken — in both cases nothing downstream can be asserted.`,
    )
  }
  if (problems.length) {
    throw new Error(`[${label}] the built bundle does not evaluate:\n  - ${problems.join('\n  - ')}`)
  }
}

/**
 * The one-line "what did each route turn out to be" summary, shared by both gates that print it.
 *
 * Shared rather than copied because it was copied once already and the two copies were one edit
 * from disagreeing about what the gate had proved. It says "identified as" rather than "each
 * rendering its own marker": under a declared redirect a route legitimately renders another
 * route's surface, and a summary that claims otherwise is wrong on exactly the case worth reading.
 */
export function evaluationSummary(visited, markers = {}) {
  const each = visited.map((path) => {
    const ids = markerList(markers[path])
    return `${path}=${ids.length ? ids.join('+') : '(none)'}`
  })
  return `${visited.length} route(s), identified as [${each.join(', ')}]`
}

//
// ---- the app's load-order rule, checked DIRECTLY ------------------------------------------------
//
// The warning count alone is a PROXY: it only fires because the SDK's logger happens to import
// `async_hooks`. Any future eager path into the SDK that does not touch that logger would put the
// whole graph in the root chunk with the gate still green. So the artifact is checked too.
//
// Both numbers are measured, not guessed — clean app build vs the same build with one eager
// `@strk20/protocol/send` import:
//     total dist JS   270,104 B  ->  540,778 B
//     "poseidon"              0  ->        13
// `starknet` is NOT usable as a marker: it reads 3 in the clean build, from the RPC hostnames in
// `constants.ts`. `poseidon` is a crypto primitive nothing but the SDK/starknet graph pulls in.
//
const APP_FORBIDDEN_IN_CHUNK = ['poseidon']

//
// A tripwire, not a target. 270 kB today; 400 kB leaves room for 6-2's surfaces while still
// catching a ~700 kB SDK graph landing in the eager chunk. When a legitimate change crosses it,
// raise it DELIBERATELY and say why in the commit — that conversation is the point of the number.
//
const APP_MAX_EAGER_BYTES = 400_000

//
// ---- the cold-open surface has to be IN the entry ----------------------------------------------
//
// A HOLE THE BUDGET GATE CANNOT SEE, BY CONSTRUCTION. `assertAppChunkStaysLean` sums every emitted
// `.js`, which is the right shape for "did the SDK land in the bundle" and exactly the wrong shape
// for "is `/wallet` eager": moving a surface out of the entry and into its own chunk moves bytes
// between files and changes the total by a rounding error. Delete `codeSplitGroupings: []` from
// `routes/wallet.tsx` and the cold open silently becomes a second round trip while `build:web`,
// `smoke:sdk` and the whole suite stay green.
//
// `/wallet` is where `/` redirects, so it is on the critical path of every first visit.
//
const APP_EAGER_ROUTES = ['wallet']

//
// The anti-vacuity floor, and the reason this check is not one assumption deep.
//
// It reads chunk FILENAMES, which means it rests on the bundler naming a route's chunk after the
// route's module. That is true of the pinned bundler and observed on every split route here — but if
// it ever stops being true, "no chunk is named wallet" becomes true for the wrong reason and the
// check passes on a split cold open. So the split routes are counted too: when the convention holds,
// there are eight of them, and if that number collapses this gate says it has gone blind instead of
// saying everything is fine.
//
const MIN_SPLIT_ROUTE_CHUNKS = 3

/** `routes/activity.$id.tsx` -> `activity._id`, which is what the bundler names its chunk. */
function routeChunkBase(routeFile) {
  const name = routeFile.split('/').pop() ?? routeFile
  return name.replace(/\.[jt]sx?$/, '').replace(/\$/g, '_')
}

/** The `<script type="module">` `dist/index.html` loads: the eager entry, named by the artifact. */
export function entryChunkFromHtml(html) {
  const src = html.match(/<script[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/)?.[1]
  if (!src) {
    throw new Error(
      'dist/index.html declares no `<script type="module" src=…>`, so which chunk is the eager ' +
        'entry is not a fact this gate can read. It refuses rather than guessing — every check ' +
        'below is about what is IN that chunk.',
    )
  }
  return basename(src)
}

/**
 * PURE. The verdict on which surfaces are eager, over filenames alone.
 *
 * @param {object} o
 * @param {string[]} o.jsFiles     every emitted `.js`, any path shape
 * @param {string} o.entryFile     the entry chunk's basename
 * @param {string[]} o.routeFiles  route files that own a path, as `routeLeafFiles()` returns them
 * @returns {string[]} problems, empty when the eager set is what it should be
 */
export function eagerRouteProblems({
  jsFiles,
  entryFile,
  routeFiles,
  eagerRoutes = APP_EAGER_ROUTES,
  minSplitChunks = MIN_SPLIT_ROUTE_CHUNKS,
}) {
  const problems = []
  const chunks = jsFiles.map((f) => basename(f)).filter((f) => f !== entryFile)
  const bases = chunks.map((f) => f.replace(/\.js$/, ''))
  const chunkFor = (base) => bases.find((b) => b === base || b.startsWith(`${base}-`))

  const routeBases = routeFiles.map(routeChunkBase)
  for (const eager of eagerRoutes) {
    if (!routeBases.includes(eager)) {
      problems.push(
        `'${eager}' is required to be eager but no route file produces it. Either the route was ` +
          `renamed and this list was not, or the cold-open surface no longer exists — and an ` +
          `eager-route rule about a route that is gone is a check that has stopped checking.`,
      )
      continue
    }
    const chunk = chunkFor(eager)
    if (chunk) {
      problems.push(
        `the '${eager}' route was emitted as its own chunk (${chunk}.js) instead of staying in the ` +
          `entry. \`/\` redirects there, so every first visit now pays a second round trip before ` +
          `anything paints. Restore \`codeSplitGroupings: []\` on that route — the byte budget ` +
          `cannot see this, because splitting moves bytes between files rather than adding them.`,
      )
    }
  }

  const split = routeBases.filter((b) => !eagerRoutes.includes(b) && chunkFor(b))
  if (split.length < minSplitChunks) {
    problems.push(
      `only ${split.length} route(s) were found as their own chunk (expected at least ` +
        `${minSplitChunks}). This gate identifies a route's chunk by its filename, so a bundler ` +
        `that has stopped naming chunks after route modules makes the eager-route check above pass ` +
        `for the wrong reason. It reports that it has gone blind rather than reporting success.`,
    )
  }

  return problems
}

function assertAppChunkStaysLean(outDir) {
  const emitted = walkFiles(outDir).filter((f) => f.endsWith('.js'))
  if (!emitted.length) throw new Error('[build:web] the build emitted no JavaScript at all')

  const problems = []
  const total = emitted.reduce((n, f) => n + statSync(f).size, 0)
  if (total > APP_MAX_EAGER_BYTES) {
    problems.push(
      `the app's JavaScript is ${total.toLocaleString()} B, over the ${APP_MAX_EAGER_BYTES.toLocaleString()} B ` +
        `eager budget. Something large became eager — most likely an SDK import reaching the root ` +
        `chunk. Raise the budget only as a deliberate, explained decision.`,
    )
  }

  for (const file of emitted) {
    const source = readFileSync(file, 'utf8')
    for (const name of APP_FORBIDDEN_IN_CHUNK) {
      const count = source.split(name).length - 1
      if (count) {
        problems.push(
          `${file.slice(REPO_ROOT.length + 1)} contains ${count}× "${name}" — the privacy SDK / ` +
            `starknet crypto graph is in the app's eager bundle. \`src/main.tsx\` may import only ` +
            `\`@strk20/protocol/constants\`; the SDK belongs behind a lazy boundary.`,
        )
      }
    }
  }

  // Which surfaces are eager, which the byte total above is structurally unable to answer.
  const entryFile = entryChunkFromHtml(readFileSync(join(outDir, 'index.html'), 'utf8'))
  const routeFiles = routeLeafFiles(join(WEB_ROOT, 'src/routes'))
  problems.push(...eagerRouteProblems({ jsFiles: emitted, entryFile, routeFiles }))

  if (problems.length) {
    throw new Error(`[build:web] the eager bundle broke its load-order rule:\n  - ${problems.join('\n  - ')}`)
  }
  console.log(
    `[build:web] eager bundle within budget — ${total.toLocaleString()} B of ` +
      `${APP_MAX_EAGER_BYTES.toLocaleString()} B, 0 SDK markers, ` +
      `${APP_EAGER_ROUTES.join(' + ')} in the entry chunk`,
  )
}

async function main() {
  const outDir = join(WEB_ROOT, 'dist')

  await buildGated({
    root: WEB_ROOT,
    configFile: join(WEB_ROOT, 'vite.config.ts'),
    //
    // ZERO, and that is the correct number — not a relaxation.
    //
    // `src/main.tsx` imports only `@strk20/protocol/constants`, which has no SDK edge, so the app
    // graph never reaches the SDK's `async_hooks` logger and there is nothing to allowlist. If this
    // build ever DOES emit that warning, the app has started eagerly importing the SDK and the
    // ~700 kB graph has landed in the root chunk — so a nonzero count here is a real regression on
    // the load-order rule, and the gate will say so rather than shrug.
    //
    // The combined graph's warning contract lives in `smoke:sdk`, which expects exactly 1.
    //
    expectAllowlistedWarnings: 0,
    label: 'build:web',
  })

  assertAppChunkStaysLean(outDir)

  // Every route the generated tree declares, not just `/`. A component that throws on a route
  // nothing visits passes every other gate in this file.
  const paths = routePathsFromGeneratedTree(join(WEB_ROOT, 'src/routeTree.gen.ts'))

  const { errors, consoleErrors, published, visited, rendered, markers, probed } = await evaluate({
    root: WEB_ROOT,
    outDir,
    globalName: '__PASSBOOK__',
    paths,
    label: 'build:web',
    probe: designProbe,
  })

  assertEvaluatedClean({
    label: 'build:web',
    errors,
    consoleErrors,
    published,
    globalName: '__PASSBOOK__',
    visited,
    rendered,
    markers,
  })

  //
  // The artifact-level network assertion. NOT a grep for the mainnet chain id: `constants.ts` holds
  // both chain ids inside one `as const satisfies` literal that `NET` indexes at runtime, so the
  // bundler retains both strings whichever network is active and the grep would pass either way.
  // Reading what the evaluated bundle actually resolved to is the check that cannot be fooled.
  //
  if (published.network !== 'mainnet') {
    throw new Error(
      `[build:web] the evaluated bundle reports network=${JSON.stringify(published.network)}, not ` +
        `'mainnet'. The artifact is off-mainnet even though the build was permitted (AD-8).`,
    )
  }

  console.log(
    `[build:web] evaluated clean on ${evaluationSummary(visited, markers)} — ` +
      `window.__PASSBOOK__ = ${JSON.stringify(published)}`,
  )

  //
  // THE DESIGN SYSTEM IS IN THE ARTIFACT AND PAINTS. Every other gate above passes with the
  // stylesheet import deleted and no CSS in `dist/` at all — see assert-design-shipped.mjs.
  //
  const cssAssets = walkFiles(outDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => f.slice(REPO_ROOT.length + 1))
  const designFailures = designProblems({
    cssAssets,
    probed,
    expected: expectedGrounds(join(WEB_ROOT, 'design/tokens.yaml')),
  })
  if (designFailures.length) {
    throw new Error(`[build:web] the design system did not ship:\n  - ${designFailures.join('\n  - ')}`)
  }
  console.log(
    `[build:web] design system shipped — ${cssAssets.length} stylesheet(s), body paints ` +
      `${probed.light.background} light / ${probed.dark.background} dark, color-scheme flips, ` +
      `shadows re-theme`,
  )

  console.log('[build:web] OK')
}

//
// REALPATH BOTH SIDES. `resolve(process.argv[1])` does not follow symlinks, so with the repository
// reached through a symlinked path — a worktree, a `/tmp` checkout on macOS where `/tmp` is itself
// a symlink, or a CI cache mount — this comparison silently fails and `npm run build:web` EXITS 0
// having built nothing, evaluated nothing and asserted nothing. Silent success is the worst failure
// mode a gate can have, so the comparison is made on canonical paths.
//
const entrypoint = process.argv[1] ? realpathSync(resolve(process.argv[1])) : null
if (entrypoint && entrypoint === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e instanceof WarningGateError ? e.message : e)
    process.exit(1)
  })
}
