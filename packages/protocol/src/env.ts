//
// Loads `.env` into `process.env`.
//
// `.env.example` tells the reader to copy it to `.env`, and until this existed nothing
// read the result — the deploy dry-run reported "DEPLOYER_ADDRESS not set" with a fully
// populated `.env` sitting next to it. That is a dead end at exactly the moment someone
// first tries to use the scripts for real.
//
// No dependency. Node >= 20.12 ships `process.loadEnvFile`, the same parser behind
// `--env-file`, and this project pins Node >= 24. Adding `dotenv` for a function the
// runtime already has would drift the dependency tree, which is the one thing the
// toolchain constraints are most insistent about.
//

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface EnvLoadResult {
  /** True when a file was found and parsed. False is normal, not an error. */
  loaded: boolean
  /** The file that was read, when one was. */
  path?: string
  /** Why nothing was loaded, for the caller to print. */
  reason?: string
}

/** `packages/protocol/src/env.ts` -> repository root. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
}

/**
 * Reads `.env` if there is one.
 *
 * REAL ENVIRONMENT VARIABLES WIN. `process.loadEnvFile` leaves an already-set variable
 * alone, so a CI secret or a `FOO=… npx tsx …` prefix beats a stale local file rather
 * than being silently replaced by it. That precedence is load-bearing and pinned by a
 * test, because it is invisible until the day it is wrong.
 *
 * A MISSING FILE IS NOT AN ERROR. The dry-runs exist to report which variables are
 * absent; throwing here would replace that report with a stack trace and make the
 * scripts unusable for the one job they can do without secrets.
 *
 * Both the current directory and the repository root are tried, so it works whether a
 * script is run from the root or the relayer is started from inside its package.
 */
export function loadDotEnv(explicitPath?: string): EnvLoadResult {
  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : [resolve(process.cwd(), '.env'), resolve(repoRoot(), '.env')]

  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    return { loaded: false, reason: `no .env found (looked in ${candidates.join(', ')})` }
  }

  try {
    process.loadEnvFile(found)
    return { loaded: true, path: found }
  } catch (e) {
    // The file exists but could not be read or parsed — a directory, a permissions
    // problem, an unreadable encoding. Say which file and why: a silent empty result
    // here looks exactly like "you forgot to set the variable", and sends the reader
    // hunting for the wrong bug.
    return { loaded: false, path: found, reason: `${found} could not be parsed: ${String(e)}` }
  }
}
