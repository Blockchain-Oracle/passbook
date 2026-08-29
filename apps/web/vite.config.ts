import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

import { ACTIVE_NETWORK } from '../../packages/protocol/src/constants.ts'

// The privacy SDK's `/testing` barrel reaches for `node:fs` at module scope; the tarball ships a
// browser-safe sibling that its exports map does not name. Without the alias the build is green
// and the page dies at load with `Buffer is not defined`.
const SDK_TESTING_BROWSER = resolve(
  dirname(fileURLToPath(import.meta.resolve('@starkware-libs/starknet-privacy-sdk/testing'))),
  'browser.js',
)
if (!existsSync(SDK_TESTING_BROWSER)) {
  throw new Error(`privacy SDK browser barrel missing at ${SDK_TESTING_BROWSER}`)
}

// Contract addresses come from the deploy record the relayer also reads. Explicit env wins; a
// missing file defines nothing and the venue surfaces render their not-deployed states.
function contractDefines(): Record<string, string> {
  const defines: Record<string, string> = {}
  let evidence: Record<string, unknown> = {}
  try {
    evidence = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../../evidence/markets-launch-deployment.json'), 'utf8'),
    )
  } catch {
    return defines
  }
  const field = (key: string, prop: string) => {
    const record = evidence[key]
    return typeof record === 'object' && record !== null ? (record as Record<string, unknown>)[prop] : undefined
  }
  const wire = (env: string, value: unknown) => {
    if (typeof value === 'string' && value !== '' && process.env[env] === undefined) {
      defines[`import.meta.env.${env}`] = JSON.stringify(value)
    }
  }
  wire('VITE_APP_MARKETS_ADDRESS', field('MarketsV2', 'contractAddress') ?? field('Markets', 'contractAddress'))
  wire('VITE_APP_LAUNCH_ADDRESS', field('Launch', 'contractAddress'))
  wire('VITE_APP_PRAGMA_ADDRESS', evidence.pragma)
  wire('VITE_APP_GOVERNANCE_ADDRESS', field('Governance', 'contractAddress'))
  wire('VITE_APP_GOVERNANCE_CLASS_HASH', field('Governance', 'classHash'))
  return defines
}

// Warnings the build accepts. The `async_hooks` externalisation is the SDK's logger.
const ALLOWED_WARNING_PATTERNS = [/Module "async_hooks" has been externalized/]

// `vite dev` forwards `/api` to a relayer. Point `RELAYER_ORIGIN` at the deployed app to develop
// against the live relayer without holding its auth token locally.
const relayerOrigin = process.env.RELAYER_ORIGIN ?? 'http://127.0.0.1:8787'

export default defineConfig(({ command }) => {
  // A production artifact may only exist against mainnet. `vite dev` is unaffected.
  if (command === 'build' && ACTIVE_NETWORK !== 'mainnet') {
    throw new Error(`MAINNET GUARD: ACTIVE_NETWORK is '${ACTIVE_NETWORK}'`)
  }

  return {
    define: contractDefines(),
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
    ],
    build: {
      chunkSizeWarningLimit: 700,
      rolldownOptions: {
        onwarn(warning, warn) {
          if (ALLOWED_WARNING_PATTERNS.some((p) => p.test(warning.message ?? ''))) return warn(warning)
          throw new Error(`build warning treated as error — ${warning.code ?? ''}: ${warning.message}`)
        },
      },
    },
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
        '@': resolve(import.meta.dirname, './src'),
        '@starkware-libs/starknet-privacy-sdk/testing': SDK_TESTING_BROWSER,
      },
      dedupe: ['@starkware-libs/starknet-privacy-sdk', 'starknet'],
    },
  }
})
