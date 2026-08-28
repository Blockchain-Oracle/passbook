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
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

//
// The matcher is IMPORTED, not written here. It used to be one of four independently authored
// copies; the drift between them let a decoy tree defeat one reader while the others refused, and
// let the verify script falsely accuse this guard of failing. `scripts/active-network.mjs` explains
// exactly why the pattern is anchored and counted — read it before touching this.
//
import { requireSingleActiveNetwork } from '../../scripts/active-network.mjs'
import { passbookGates } from './vite/gates.mjs'

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

//
// Where `vite dev` forwards `/api`. The default is a relayer started the ordinary way on
// loopback (`npx tsx packages/relayer/src/server.ts`).
//
// Set it to the DEPLOYED APP — `RELAYER_ORIGIN=https://passbook-zeta.vercel.app npm run dev` —
// to develop against the live relayer without holding its auth token locally: that origin's
// `api/[...path].js` attaches `x-relayer-auth` server-side, so the token stays where it belongs
// and the browser still posts to same-origin `/api/...`. Pointing straight at the relayer host
// instead answers 401 on every route, which is the token doing its job.
//
const relayerOrigin = process.env.RELAYER_ORIGIN ?? 'http://127.0.0.1:8787'

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

  //
  // THE DEPLOYMENT'S ADDRESSES, READ FROM THE EVIDENCE FILE THE DEPLOY SCRIPT WROTE.
  //
  // `evidence/markets-launch-deployment.json` is the single source of truth for where Markets and
  // Launch live — the relayer reads it at boot, and the browser cannot, so this is where the file's
  // contents become build-time env. Without this the surfaces rendered "not deployed" against
  // contracts that have been live on mainnet since 2026-08-27, which is the one kind of
  // understatement this app treats as a defect: the honest-absence copy was itself dishonest.
  //
  // Explicit env ALWAYS WINS — a CI that sets `VITE_PASSBOOK_MARKETS_ADDRESS` is overriding the
  // file on purpose. A missing or unparsable file defines nothing, and the surfaces fail closed to
  // their coming-states exactly as before.
  //
  const contractDefines: Record<string, string> = {}
  try {
    const evidence = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'evidence/markets-launch-deployment.json'), 'utf8'),
    ) as {
      Markets?: { contractAddress?: string }
      Launch?: { contractAddress?: string }
      Governance?: { contractAddress?: string; classHash?: string }
      pragma?: string
    }
    const wire = (key: string, value: string | undefined) => {
      if (typeof value === 'string' && value !== '' && process.env[key] === undefined) {
        contractDefines[`import.meta.env.${key}`] = JSON.stringify(value)
      }
    }
    wire('VITE_PASSBOOK_MARKETS_ADDRESS', evidence.Markets?.contractAddress)
    wire('VITE_PASSBOOK_LAUNCH_ADDRESS', evidence.Launch?.contractAddress)
    wire('VITE_PASSBOOK_PRAGMA_ADDRESS', evidence.pragma)
    wire('VITE_PASSBOOK_GOVERNANCE_ADDRESS', evidence.Governance?.contractAddress)
    wire('VITE_PASSBOOK_GOVERNANCE_CLASS_HASH', evidence.Governance?.classHash)
  } catch {
    // Pre-deployment is an ordinary state; the app runs in it and says so honestly.
  }

  return {
    // No `.env` file loading. Note what this does NOT do: shell/CI `VITE_*` variables are still
    // inlined by Vite regardless. Closing that hole needs an unused `envPrefix` or a post-build
    // dist assertion, and is logged in deferred-work.md.
    envDir: false,
    define: contractDefines,
    plugins: [
      // Codegen must run before the React transform sees the route files.
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      // The stylesheet compiler. Order against the two above is irrelevant — it owns CSS files and
      // they own route/JSX files. Its scan root is the nearest package.json to `src/index.css`,
      // i.e. `apps/web`: a class written in `packages/*` generates NO rule and renders unstyled
      // with a green build, which is why every component lives under `apps/web/src`.
      tailwindcss(),
      // The gates. Inside the config there is no door that bypasses them — see vite/gates.mjs.
      passbookGates({ repoRoot: REPO_ROOT, outDir: resolve(import.meta.dirname, 'dist') }),
    ],
    //
    // DEV ONLY, AND IT IS THE REWRITE THE RELAYER'S HEADER WARNS ABOUT — deliberately, here.
    //
    // The browser posts to the SAME-ORIGIN relative paths `/api/submit`, `/api/room/send` and
    // `/api/room/stream` (`register.ts`'s `DEFAULT_RELAYER_URL` and the endpoints derived from
    // it), because that is what lets the app work behind one hostname in production. In `vite dev`
    // there is nothing on those paths at all, so every relayer-backed feature — chat's transport
    // included — 404s, and chat looks broken for a reason that has nothing to do with chat.
    //
    // This forwards them to a relayer running the ordinary way (`npx tsx
    // packages/relayer/src/server.ts`, loopback, port 8787). It is a DEV SERVER setting: it does
    // not exist in `dist/`, and the production deployment does the same job with a proxy that
    // adds `x-relayer-auth` server-side.
    //
    // THE ORIGIN HEADER IS STRIPPED, and that is fidelity rather than a shortcut. A browser sends
    // `Origin` on every POST, same-origin included, and the relayer refuses any origin it was not
    // configured with — so forwarding it verbatim would 403 every request until someone set
    // `RELAYER_ALLOWED_ORIGINS` to whatever port Vite picked today. In production the proxy makes
    // its own server-side request and no Origin exists at all, which is the shape the relayer
    // treats as same-process. Removing it here makes dev match that instead of a third case.
    //
    // `changeOrigin` REWRITES `Host`, which is a different header from the `Origin` stripped
    // below — the two names are one keystroke apart and do opposite jobs, so: Origin is the
    // browser's claim about who is calling and stays removed either way; Host is what the far
    // end routes and terminates TLS on.
    //
    // It has to follow the target's scheme. The default target is loopback http, where a
    // rewritten Host buys nothing. But pointing `RELAYER_ORIGIN` at ANY https origin — the
    // hosted relayer, or the Vercel deployment whose `api/[...path].js` is the only thing that
    // attaches `x-relayer-auth` — sends `Host: localhost:5173` into the TLS handshake and the
    // connection dies as `Client network socket disconnected before secure TLS connection was
    // established`. That error names nothing about Host, which is why this is a comment and not
    // a line somebody can read the intent off.
    server: {
      proxy: {
        '/api': {
          target: relayerOrigin,
          changeOrigin: relayerOrigin.startsWith('https://'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
          },
        },
      },
    },
    resolve: {
      alias: {
        // shadcn writes every generated import as `@/components/ui/...`. Mirrors tsconfig `paths`.
        '@': resolve(import.meta.dirname, 'src'),
        '@starkware-libs/starknet-privacy-sdk/testing': SDK_TESTING_BROWSER,
      },
      // The alias resolves to ONE physical file. Without dedupe the rest of the SDK graph can be
      // pulled from a second `node_modules` root, duplicating the whole SDK (+266 kB raw /
      // +76 kB gzip) and surfacing only as one extra externalization warning line.
      dedupe: ['@starkware-libs/starknet-privacy-sdk', 'starknet'],
    },
  }
})
