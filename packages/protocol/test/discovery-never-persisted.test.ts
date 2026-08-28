import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { SESSION_KEYS } from '../src/session-store.js'

//
// "Discovery results, indexer responses, or channel contents (story 1.9's territory)" are on
// `session.ts`'s MUST-NEVER-persist list. This file is that sentence as an executable rule.
//
// It is worth enforcing structurally because the failure is quiet, plausible and permanent. The
// tempting commit is a discovery cache — the walk is slow, the notes are already decrypted, and
// `sessionStore.set('notes', …)` would make the balance tile instant. What it would actually be
// is a copy of the user's entire balance history sitting in localStorage, readable by every
// script on the page, surviving the tab that made it. There is no session in which that is the
// right trade, so no code path may make it.
//
// Follows `backup-gates-registration-only.test.ts`: a dependency rule over source text, in the
// `scripts/lint-claims.mjs` tradition of walking files and failing on what must not appear.
//

/** The modules that hold discovered material. What they may not reach is what is policed. */
const DISCOVERY_MODULES = [
  'discovery.ts',
  'balances.ts',
  'activity.ts',
  'export.ts',
  'pool-events.ts',
  'activity-copy.ts',
]

/** The storage tier. No module above may depend on any of these, by any import form. */
const STORAGE_MODULES = [
  'session-store',
  'session-key',
  'session-cadence-store',
  'session-invite-store',
  'session',
]

const SRC = 'packages/protocol/src'

/**
 * The three import forms, as one matcher.
 *
 * Static `from '…'`, dynamic `import('…')` and `require('…')`. A rule that knew only about
 * static imports would be satisfied by the exact line that most needs catching: a lazy
 * `await import('./session-store.js')` inside a caching branch, which is how a module reaches
 * storage without a visible dependency at the top of the file.
 *
 * The `[^'"`]*` prefix matches a path, and the trailing boundary stops `session` from also
 * matching `session-store` — the two are policed separately and a sloppy pattern would make
 * the specific rules unreachable.
 */
function importsModule(text: string, mod: string): boolean {
  return [
    `from\\s*['"\`][^'"\`]*/${mod}(?:\\.[jt]s)?['"\`]`,
    `import\\s*\\(\\s*['"\`][^'"\`]*/${mod}(?:\\.[jt]s)?['"\`]`,
    `require\\s*\\(\\s*['"\`][^'"\`]*/${mod}(?:\\.[jt]s)?['"\`]`,
  ].some((form) => new RegExp(form).test(text))
}

/**
 * Every `.ts` file under `src`, recursively, as paths relative to `SRC`.
 *
 * A flat `readdirSync` stops seeing code the moment anyone adds a subdirectory, and a
 * structural rule that can be routed around by `mkdir` is not structural. The sibling guard
 * (`backup-gates-registration-only.test.ts`) walks recursively for the same reason.
 */
function allSourceFiles(dir: string = SRC, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(full).isDirectory()) out.push(...allSourceFiles(full, rel))
    else if (extname(entry) === '.ts') out.push(rel)
  }
  return out
}

/**
 * Resolves the named discovery modules through the recursive walk.
 *
 * Named files rather than a pattern, because these six are the ones holding decrypted material
 * and the rule is about them specifically. Resolved through the walk rather than by
 * `join(SRC, name)` so that moving one into a subdirectory relocates the rule with it instead
 * of throwing ENOENT — and `discoveryModulePaths` asserts all six were actually found, so a
 * renamed module fails loudly rather than dropping out of the sweep.
 */
function discoveryModulePaths(): string[] {
  const all = allSourceFiles()
  return DISCOVERY_MODULES.map((name) => {
    const found = all.find((file) => file === name || file.endsWith(`/${name}`))
    if (!found) throw new Error(`${name} is policed by this rule but no longer exists in src`)
    return found
  })
}

describe('nothing discovered can be written down', () => {
  it('found the source tree and every module it is supposed to be policing', () => {
    // A walk that silently found nothing is a guard that passes by doing nothing — the same
    // fail-open `lint-claims.mjs` calls out in its own parser. Anchored so it cannot happen.
    expect(allSourceFiles().length).toBeGreaterThan(10)
    expect(allSourceFiles()).toContain('session-store.ts')
    expect(discoveryModulePaths()).toHaveLength(DISCOVERY_MODULES.length)
  })

  it('no discovery module imports the storage tier, dynamic imports included', () => {
    for (const file of discoveryModulePaths()) {
      const text = readFileSync(join(SRC, file), 'utf8')
      for (const storage of STORAGE_MODULES) {
        expect(
          importsModule(text, storage),
          `${file} imports ${storage} — discovery output must never be persisted`,
        ).toBe(false)
      }
    }
  })

  it('no discovery module reaches a browser storage API directly', () => {
    // The import rule above is about our own tier. This is about routing around it entirely:
    // `localStorage.setItem` in a balance module needs no import at all.
    const FORBIDDEN_APIS = [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'IDBDatabase',
      'document.cookie',
      'caches.open',
    ]
    for (const file of discoveryModulePaths()) {
      const text = readFileSync(join(SRC, file), 'utf8')
      for (const api of FORBIDDEN_APIS) {
        expect(text, `${file} names ${api}`).not.toContain(api)
      }
    }
  })

  it('the closed key union did not grow for this story', () => {
    // `SESSION_KEYS` is closed by doctrine. A new key is how discovery output would acquire a
    // legitimate-looking home, so the count is pinned and growing it is a deliberate act with
    // a failing test attached.
    // `accounts` (Wave 1) holds root KEYS and nothing else — the same material `accountKey`
    // already holds, in a list. It is named here because the union grew, and it grew for a reason
    // written at `session-accounts.ts`; what matters to THIS test is that it is not a home for
    // discovery output, which the value check below re-asserts independently of the name.
    // `positionSecrets` (Wave 3) holds secrets this CLIENT minted — bearer material that was
    // never read out of the pool, decrypted, or discovered. It is named here because the union
    // grew, and it grew for a reason written at `session-position-store.ts`; what matters to THIS
    // test is that nothing discovered can hide in it, which the value check below re-asserts
    // independently of the name.
    // `vault` (2026-08-28) holds the SEALED accounts record — the same material `accounts` held,
    // encrypted, and strictly less of it in the clear than before. It is named here because the
    // union grew; what matters to THIS test is that a sealed account list is still an account list
    // and not a home for discovery output.
    expect(Object.keys(SESSION_KEYS).sort()).toEqual(
      [
        'accountKey',
        'accounts',
        'cadence',
        'ceremony',
        'inviteIntents',
        'positionSecrets',
        'vault',
      ].sort(),
    )
    // And no key's VALUE mentions this story's material either — a key named `ceremony` whose
    // value drifted to `passbook.notes` would pass a name check and fail the rule.
    for (const value of Object.values(SESSION_KEYS)) {
      expect(value).not.toMatch(/note|balance|activity|discover|channel/i)
    }
  })

  it('no module in src writes a note, a balance or an activity row to storage', () => {
    // The whole `src` tree, not just this story's files: the caching commit could land in any
    // module, and the point of a structural rule is that it does not depend on remembering
    // which file the mistake will arrive in.
    const suspicious =
      /\.setItem\s*\(\s*['"`][^'"`]*(note|balance|activity|discover|channel)/i
    for (const file of allSourceFiles()) {
      const text = readFileSync(join(SRC, file), 'utf8')
      expect(suspicious.test(text), `${file} writes discovered material to storage`).toBe(false)
    }
  })
})

describe('the /testing import is isolated to one module', () => {
  it('exactly one source file names the subpath', () => {
    // The swap point. Upstream #121 may publish `ContractDiscoveryProvider` properly one day,
    // and when it does this has to be a one-file edit — not a grep across the package.
    const importers: string[] = []
    for (const file of allSourceFiles()) {
      const text = readFileSync(join(SRC, file), 'utf8')
      if (/from\s*['"]@starkware-libs\/starknet-privacy-sdk\/testing['"]/.test(text)) {
        importers.push(file)
      }
    }
    expect(importers).toEqual(['discovery.ts'])
  })

  it('consumers get the pool hashes from discovery.ts, never from the subpath', () => {
    // `compute_note_id` and `compute_nullifier` are pool consensus rules. Importing them from
    // two places is how a second copy of a protocol hash eventually appears.
    const activity = readFileSync(join(SRC, 'activity.ts'), 'utf8')
    expect(activity).toMatch(/compute_note_id.*from '\.\/discovery\.js'|from '\.\/discovery\.js'/s)
    expect(activity).not.toContain('starknet-privacy-sdk/testing')
  })
})
