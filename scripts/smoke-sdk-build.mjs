//
// The committed COMBINED-graph smoke: proof that React 19 + TanStack Router + `@strk20/protocol` +
// the privacy SDK bundle together into a browser-safe artifact — and that the node-only
// surface still cannot.
//
// This gate lives here rather than in `build:web` because the app deliberately does NOT import the
// SDK (`src/main.tsx` takes `constants` only, so the ~700 kB graph stays out of the eager root
// chunk for the deferred load-order story). The combined graph still has to be proved by something
// that runs on every change, so this is that something.
//
// It also replaces the untracked `.tmp-probe/vite-probe` measurement, which imported protocol
// modules by RELATIVE path, never touched `send.ts` or `register.ts`, and was therefore measuring a
// graph the app does not have. AD-16 orders untracked probes retired; this is the committed thing
// that earns their deletion.
//
// Five assertions, in order of how easy they are to fake:
//   1. it builds through the shared warning gate — exactly one allowlisted warning, count asserted;
//   2. the emitted chunk contains none of the node-only names the alias exists to keep out;
//   3. it EVALUATES in headless chromium with zero page errors and publishes its resolved surface;
//   4. React actually COMMITTED DOM, carrying a value that came out of `@strk20/protocol`;
//   5. the negative case — a graph importing `@strk20/protocol/env` — FAILS, naming the client
//      condition set.
//
// (1) alone is worthless: without the alias the build exits 0 and the page dies at load with
// `ReferenceError: Buffer is not defined`. (2) is a proxy. (3) and (4) are the proof.
//
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

import {
  WEB_ROOT,
  buildGated,
  routePathsFromGeneratedTree,
  walkFiles,
} from './build-web.mjs'

const SMOKE_ROOT = join(WEB_ROOT, 'smoke')
const OUT_DIR = join(WEB_ROOT, 'dist-smoke')
const NEGATIVE_OUT_DIR = join(WEB_ROOT, 'dist-smoke-negative')
// The deliberately-wrong control build that proves the banned-name scan can fail.
const CANARY_OUT_DIR = join(WEB_ROOT, 'dist-smoke-canary')

//
// Same alias and same dedupe as the app, derived the same way — the ONE-ARGUMENT
// `import.meta.resolve`. `require.resolve` cannot resolve this package at all (no `require`
// condition, no `./package.json` key), and the two-argument `import.meta.resolve(spec, parent)`
// form is silently ignored by plain Node 24. The SDK's declared `./browser` export is dangling in
// rc.2 — `dist/` contains no `browser` directory — so the alias must point at the real file.
//
const SDK_TESTING_BROWSER = resolve(
  dirname(fileURLToPath(import.meta.resolve('@starkware-libs/starknet-privacy-sdk/testing'))),
  'browser.js',
)

/**
 * The smoke's build config, expressed inline so there is no second config file to drift.
 *
 * NO PLUGINS, and both omissions are deliberate.
 *
 * `@vitejs/plugin-react` is not here even though the entry mounts React and the graph pulls in the
 * app's `.tsx` route files: Vite 8 transforms them with its built-in JSX handling, driven by
 * `apps/web/tsconfig.json`'s `jsx: "react-jsx"` — verified, this build is green without it. That
 * matters beyond tidiness. The plugin is declared in `apps/web`, not at the root, so a root script
 * importing it would resolve only by npm's hoisting and would break the day npm nested it instead.
 *
 * The router plugin is not here because the route tree is COMMITTED and imported directly. A second
 * generator writing `routeTree.gen.ts` during the smoke would reintroduce the "a build heals a
 * broken tree before anything can observe it" hazard from the other side.
 */
const SMOKE_CONFIG = {
  envDir: false,
  resolve: {
    alias: { '@starkware-libs/starknet-privacy-sdk/testing': SDK_TESTING_BROWSER },
    dedupe: ['@starkware-libs/starknet-privacy-sdk', 'starknet'],
  },
}

//
// Names that must not survive into a browser bundle — and every one of them MEASURED to actually
// move in the failure this list exists to catch.
//
// The previous list had seven names and five of them were decoration. Counted with this file's own
// method, good build vs the same build with the `/testing` alias removed:
//
//     starknet-devnet                    0 -> 5     load-bearing
//     Devnet                             0 -> 20    load-bearing
//     spawnInstalled                     0 -> 1     load-bearing
//     api.github.com                     0 -> 1     load-bearing
//     fileURLToPath                      0 -> 1     load-bearing
//     child_process                      0 -> 0     cannot fail — dropped
//     async_hooks                        0 -> 0     cannot fail — dropped
//     ScreeningCallMockProofProvider     0 -> 0     cannot fail — dropped
//     IndexerDiscoveryProvider           0 -> 0     cannot fail — dropped
//     __vite-browser-external            0 -> 0     cannot fail — dropped
//     decompress                         1 -> 17    NOT usable: 1 in the GOOD build, would false-fail
//
// `async_hooks` reading 0 in both is not a surprise once you look: it is EXTERNALIZED, which is why
// the build warns about it, and an externalized builtin leaves no name in the chunk. It was in the
// list because it sounded right.
//
// What the surviving five actually name: the no-alias graph pulls a GitHub-release DOWNLOADER
// (`api.github.com/repos/0xSpaceShard/starknet-devnet/releases`, reached via `spawnInstalled`) and a
// decompress/tar chain into a wallet UI. That is a supply-chain argument, not a byte-count one.
// `fileURLToPath` is the node-only path helper whose presence means a node module got in.
//
// `assertBannedNamesCanFail()` below re-proves this table on every run, so the next person to edit
// the list finds out immediately if they added a name that cannot fail.
//
const FORBIDDEN_IN_CHUNK = [
  'starknet-devnet',
  'Devnet',
  'spawnInstalled',
  'api.github.com',
  'fileURLToPath',
]

/**
 * The resolver message the browser boundary is made of. Pinned as a CONDITION SET, deliberately: if
 * a future `"default"` or `"browser"` key lands on `./env`, the import starts resolving and this
 * assertion is the only thing in the repository that would notice.
 */
const ENV_REFUSAL = /"\.\/env" is not exported/
// Whitespace-tolerant, order-exact. rolldown prints the set with spaces after the commas
// (`["module", "browser", "production", "import"]`); the planning text quoted it without. The set
// and its order are what is being pinned, not the pretty-printing.
const ENV_CONDITIONS = /\[\s*"module"\s*,\s*"browser"\s*,\s*"production"\s*,\s*"import"\s*\]/

/** Every `.js` file under `dir`, concatenated, plus the file list. */
function emittedJs(dir) {
  const files = walkFiles(dir).filter((f) => f.endsWith('.js'))
  return { files, source: files.map((f) => readFileSync(f, 'utf8')).join('') }
}

function scanForBannedNames(source) {
  return FORBIDDEN_IN_CHUNK.map((name) => ({ name, count: source.split(name).length - 1 })).filter(
    (hit) => hit.count > 0,
  )
}

/**
 * Proves the banned-name list can FAIL, by building the graph the alias exists to prevent.
 *
 * A list of greps that all read zero is indistinguishable from a list of greps that CANNOT read
 * anything else, and this repository has already shipped one of those: five of the original seven
 * names read 0 in both the good build and the broken one. So the broken build is constructed here,
 * on every run, and the scan must find something in it.
 *
 * This is the same discipline `smoke/negative-env.ts` applies to the resolver boundary: the check
 * that the check works, rather than a comment claiming it does.
 */
async function assertBannedNamesCanFail() {
  rmSync(CANARY_OUT_DIR, { recursive: true, force: true })

  // No warning gate, no alias. This build is EXPECTED to be wrong — it is the control.
  await build({
    root: SMOKE_ROOT,
    configFile: false,
    configLoader: 'native',
    logLevel: 'silent',
    envDir: false,
    resolve: { dedupe: ['@starkware-libs/starknet-privacy-sdk', 'starknet'] },
    build: { outDir: CANARY_OUT_DIR, emptyOutDir: true },
  })

  const { source } = emittedJs(CANARY_OUT_DIR)
  const hits = scanForBannedNames(source)
  const silent = FORBIDDEN_IN_CHUNK.filter((n) => !hits.some((h) => h.name === n))

  if (silent.length) {
    throw new Error(
      `[smoke:sdk] ${silent.length} banned name(s) read ZERO even in the un-aliased build they ` +
        `exist to catch: ${silent.join(', ')}. A grep that cannot fail is not a check — measure a ` +
        `replacement against this same control build, or drop it.`,
    )
  }

  rmSync(CANARY_OUT_DIR, { recursive: true, force: true })
  console.log(
    `[smoke:sdk] banned-name list self-proved — all ${FORBIDDEN_IN_CHUNK.length} names fire on the ` +
      `un-aliased control build (${hits.map((h) => `${h.name}×${h.count}`).join(', ')})`,
  )
}

async function positive() {
  rmSync(OUT_DIR, { recursive: true, force: true })

  await buildGated({
    root: SMOKE_ROOT,
    configFile: false,
    expectAllowlistedWarnings: 1,
    label: 'smoke:sdk',
    inlineConfig: { ...SMOKE_CONFIG, build: { outDir: OUT_DIR, emptyOutDir: true } },
  })

  // ---- the greps -------------------------------------------------------------------------------
  const { files: emitted, source } = emittedJs(OUT_DIR)
  if (!emitted.length) throw new Error('[smoke:sdk] the build emitted no JavaScript at all')

  const hits = scanForBannedNames(source)
  if (hits.length) {
    throw new Error(
      `[smoke:sdk] node-only names reached the browser chunk — the /testing alias is not doing its ` +
        `job:\n  - ${hits.map((h) => `${h.count}× "${h.name}"`).join('\n  - ')}`,
    )
  }
  console.log(`[smoke:sdk] chunk clean — 0 occurrences of ${FORBIDDEN_IN_CHUNK.length} banned names`)

  //
  // ---- what used to be an evaluation, and what replaced it --------------------------------------
  //
  // This block used to serve the bundle to headless chromium, read `window.__SMOKE__`, and assert
  // that `planSend`/`proveRegistration`/… resolved to functions and that React had committed DOM.
  // Removed 2026-08-26 (Abu's ruling: read the artifact, do not drive a browser).
  //
  // The load-bearing half of it did not need a browser and never did. The failure it names —
  // "a name that resolves to `undefined` in the browser" — is the `[IMPORT_IS_UNDEFINED]` warning,
  // and `buildGated` above already treats that warning as FATAL rather than allowlisting it. That
  // is a stricter check reached earlier: it fails at build time and names the export, where the
  // evaluation could only report a member of `window.__SMOKE__` that came back the wrong type.
  //
  // What did leave: proof that React committed DOM in a real engine. That is a rendering question,
  // it is loud when it breaks, and Abu tests the surfaces himself.
  //
  // The route tree is still cross-checked — `routePathsFromGeneratedTree` holds the generated union
  // against the route files on disk and throws on a shortfall, which is what kept a silently-shrunk
  // route list from passing. It just no longer needs a page load to do it.
  //
  const routes = routePathsFromGeneratedTree(join(WEB_ROOT, 'src/routeTree.gen.ts'))
  console.log(`[smoke:sdk] route tree whole — ${routes.length} route(s)`)

  const total = emitted.reduce((n, f) => n + readFileSync(f).byteLength, 0)
  console.log(`[smoke:sdk] emitted ${emitted.length} chunk(s), ${(total / 1024).toFixed(2)} kB raw`)
}

async function negative() {
  rmSync(NEGATIVE_OUT_DIR, { recursive: true, force: true })

  let failure = null
  try {
    // No warning gate here: the gate's job is to judge a build that succeeded, and this one must
    // not. Nothing is captured because nothing is expected to be emitted.
    await build({
      root: SMOKE_ROOT,
      configFile: false,
      configLoader: 'native',
      logLevel: 'silent',
      ...SMOKE_CONFIG,
      build: {
        outDir: NEGATIVE_OUT_DIR,
        emptyOutDir: true,
        rolldownOptions: { input: join(SMOKE_ROOT, 'negative-env.ts') },
      },
    })
  } catch (e) {
    failure = e
  }

  if (!failure) {
    throw new Error(
      `[smoke:sdk] NEGATIVE CASE FAILED TO FAIL. A browser build imported ` +
        `\`@strk20/protocol/env\` and succeeded, which means the node-only surface is reachable ` +
        `from the client. Check whether a \`"default"\` or \`"browser"\` key was added to \`./env\` ` +
        `in packages/protocol/package.json.`,
    )
  }

  const text = `${failure.message ?? ''}\n${failure.stack ?? ''}`
  if (!ENV_REFUSAL.test(text)) {
    throw new Error(
      `[smoke:sdk] the negative build failed, but not for the right reason — a build that dies of ` +
        `something else proves nothing about the boundary. Got:\n${text}`,
    )
  }
  if (!ENV_CONDITIONS.test(text)) {
    throw new Error(
      `[smoke:sdk] the resolver refused \`./env\`, but the client condition set has changed from ` +
        `["module","browser","production","import"]. That set is what the boundary is made of — ` +
        `re-read it before updating this assertion. Got:\n${text}`,
    )
  }

  console.log('[smoke:sdk] negative case refused as specified — ./env is unreachable from a client build')
  rmSync(NEGATIVE_OUT_DIR, { recursive: true, force: true })
}

async function main() {
  if (!existsSync(SDK_TESTING_BROWSER)) {
    throw new Error(`the SDK's browser testing barrel is missing at ${SDK_TESTING_BROWSER}`)
  }
  await assertBannedNamesCanFail()
  await positive()
  await negative()
  console.log('[smoke:sdk] OK')
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
