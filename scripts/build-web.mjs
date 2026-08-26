//
// The wrapped web build, and the warning gate every build in this repository goes through.
//
// WHY A WRAPPER AT ALL. "`vite build` exited 0" is not evidence that the app works. Measured on
// this exact stack: with the privacy SDK's `/testing` alias missing, the build exits 0, reports
// `✓ 324 modules transformed`, writes a 684 kB bundle — and the page then dies at load with
// `ReferenceError: Buffer is not defined`. Every acceptance criterion phrased as "the build
// succeeds" passes on a dead page. So this script holds the build to an explicit warning contract
// and then READS THE ARTIFACT it produced.
//
// NO BROWSER (changed 2026-08-26, Abu's ruling). This gate used to serve `dist/` and load every
// route in headless chromium. That bought real information at a real price: a 130 MB binary that
// `npm ci` does not install, a gate that dies with a Playwright stack on any fresh clone, and a
// habit of reaching for a browser to discover things that are written down in the output. Each
// browser assertion was replaced by reading what it was inspecting:
//
//     page dies at load with `Buffer is not defined`  ->  scan the emitted chunks for the node-only
//                                                         module names that put it there
//     route list silently shrank                      ->  `routePathsFromGeneratedTree` already
//                                                         cross-checks the generated union against
//                                                         the route files on disk, and throws
//     bundle resolved to the wrong network            ->  `vite.config.ts` throws at config
//                                                         EVALUATION, before a byte is written, and
//                                                         `verify-mainnet-guard.mjs` proves that
//                                                         guard fires in both directions
//     design system absent / un-themed                ->  read the emitted stylesheet; see
//                                                         `assert-design-shipped.mjs`
//
// What genuinely left with the browser: noticing a component that THROWS at render. That is not
// silent and not invisible — it is the first thing anyone opening the page sees, and Abu tests the
// surfaces himself.
//
//
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build, createLogger } from 'vite'

import {
  designProblems,
  expectedGrounds,
  readDesign,
  reservedHeightProblems,
} from './assert-design-shipped.mjs'

export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..')
export const WEB_ROOT = join(REPO_ROOT, 'apps/web')

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
 * plugin puts it.
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
// ---- the app's load-order rule, checked DIRECTLY ------------------------------------------------
//
// The warning count alone is a PROXY: it only fires because the SDK's logger happens to import
// `async_hooks`. Any future eager path into the SDK that does not touch that logger would put the
// whole graph in the root chunk with the gate still green. So the artifact is checked too.
//
// Both numbers are measured, not guessed — clean app build vs the same build with one eager
// `@strk20/protocol/send` import, RE-MEASURED on 2026-08-26 with the component library in the
// graph (the earlier pair, 270,104 -> 540,778, predates it and is kept nowhere but this sentence):
//     total dist JS   409,916 B  ->  673,480 B
//     "poseidon"              0  ->        13
// `starknet` is NOT usable as a marker: it reads 3 in the clean build, from the RPC hostnames in
// `constants.ts`. `poseidon` is a crypto primitive nothing but the SDK/starknet graph pulls in.
//
const APP_FORBIDDEN_IN_CHUNK = ['poseidon']

//
// A tripwire, not a target — and RAISED DELIBERATELY, in the commit that made it necessary.
//
// 409,916 B today. The jump from the previous 281,024 B is `@base-ui/react@1.7.0`, installed in the
// same commit: the responsive dialog and the command palette are its first two consumers and every
// list, selector and popup from story 6.4 onward is meant to be built from the same parts. Nothing
// about that is dodgeable by code-splitting, because this gate sums EVERY emitted `.js` in the
// output directory — the palette's own 127 kB chunk counts in full whether it is fetched or not.
// (The split is still right; it buys first-paint parse cost, which is a different thing from bytes.)
//
// 560,000 leaves ~150 kB of headroom for the six remaining surface stories while staying 113 kB
// BELOW the 673,480 B an eager SDK import produces — so the thing this number exists to catch is
// still caught, with room to spare. It is not fitted to today's figure: a ceiling one build away
// from firing is a ceiling that gets raised reflexively, which is how a tripwire stops being one.
//
// When a legitimate change crosses this, raise it DELIBERATELY and say why in the commit — that
// conversation is the point of the number. Nothing pins it in a test and neither it nor
// `assertAppChunkStaysLean` is exported, so a raise has no red/green available: the evidence is the
// log line at the bottom of this function.
//
const APP_MAX_EAGER_BYTES = 560_000

//
// ---- the cold-open surface has to be IN the entry ----------------------------------------------
//
// A HOLE THE BUDGET GATE CANNOT SEE, BY CONSTRUCTION. `assertAppChunkStaysLean` sums every emitted
// `.js`, which is the right shape for "did the SDK land in the bundle" and exactly the wrong shape
// for "is `/wallet` eager": moving a surface out of the entry and into its own chunk moves bytes
// between files and changes the total by a rounding error. Delete `codeSplitGroupings: []` from
// `routes/wallet.tsx` and the cold open silently becomes a second round trip while `build:web`,
// and the whole suite stay green.
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

//
// Names that can only be in a browser bundle because a Node-only module got in.
//
// Measured, not guessed — each was counted in a good build versus the same build with the SDK's
// `/testing` alias removed, and only the ones that actually move are kept:
//
//     starknet-devnet   0 -> 5     Devnet          0 -> 20    spawnInstalled  0 -> 1
//     api.github.com    0 -> 1     fileURLToPath   0 -> 1
//
// What those five name together: the no-alias graph pulls a GitHub-release DOWNLOADER and a
// decompress/tar chain into a wallet UI. `fileURLToPath` is the node-only path helper whose
// presence means a node module got in at all.
//
// `Buffer` is deliberately ABSENT from this list even though it is the symptom the page dies on.
// It is a legitimate identifier in plenty of healthy third-party code, so it false-fails; the
// modules that DRAG Buffer in are what this catches, and they are unambiguous.
//
const NODE_ONLY_MARKERS = ['starknet-devnet', 'Devnet', 'spawnInstalled', 'api.github.com', 'fileURLToPath']

/**
 * Reads every emitted `.js` chunk for the markers above.
 *
 * This replaces "load the page and see whether it throws". It is strictly more specific: a page
 * load reports `ReferenceError: Buffer is not defined` at some line of minified output, while this
 * names the module and the chunk it landed in.
 */
function assertNoNodeOnlyModules(outDir) {
  const hits = []
  for (const file of walkFiles(outDir).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(file, 'utf8')
    for (const marker of NODE_ONLY_MARKERS) {
      const count = source.split(marker).length - 1
      if (count) hits.push(`${marker} ×${count} in ${basename(file)}`)
    }
  }
  if (hits.length) {
    throw new Error(
      `[build:web] a Node-only module reached the browser bundle:\n  - ${hits.join('\n  - ')}\n\n` +
        `  This is the failure that builds green and dies at load with \`ReferenceError: Buffer is ` +
        `not defined\`. The usual cause is the privacy SDK's \`/testing\` barrel resolving to the ` +
        `Node entry instead of \`dist/testing/browser.js\` — check the alias in apps/web/vite.config.ts.`,
    )
  }
  console.log(`[build:web] no node-only modules in the bundle — ${NODE_ONLY_MARKERS.length} marker(s) checked`)
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
    //
    expectAllowlistedWarnings: 0,
    label: 'build:web',
  })

  assertAppChunkStaysLean(outDir)

  //
  // THE ROUTE TREE IS WHOLE. This used to be "load all ten routes in headless chromium and read a
  // per-route identity marker". What that actually defended against was the generated tree silently
  // shrinking — a route added to `routes/` but missing from `routeTree.gen.ts` is a route nothing
  // ever loads. `routePathsFromGeneratedTree` already proves exactly that, statically, by holding
  // the extracted union against the route files on disk and throwing on a shortfall. The browser
  // added the ability to notice a component that throws at render; Abu tests the surfaces himself,
  // and a render throw is neither silent nor invisible to him.
  //
  const paths = routePathsFromGeneratedTree(join(WEB_ROOT, 'src/routeTree.gen.ts'))
  console.log(`[build:web] route tree whole — ${paths.length} route(s): ${paths.join(', ')}`)

  //
  // NO NODE-ONLY MODULE REACHED THE BUNDLE.
  //
  // This is the real content of the old evaluation step. The measured failure it exists to catch:
  // with the SDK's `/testing` alias missing, the build exits 0, reports `✓ 324 modules transformed`
  // and writes a bundle that dies at load with `ReferenceError: Buffer is not defined`. Loading the
  // page was one way to find that out. Reading the emitted chunks for the names that can only come
  // from a Node module is the cheaper way, and it names the offender instead of reporting a
  // symptom.
  //
  // `Buffer` is deliberately NOT in the list: the string appears in healthy third-party code often
  // enough to false-fail. `fileURLToPath` is the load-bearing one — it is the node-only path helper
  // whose presence means a node module got in.
  //
  assertNoNodeOnlyModules(outDir)

  //
  // THE DESIGN SYSTEM IS IN THE ARTIFACT. Every other gate above passes with the stylesheet import
  // deleted and no CSS in `dist/` at all — see assert-design-shipped.mjs.
  //
  const cssFiles = walkFiles(outDir).filter((f) => f.endsWith('.css'))
  const cssAssets = cssFiles.map((f) => f.slice(REPO_ROOT.length + 1))
  const read = cssFiles.length
    ? readDesign({
        css: cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n'),
        html: readFileSync(join(outDir, 'index.html'), 'utf8'),
      })
    : null
  const designFailures = designProblems({
    cssAssets,
    read,
    expected: expectedGrounds(join(WEB_ROOT, 'design/tokens.yaml')),
  })
  if (designFailures.length) {
    throw new Error(`[build:web] the design system did not ship:\n  - ${designFailures.join('\n  - ')}`)
  }
  console.log(
    `[build:web] design system shipped — ${cssAssets.length} stylesheet(s), linked from index.html, ` +
      `both dark paths present, color-scheme flips, shadows re-theme`,
  )

  //
  // THE VALUE SPINE STILL RESERVES ITS SPACE (story 6.4). A separate verdict from the one above on
  // purpose: that one asks whether the token sheet reached the artifact, this one asks whether the
  // layout is still built the way it has to be. One function answering both would hide both.
  //
  const layoutFailures = reservedHeightProblems({ read })
  if (layoutFailures.length) {
    throw new Error(`[build:web] the value spine no longer reserves its space:\n  - ${layoutFailures.join('\n  - ')}`)
  }
  console.log(
    '[build:web] value spine reserves its space — amount row and balance line both hold their ' +
      'height, balance line mounted at opacity 0, field border present at rest',
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
