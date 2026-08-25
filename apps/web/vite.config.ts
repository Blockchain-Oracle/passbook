//
// The app's build configuration, and the place the mainnet rule is enforced.
//
// AD-8: a production build of this app may only ever be made against `ACTIVE_NETWORK = 'mainnet'`.
// The elimination gate depends on a judge seeing real mainnet state, so an off-mainnet artifact is
// not a lesser build — it is a build that must not exist. The guard therefore lives in config
// EVALUATION, which runs before rolldown starts: an off-mainnet build dies in about a second and
// never writes a byte to `dist/`.
//
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

//
// The matcher is IMPORTED, not written here. It used to be one of four independently authored
// copies; the drift between them let a decoy tree defeat one reader while the others refused, and
// let the verify script falsely accuse this guard of failing. `scripts/active-network.mjs` explains
// exactly why the pattern is anchored and counted — read it before touching this.
//
import { requireSingleActiveNetwork } from '../../scripts/active-network.mjs'

/** `apps/web/` -> repository root. Never cwd-relative: `npm run dev -w apps/web` runs from here. */
const REPO_ROOT = resolve(import.meta.dirname, '../..')
const CONSTANTS = resolve(REPO_ROOT, 'packages/protocol/src/constants.ts')

function assertMainnet(): string {
  const source = readFileSync(CONSTANTS, 'utf8')

  // `MAINNET GUARD` is passed as the prefix because `scripts/verify-mainnet-guard.mjs` asserts on
  // that exact string: a nonzero exit alone proves nothing (a mainnet build with `index.html`
  // removed also exits 1), so the string is what identifies the refusal as this guard's.
  const { network: active } = requireSingleActiveNetwork(source, {
    file: CONSTANTS,
    prefix: 'MAINNET GUARD: ',
  })

  if (active !== 'mainnet') {
    throw new Error(
      `MAINNET GUARD: ACTIVE_NETWORK is '${active}'. A production build of this app may only be ` +
        `made on mainnet (AD-8). Set it back to 'mainnet' in packages/protocol/src/constants.ts. ` +
        `\`vite dev\` is unaffected — the guard is build-only, on purpose.`,
    )
  }
  return active
}

//
// The privacy SDK's `/testing` barrel re-exports `devnet.js`, which reaches for `node:fs`,
// `node:path` and `node:url` at module scope, and `screening-signer.js`, which calls
// `shortStringToFelt("StarkNet Message")` at module scope and so needs `Buffer`. The tarball ships
// a browser-safe sibling barrel — `dist/testing/browser.js` — that the exports map does not name.
//
// Without this alias the build still EXITS 0 and the page then dies at load with
// `ReferenceError: Buffer is not defined`. The alias is correctness, not size.
//
// Resolved with the ONE-ARGUMENT `import.meta.resolve`. `require.resolve` cannot resolve this
// package at all (no `require` condition, no `./package.json` key — it throws
// ERR_PACKAGE_PATH_NOT_EXPORTED and the config fails to LOAD), and the two-argument
// `import.meta.resolve(spec, parent)` form is silently ignored by plain Node 24. Do not "improve"
// this line into either of them.
//
// The declared `./browser` export is NOT usable: rc.2's `dist/` contains no `browser` directory.
//
const SDK_TESTING_BROWSER = resolve(
  dirname(fileURLToPath(import.meta.resolve('@starkware-libs/starknet-privacy-sdk/testing'))),
  'browser.js',
)

if (!existsSync(SDK_TESTING_BROWSER)) {
  throw new Error(
    `The privacy SDK's browser-safe testing barrel is missing at ${SDK_TESTING_BROWSER}. ` +
      `Without it the bundle builds green and dies at load — refusing to configure a build that ` +
      `cannot be correct.`,
  )
}

export default defineConfig((configEnv) => {
  // Build-only, and the read lives INSIDE the branch: an unconditional readFileSync would take
  // `vite dev` down with ENOENT the moment the path is wrong, turning a build rule into a
  // development outage. `command` is the only signal available here — `configEnv.mode` is not
  // finalized until after this file has been evaluated.
  //
  // `vite preview` reports `command: 'serve'` and will happily serve a stale off-mainnet `dist/`.
  // Preview output is never evidence that this guard ran.
  if (configEnv.command === 'build') {
    const active = assertMainnet()
    console.log(`[mainnet guard] ACTIVE_NETWORK=${active} — production build permitted`)
  }

  return {
    // No `.env` file loading. Note what this does NOT do: shell/CI `VITE_*` variables are still
    // inlined by Vite regardless. Closing that hole needs an unused `envPrefix` or a post-build
    // dist assertion, and belongs to the deferred lint-secrets work.
    envDir: false,
    plugins: [
      // Codegen must run before the React transform sees the route files.
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
    ],
    resolve: {
      alias: {
        '@starkware-libs/starknet-privacy-sdk/testing': SDK_TESTING_BROWSER,
      },
      // The alias resolves to ONE physical file. Without dedupe the rest of the SDK graph can be
      // pulled from a second `node_modules` root, duplicating the whole SDK (+266 kB raw /
      // +76 kB gzip) and surfacing only as one extra externalization warning line.
      dedupe: ['@starkware-libs/starknet-privacy-sdk', 'starknet'],
    },
  }
})
