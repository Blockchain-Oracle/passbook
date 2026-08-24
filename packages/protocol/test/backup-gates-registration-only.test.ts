import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { registerSponsored } from '../src/register.js'
import { generateIdentity } from '../src/identity.js'
import { makeCanRegister, beginCeremony } from '../src/backup-gate.js'
import { verifyClaimedKey, deriveRegisteredPublicKey } from '../src/registration.js'
import { classifyPause } from '../src/pool.js'

//
// AC1, as an executable assertion rather than a promise in a comment: "Backup gates
// REGISTRATION ONLY; browse, receive, and read are never blocked by backup state."
//
// This is worth enforcing structurally because the failure is quiet and arrives late. The
// tempting next commit is a balance tile or a receive screen that "just checks" whether the
// user is backed up first — and because the backup predicate fails closed, every one of those
// surfaces would then refuse to work for exactly the users who most need to see them: the
// ones who have not backed up yet. Backup blocking the ONE irreversible write is a safety
// feature; backup blocking anything else is a bricked product.
//
// The check is a dependency check, following the `scripts/lint-claims.mjs` precedent of
// walking source and failing on what must not appear. It does not care what a function is
// named — it cares that the modules holding backup state have exactly one consumer shape.
//

/** The modules that hold or decide backup state. Importing these is what is being policed. */
const STATE_MODULES = ['backup-gate', 'backup-cadence']

/** Copy is not state — every surface may render a sentence about backups. */
const COPY_MODULE = 'backup-copy'

/**
 * Files allowed to import the state modules.
 *
 * `backup-gate.ts` and `backup-cadence.ts` themselves, and nothing else in `src`. They import
 * each other on purpose: `completeCeremony` bridges the finished ceremony into the cadence's
 * first verification, which is the one place the two genuinely have to meet.
 *
 * WHAT THIS RULE DOES NOT — AND CANNOT — COVER. The boundary it enforces is the `src`
 * directory of each package, and nothing above it.
 * The app layer is necessarily unpoliced, because epic 6's wiring MUST import the gate: some
 * component has to build `makeCanRegister(state)` and hand it to `registerSponsored`. So this
 * is not a proof that no UI anywhere consults backup state; it is a proof that no PROTOCOL
 * module does, which is the layer where such a dependency would be invisible and permanent.
 * Keeping epic 6 honest is a review question, and the reviewer's rule is simple: exactly one
 * call site, and what it produces goes into `canRegister` and nowhere else.
 */
const ALLOWED = new Set(['backup-gate.ts', 'backup-cadence.ts'])

function sourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    if (!statSync(p).isDirectory()) {
      if (['.ts', '.tsx', '.js'].includes(extname(p))) out.push(p)
      return
    }
    for (const f of readdirSync(p)) if (f !== 'node_modules' && !f.endsWith('.d.ts')) walk(join(p, f))
  }
  walk(root)
  return out
}

describe('backup gates registration only (AC1)', () => {
  const files = [
    ...sourceFiles('packages/protocol/src'),
    ...sourceFiles('packages/relayer/src'),
  ]

  it('found the source tree it is supposed to be policing', () => {
    // A walk that silently found nothing is a guard that passes by doing nothing — the exact
    // failure `lint-claims.mjs` calls out in its own parser. Assert the sweep is real.
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((f) => f.endsWith('register.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('backup-gate.ts'))).toBe(true)
  })

  it('NOTHING in src imports the backup-state modules except themselves', () => {
    const offenders: string[] = []
    for (const file of files) {
      const name = file.split('/').pop()!
      if (ALLOWED.has(name)) continue
      const text = readFileSync(file, 'utf8')
      for (const mod of STATE_MODULES) {
        // Static `from '…'`, dynamic `import('…')`, and `require('…')`. A rule that only
        // knew about static imports would be satisfied by the one line that most needs
        // catching: a lazy `await import('./backup-cadence.js')` inside a balance tile,
        // which is exactly how a surface would reach for backup state without a visible
        // dependency at the top of the file. A comment mentioning the gate is not a
        // dependency and is not matched.
        for (const form of [
          `from\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
          `import\\s*\\(\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
          `require\\s*\\(\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
        ]) {
          if (new RegExp(form).test(text)) offenders.push(`${file} imports ${mod}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the import police actually catch each form they claim to', () => {
    // A policy test that silently matches nothing is worse than no policy test. These are the
    // three shapes the rule above must recognise, checked against the same regexes.
    const shouldCatch = [
      `import { makeCanRegister } from './backup-gate.js'`,
      `import {\n  readBackupCadence,\n} from '../protocol/src/backup-cadence.js'`,
      `const m = await import('./backup-cadence.js')`,
      `const m = require('./backup-gate.js')`,
      `import( "./backup-gate.js" )`,
      // Extensionless and `.ts` specifiers. A bundler-resolved `from './backup-gate'` is the
      // ordinary way to write this in most codebases, and a rule that only knew the `.js`
      // form would wave it straight through.
      `import { makeCanRegister } from './backup-gate'`,
      `import { readBackupCadence } from './backup-cadence.ts'`,
      `const m = await import('./backup-gate')`,
    ]
    const shouldNotCatch = [
      `// see backup-gate.js for the ceremony`,
      `import { NO_BACKUP_NAG } from './backup-copy.js'`,
      `const label = 'backup-gate'`,
      // The policed name is a PREFIX of this test's own filename; matching it would make the
      // rule fire on any file that imported this suite.
      `import x from './backup-gates-registration-only.js'`,
    ]
    const matches = (text: string) =>
      STATE_MODULES.some((mod) =>
        [
          `from\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
          `import\\s*\\(\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
          `require\\s*\\(\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
        ].some((form) => new RegExp(form).test(text)),
      )
    for (const text of shouldCatch) expect(matches(text), text).toBe(true)
    for (const text of shouldNotCatch) expect(matches(text), text).toBe(false)
  })

  it('register.ts does not know what a backup is — the 1.12 contract stays frozen', () => {
    const text = readFileSync('packages/protocol/src/register.ts', 'utf8')
    for (const mod of [...STATE_MODULES, COPY_MODULE]) {
      expect(text, `register.ts imports ${mod}`).not.toContain(`${mod}.js`)
    }
    // It declares the seam and defaults it to refusal, and that is the whole of its knowledge.
    expect(text).toContain('canRegister')
    expect(text).toContain('canRegister = () => false')
  })

  it('copy is exempt — any surface may render a sentence about backups', () => {
    // identity.ts re-exports the restore-failure sentences; that is copy, not state, and it
    // must not be caught by the rule above. Asserted so the exemption is deliberate.
    const identity = readFileSync('packages/protocol/src/identity.ts', 'utf8')
    expect(identity).toContain(`${COPY_MODULE}.js`)
    for (const mod of STATE_MODULES) expect(identity).not.toContain(`${mod}.js`)
  })
})

// The dependency check above proves nothing CAN consult backup state. These prove the read
// surfaces still ANSWER while the gate is fully shut — the same claim from the outside.
//
// Deliberately network-free, so the policy suite is a policy suite: it must pass on a laptop
// with no connection, and a red result here must mean the rule was broken, never that an RPC
// blipped. The live counterpart — real chain reads with the ceremony not started — lives in
// `pool-health.test.ts` beside the other live tests.
describe('the read surfaces answer with no backup state at all (AC1)', () => {
  const closedGate = makeCanRegister(beginCeremony())

  it('the gate really is shut for this test', () => {
    expect(closedGate()).toBe(false)
  })

  it('local key verification works while the ceremony has not started', () => {
    const { privateKey } = generateIdentity()
    const registered = deriveRegisteredPublicKey(privateKey)
    // A behavioral pair: the right key verifies, a wrong one does not — with the gate shut.
    expect(verifyClaimedKey(privateKey, registered)).toBe(true)
    expect(verifyClaimedKey(generateIdentity().privateKey, registered)).toBe(false)
    expect(verifyClaimedKey('not a key', registered)).toBe(false)
  })

  it('the pool health classifiers answer while the ceremony has not started', () => {
    expect(classifyPause(true, true)).toBe(true)
    expect(classifyPause(true, false)).toBe(false)
  })

  it('ONLY registration refuses', async () => {
    const result = await registerSponsored(
      { accountKey: generateIdentity().privateKey, account: { address: '0x1', signer: {} as never } },
      { canRegister: closedGate, preflight: async () => ({ route: 'unregistered' }) },
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('backup-not-confirmed')
  })

  it('and it refuses for the backup reason specifically, not by failing everything', async () => {
    // The same pipeline with the gate OPEN reaches the chain-reading legs, proving the refusal
    // above was the gate and not a broken harness.
    const result = await registerSponsored(
      { accountKey: generateIdentity().privateKey, account: { address: '0x1', signer: {} as never } },
      {
        canRegister: () => true,
        preflight: async () => ({ route: 'already-registered', onChainKey: 7n }),
      },
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('already-registered')
  })
})
