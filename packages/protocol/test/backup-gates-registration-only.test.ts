import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, sep } from 'node:path'
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

/**
 * The persistence adapters story 1.8 deferred to story 1.11, and the ONE module each may reach.
 *
 * Not a loosening, and worth being precise about why. Both of the policed modules declare a
 * seam and then ship a refusal in its place, naming 1.11 as the owner of the durable version:
 * `backup-cadence.ts`'s `BackupCadenceStore` / `REFUSING_CADENCE_STORE` ("Story 1.11 owns the
 * durable implementation"), and `backup-gate.ts`'s `persistableCeremonyState` ("THE ONLY THING
 * 1.11 MAY WRITE TO DISK"). A module that implements a declared interface is not a surface
 * consulting backup state — and the failure this rule exists to prevent is a browse, receive
 * or read screen refusing to work because a fail-closed predicate said no. A store that writes
 * a record decides nothing; the test below holds them to that.
 *
 * A PAIR, not a file, so the exemption is as small as the fact it records. `session-key.ts`
 * reaching `backup-cadence`, or a balance tile reaching either, is still caught.
 */
const SEAM_ADAPTERS = new Map([
  ['/protocol/src/session-key.ts', 'backup-gate'],
  ['/protocol/src/session-cadence-store.ts', 'backup-cadence'],
])

/** The exemption a file qualifies for, keyed on where it lives rather than what it is called. */
function exemptModuleFor(path: string): string | undefined {
  // A PATH SUFFIX, not a basename. `session-key.ts` as a bare name exempts a file of that name
  // anywhere the walk reaches — including one added under `packages/relayer/src` later, which
  // would inherit an exemption granted to a different file for a different reason.
  for (const [suffix, mod] of SEAM_ADAPTERS) if (path.endsWith(suffix)) return mod
  return undefined
}

/**
 * The three import forms, as ONE function, used by every rule below.
 *
 * Static `from '…'`, dynamic `import('…')`, and `require('…')`. A rule that only knew about
 * static imports would be satisfied by the one line that most needs catching: a lazy
 * `await import('./backup-cadence.js')` inside a balance tile, which is exactly how a surface
 * would reach for backup state without a visible dependency at the top of the file. A comment
 * mentioning the gate is not a dependency and is not matched.
 */
function importsModule(text: string, mod: string): boolean {
  return [
    `from\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
    `import\\s*\\(\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
    `require\\s*\\(\\s*['"\`][^'"\`]*${mod}(?:\\.[jt]s)?['"\`]`,
  ].some((form) => new RegExp(form).test(text))
}

/**
 * Blanks out comments and string literals, so a rule about CODE only sees code.
 *
 * A heuristic, deliberately, and stated as one: it does not parse TypeScript, and a `/*` inside
 * a string or a backtick containing a nested template will confuse it. What it has to be right
 * about is the two directions a policy test fails silently — a comment that mentions a banned
 * name must not fail the rule, and a string that mentions one must not either, because both are
 * discussion rather than dependency. The `[^:]` before `//` keeps a `https://` inside a URL
 * from swallowing the rest of its line.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/**
 * True when `text` actually USES `name` anywhere in its code.
 *
 * A raw substring search over the whole file gets this wrong in both directions, and both
 * directions matter: a comment explaining why a file does not consult `canRegister` fails the
 * rule for saying so, and — the worse one — matching only imports and calls waves through every
 * other way to reach a function. `states.map(readsAsBackedUp)` never writes the name followed by
 * a parenthesis, and it is exactly the deciding-on-backup-state this guard exists to forbid.
 *
 * So: strip the prose, then match the bare word. Everything left is code, and a name appearing
 * in code is a use however it is spelled.
 */
function usesIdentifier(text: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(stripCommentsAndStrings(text))
}

function sourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    if (!statSync(p).isDirectory()) {
      // Separators normalized on the way out, so every rule below can match on `/…` suffixes
      // and the suite behaves the same on a platform that walks with backslashes.
      if (['.ts', '.tsx', '.js'].includes(extname(p))) out.push(p.split(sep).join('/'))
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
        if (exemptModuleFor(file) === mod) continue
        if (importsModule(text, mod)) offenders.push(`${file} imports ${mod}`)
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * The functions that DECIDE something about backup state, and the module each is defined in.
   *
   * ANCHORED, the way the import-police regexes are: every name is asserted to still exist
   * where it is claimed to. A list of strings policing an absence is vacuous the moment one of
   * them is renamed — the guard keeps passing, having checked for a function nobody has, while
   * the real one is free to spread. A rename now turns this red and the person doing it updates
   * the list, which is the entire point of writing it down.
   */
  const DECIDERS: ReadonlyArray<{ name: string; definedIn: string; anchor: string }> = [
    { name: 'collapseBackupStatus', definedIn: 'backup-cadence.ts', anchor: 'export function collapseBackupStatus(' },
    { name: 'readsAsBackedUp', definedIn: 'backup-cadence.ts', anchor: 'export function readsAsBackedUp(' },
    { name: 'shouldNagForBackup', definedIn: 'backup-cadence.ts', anchor: 'export function shouldNagForBackup(' },
    { name: 'statusFromStore', definedIn: 'backup-cadence.ts', anchor: 'export function statusFromStore(' },
    // The one-call "is this account backed up" answer, and the two due-date questions it
    // composes. These were the conspicuous omission: a store that started calling
    // `readBackupCadence` would be deciding backup posture, which is precisely what the
    // exemption says these files do not do, and the guard could not see it.
    { name: 'readBackupCadence', definedIn: 'backup-cadence.ts', anchor: 'export function readBackupCadence(' },
    { name: 'isCheckDue', definedIn: 'backup-cadence.ts', anchor: 'export function isCheckDue(' },
    { name: 'nextCheckDue', definedIn: 'backup-cadence.ts', anchor: 'export function nextCheckDue(' },
    { name: 'makeCanRegister', definedIn: 'backup-gate.ts', anchor: 'export function makeCanRegister(' },
    { name: 'ceremonyIsComplete', definedIn: 'backup-gate.ts', anchor: 'export function ceremonyIsComplete(' },
    // Not a function — the seam field `register.ts` declares and defaults to refusal. Anchored
    // on the default, which is the line the 1.12 contract test below also depends on.
    { name: 'canRegister', definedIn: 'register.ts', anchor: 'canRegister = () => false' },
  ]

  /** Resolved from the walk's own output, so these rules follow the roots rather than guess. */
  const pathOf = (basename: string) => {
    const found = files.find((f) => f.endsWith(`/${basename}`) || f === basename)
    if (!found) throw new Error(`${basename} is not in the policed source tree`)
    return found
  }

  it('every deciding function named below still exists where it is claimed to', () => {
    for (const { name, definedIn, anchor } of DECIDERS) {
      const text = readFileSync(pathOf(definedIn), 'utf8')
      expect(text, `${name} is no longer defined in ${definedIn} — this guard is checking a ghost`)
        .toContain(anchor)
    }
  })

  it('the exempt seam adapters store backup state and DECIDE nothing with it', () => {
    // What earns the exemption above, checked rather than asserted in a comment. These files
    // may read and write the record; the moment one of them collapses a status, answers "is
    // this account backed up", or produces a gate predicate, it has stopped being a store and
    // the exemption has stopped being true.
    for (const [suffix, mod] of SEAM_ADAPTERS) {
      const path = files.find((f) => f.endsWith(suffix))
      expect(path, `${suffix} is not in the policed source tree`).toBeDefined()
      const text = readFileSync(path!, 'utf8')
      // The exemption is only for the module it names.
      for (const other of STATE_MODULES) {
        if (other === mod) continue
        expect(importsModule(text, other), `${suffix} reaches ${other}`).toBe(false)
      }
      for (const { name } of DECIDERS) {
        expect(usesIdentifier(text, name), `${suffix} uses ${name}`).toBe(false)
      }
    }
  })

  it('the identifier matcher reads code and ignores prose (S18)', () => {
    // Both directions, because a policy test that silently stops matching is worse than none.
    // A comment discussing a banned name must not fail the rule; a value reference that never
    // writes a parenthesis after it must not pass.
    expect(usesIdentifier('// collapseBackupStatus() is deliberately not consulted here', 'collapseBackupStatus')).toBe(false)
    expect(usesIdentifier('/* readBackupCadence is 1.11 territory */', 'readBackupCadence')).toBe(false)
    expect(usesIdentifier("const label = 'readsAsBackedUp'", 'readsAsBackedUp')).toBe(false)
    expect(usesIdentifier('const url = "https://x.test/readBackupCadence"', 'readBackupCadence')).toBe(false)

    expect(usesIdentifier('const ok = collapseBackupStatus(status)', 'collapseBackupStatus')).toBe(true)
    // The one that a call-shaped matcher waves straight through.
    expect(usesIdentifier('const flags = states.map(readsAsBackedUp)', 'readsAsBackedUp')).toBe(true)
    expect(usesIdentifier("import { makeCanRegister } from './backup-gate.js'", 'makeCanRegister')).toBe(true)
    expect(usesIdentifier('const gate = makeCanRegister\nexport { gate }', 'makeCanRegister')).toBe(true)
    // And it does not fire on a longer name that merely contains a shorter one.
    expect(usesIdentifier('const x = makeCanRegisterLater(state)', 'makeCanRegister')).toBe(false)
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
    // Through the SAME function the rule uses, so this proves the shipped matcher rather than
    // a copy of it that could drift into agreeing with a rule that no longer exists.
    const matches = (text: string) => STATE_MODULES.some((mod) => importsModule(text, mod))
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
