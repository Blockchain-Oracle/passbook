//
// THE MONEY IS FROZEN. A sha256 manifest over the files that move value or derive keys.
//
// The revamp replaces the render layer. These files are not the render layer: they hold every
// refusal that costs real money — the both-or-neither v3 proof pair, the derived-vs-funded address
// check, the chain-id refusal, the single-pipeline double-spend guard, the walked-state refusal —
// and they contain no JSX. Freezing them turns "did this UI diff touch wei?" into a build answer
// instead of a judgement call, which inverts the usual rewrite risk: regressions land in pixels.
//
// TO CHANGE A FROZEN FILE, on purpose: edit it, run `node scripts/assert-money-frozen.mjs --update`,
// and commit the manifest change alongside. The point is not that these files can never change. The
// point is that changing one can never be incidental — it shows up as its own line in the diff.
//
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(REPO_ROOT, 'scripts/money-frozen.json')

/**
 * The frozen set, repo-relative.
 *
 * `session.ts` and `identity.ts` are here for key derivation rather than transfer: the embedded key
 * owns the viewing key, the pool writes it once, and WriteOnce refuses every replacement — so a
 * derivation regression is unrecoverable in a way a transfer bug is not.
 */
export const FROZEN = [
  // apps/web — the imperative money layer, zero JSX
  'apps/web/src/shell/submit.ts',
  'apps/web/src/shell/funding-wallet.ts',
  'apps/web/src/shell/register.ts',
  'apps/web/src/shell/account-status.ts',
  'apps/web/src/shell/public-balances.ts',
  'apps/web/src/shell/session.ts',
  'apps/web/src/shell/use-send.ts',
  'apps/web/src/shell/use-shield.ts',
  'apps/web/src/shell/pipeline-store.ts',

  // packages/protocol — planners, calldata builders, key material
  'packages/protocol/src/send.ts',
  'packages/protocol/src/shield.ts',
  'packages/protocol/src/bridge.ts',
  'packages/protocol/src/register.ts',
  'packages/protocol/src/identity.ts',
  'packages/protocol/src/session-vault.ts',
  'packages/protocol/src/session-lock.ts',
  'packages/protocol/src/swap-calldata.ts',
  'packages/protocol/src/market-calldata.ts',
  'packages/protocol/src/launch-calldata.ts',
  'packages/protocol/src/governance-calldata.ts',
]

/**
 * sha256 of a file's BYTES, not its text.
 *
 * Byte-level so a line-ending or BOM change is a change. M12 moves these files into `src/money/`
 * and proves the move was a rename by holding these hashes constant across it.
 *
 * @param {string} relPath
 * @returns {string} hex digest
 */
export function hashFrozenFile(relPath) {
  return createHash('sha256').update(readFileSync(join(REPO_ROOT, relPath))).digest('hex')
}

/** @returns {Record<string, string>} the recorded manifest, or `{}` when it has never been written */
export function readManifest() {
  return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}
}

/**
 * Every disagreement between the manifest and the tree, as sentences.
 *
 * A missing file is a problem rather than a skip: `git mv` without `--update` is exactly the
 * accident this gate exists to catch, and silence would bless it.
 *
 * @returns {string[]} empty when the money layer is untouched
 */
export function moneyFrozenProblems() {
  const manifest = readManifest()
  const problems = []

  for (const relPath of FROZEN) {
    if (!existsSync(join(REPO_ROOT, relPath))) {
      problems.push(`${relPath} is frozen but missing — moved or deleted without --update`)
      continue
    }
    const recorded = manifest[relPath]
    if (recorded === undefined) {
      problems.push(`${relPath} is frozen but absent from the manifest — run --update`)
      continue
    }
    const actual = hashFrozenFile(relPath)
    if (actual !== recorded) {
      problems.push(
        `${relPath} changed (${recorded.slice(0, 12)} -> ${actual.slice(0, 12)}). ` +
          `If that was deliberate, run --update and commit the manifest with it.`,
      )
    }
  }

  for (const recorded of Object.keys(manifest)) {
    if (!FROZEN.includes(recorded)) {
      problems.push(`${recorded} is in the manifest but no longer in FROZEN — run --update`)
    }
  }

  return problems
}

/** Rewrites the manifest from the current tree. @returns {Record<string, string>} */
export function writeManifest() {
  const next = Object.fromEntries(FROZEN.map((relPath) => [relPath, hashFrozenFile(relPath)]))
  writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--update')) {
    const next = writeManifest()
    console.log(`[money-frozen] manifest rewritten — ${Object.keys(next).length} file(s)`)
  } else {
    const problems = moneyFrozenProblems()
    if (problems.length) {
      console.error(`[money-frozen] the frozen money layer moved:\n  - ${problems.join('\n  - ')}`)
      process.exit(1)
    }
    console.log(`[money-frozen] ${FROZEN.length} file(s) unchanged`)
  }
}
