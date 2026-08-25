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
import { join, resolve } from 'node:path'
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

/**
 * Serves a built `dist/` and loads it in headless chromium.
 *
 * This is the step that makes "it builds" mean something. Note that `vite preview` reports
 * `command: 'serve'`, so the mainnet guard does NOT run here — preview will happily serve a stale
 * off-mainnet `dist/`. Preview is how we evaluate an artifact, never how we prove the guard fired.
 *
 * @returns {Promise<{errors: string[], consoleErrors: string[], published: unknown}>}
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
      // SETTLE BEFORE MOVING ON, and capture what rendered.
      //
      // `page.goto` resolves at `load`, which is BEFORE React commits and well before an error
      // boundary's `console.error` is emitted. Navigating straight to the next path threw that
      // evidence away: a route component that throws produced a page with "Something went wrong!"
      // in it and the gate still passed, because the only signal arrived after we had left.
      //
      // So: wait for the mount to put something on the page, then let a short beat pass so the
      // async console traffic for THIS route lands in the collectors above.
      //
      await page
        .waitForFunction(() => (document.body.textContent ?? '').trim().length > 0, undefined, {
          timeout: 10_000,
        })
        .catch(() => {})
      await page.waitForTimeout(250)
      rendered[path] = ((await page.textContent('body')) ?? '').trim()

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

  return { errors, consoleErrors, published, visited, rendered, probed }
}

/**
 * The route paths the app actually has, read out of the GENERATED tree.
 *
 * Hardcoding a list here would rot the moment a route is added, and a stale list means the new
 * route is the one route nothing ever loads — precisely the hole this closes. `routeTree.gen.ts` is
 * regenerated by every build and committed, so it is the one place that cannot drift.
 */
export function routePathsFromGeneratedTree(generatedTreePath) {
  const source = readFileSync(generatedTreePath, 'utf8')
  const line = source.match(/^\s*fullPaths:\s*(.+)$/m)?.[1]
  const paths = [...(line ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (!paths.length) {
    throw new Error(
      `could not read any route paths out of ${generatedTreePath}. Its \`fullPaths:\` line is how ` +
        `the evaluation knows what to visit; without it the check would silently shrink to '/'.`,
    )
  }
  return paths
}

/**
 * The shared "the artifact evaluates" assertion.
 *
 * A page error here is the whole point of the exercise: this is precisely what a missing SDK alias
 * looks like from the outside, and it is invisible to the bundler's exit code.
 */
export function assertEvaluatedClean({
  label,
  errors,
  consoleErrors,
  published,
  globalName,
  rendered = {},
}) {
  const problems = []

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

  if (problems.length) {
    throw new Error(`[build:web] the eager bundle broke its load-order rule:\n  - ${problems.join('\n  - ')}`)
  }
  console.log(
    `[build:web] eager bundle within budget — ${total.toLocaleString()} B of ` +
      `${APP_MAX_EAGER_BYTES.toLocaleString()} B, 0 SDK markers`,
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

  const { errors, consoleErrors, published, visited, rendered, probed } = await evaluate({
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
    rendered,
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
    `[build:web] evaluated clean on ${visited.length} route(s) [${visited.join(', ')}] — ` +
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
