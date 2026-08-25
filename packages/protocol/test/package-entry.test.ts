//
// The package's public surface, and the one boundary built into it.
//
// `package.json` was `{name, version, type}` — no `exports`, no `main`, no `types` — so every
// bare `import … from '@strk20/protocol/…'` died with ERR_PACKAGE_PATH_NOT_EXPORTED. Epic 6's
// `apps/web` scaffold opens with exactly that import, so the package needed a public surface.
//
// WHY THE RATIONALE LIVES HERE. The map is a few lines of JSON, and JSON cannot carry a comment.
// Two of its decisions are ABSENCES — things deliberately not written — and an absence with no
// explanation attached is indistinguishable from an oversight. The next person to hit a
// resolution error has an obvious, wrong, one-character fix for each of them. So the reasoning
// lives on the test that enforces it, and the test fails if either absence is filled in.
//
//   THERE IS NO `default` ON `./env`, so `./env` exists under the `node` condition and nowhere
//   else. `env.ts` is the package's ONLY Node-bound module (`node:fs`, `node:path`, `node:url`,
//   `import.meta.url`, `process.cwd()`, `process.loadEnvFile`), and the sweep below is what keeps
//   that "only" true rather than merely believed. Gating it on the condition makes the resolver
//   enforce the Node/browser boundary: a browser build importing it gets a compile error naming
//   the module, instead of a bundler either shimming `node:fs` into something that silently
//   returns nothing or failing deep inside a transitive dependency. Adding
//   `"default": "./src/env.ts"` would restore the resolution and delete the boundary in the same
//   character.
//
//   THERE IS NO `"."` KEY, so `import … from '@strk20/protocol'` is a hard failure. A root entry
//   needs something to point at, and the only candidates are a new `src/index.ts` barrel or one
//   arbitrary module. A barrel is the trap: re-exporting the package would put every module —
//   including `discovery.ts` — behind the ONE import a newcomer writes without thinking, so a
//   consumer that wanted `ACTIVE_NETWORK` would drag in the whole graph. Omitting the key means
//   there is no root import to get wrong.
//
//   WHAT THAT DOES **NOT** BUY, stated plainly because the honest scope is small and an
//   overclaim here would be worse than silence. Omitting the root key removes ONE footgun, not a
//   class of them. `discovery.ts` imports the SDK's `/testing` barrel, which re-exports
//   `devnet.js` — `fs`, `path`, and a spawned devnet process — and `"./*"` publishes `discovery`
//   UNGATED, so `import … from '@strk20/protocol/discovery'` reaches that contamination and
//   compiles clean under browser conditions. Before this map existed no bare specifier resolved
//   at all, so the map genuinely WIDENED that exposure. The contamination is real, unfixed, and
//   owned by story 6-1; it is not gated here because Node consumers legitimately use discovery
//   (`discovery-live.test.ts` among them) and a `node` condition on it would break them.
//
// AND `"./*"` CANNOT BACK-DOOR `./env`. The wildcard publishes every module in `src`, so the tempting
// conclusion is that `./env` resolves through it anyway once the `node` condition misses. It does
// not: Node's PACKAGE_IMPORTS_EXPORTS_RESOLVE tries the exact key FIRST and returns that key's
// resolution — an unmatched condition set resolves to null and hard-errors rather than falling
// through to the pattern. That single fact is what the whole boundary rests on, so both browser
// resolvers below prove `constants` resolving and `env` failing IN THE SAME RUN, which is the
// only shape of evidence that separates "the boundary works" from "the package is simply broken
// here". Node's own resolver can only ever watch `./env` SUCCEED — the `node` condition is always
// on in Node and cannot be switched off — so the negative half is tsc's and Vite's to prove.
//
// DO NOT ADD `"./*.js": "./src/*.ts"` TO MAKE `.js` SPECIFIERS WORK. This repo's convention is
// `.js`-suffixed relative imports, so someone will eventually write `@strk20/protocol/env.js`,
// watch it fail, and reach for that one-line fix. It would silently delete the boundary: exact
// keys match exactly, so `./env` does NOT match `./env.js`, the unconditional `./*.js` pattern
// WOULD, and `@strk20/protocol/env.js` would then resolve under EVERY condition including a
// browser build's. The current behaviour — a `.js` specifier resolving to a nonexistent
// `src/*.js.ts` — is pinned below precisely so that this stays a visible failure.
//

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// DERIVED FROM THIS FILE, not from `process.cwd()`. Every path below used to assume vitest was
// invoked from the repo root; run the suite from anywhere else and the fixtures silently pointed
// at nothing. `packages/protocol/test/` -> repo root, the same shape `env.ts` itself uses.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const PROTOCOL_SRC = join(REPO_ROOT, 'packages/protocol/src')
const PROTOCOL_PKG = join(REPO_ROOT, 'packages/protocol/package.json')
/** The repo's own tsc, not whatever `npx` might find — the compiler CI runs is the one under test. */
const TSC = join(REPO_ROOT, 'node_modules/typescript/bin/tsc')

/** Every module the wildcard publishes, read from disk so the sweeps cannot go stale. */
function srcModules(): string[] {
  return readdirSync(PROTOCOL_SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.slice(0, -'.ts'.length))
    .sort()
}

/**
 * Comments removed, string literals KEPT — for rules that read import specifiers.
 *
 * A specifier only exists as a string, so the string-blanking pass used below would erase the
 * very thing being looked for. Dropping comments is still necessary: this file's own header
 * names `node:fs` several times, and so do the explanatory comments in `env.ts`.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * Comments AND string literals removed — for rules that read global identifiers.
 *
 * `process.` as a bare substring is a trap in prose: "restarts the process. Then…" matches it,
 * and so does an error message quoting a variable name. Globals are code, so they get checked
 * against code only. Same heuristic as the sibling `backup-gates-registration-only.test.ts`,
 * deliberately: one stripping convention in this package, not two that drift.
 */
function stripCommentsAndStrings(source: string): string {
  return stripComments(source)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/** True when a module reaches for anything only Node can provide. */
function isNodeBound(source: string): boolean {
  const specifiers = stripComments(source)
  const code = stripCommentsAndStrings(source)
  return (
    /\bfrom\s*['"]node:/.test(specifiers) ||
    /\b(?:import|require)\s*\(\s*['"]node:/.test(specifiers) ||
    /\bprocess\s*\./.test(code) ||
    /\bimport\s*\.\s*meta\s*\./.test(code)
  )
}

/**
 * A throwaway package that imports ours, compiled by the repo's tsc under a chosen resolver.
 *
 * `node_modules` is a symlink to the REAL one, so `@strk20/protocol` resolves through the same
 * workspace link every consumer uses rather than a copy that could drift from it.
 *
 * The fixture carries its own `{"type":"module"}`. Without it NodeNext classifies these `.ts`
 * files as CommonJS and buries the resolution result under TS1286/TS1479 format errors — the
 * consumer would be answering a different question than the one being asked.
 *
 * `types` FOLLOWS THE RESOLVER, because it is part of what each consumer honestly is. A Node
 * consumer has `@types/node`, and needs them: NodeNext reaches `env.ts`, and checking it without
 * them reports `node:fs` as missing — the module resolving exactly as designed, misread as
 * failure. A browser consumer has no such types, and gets `[]`. Neither setting can affect the
 * gate itself, which is decided by condition matching long before any type is looked up; the
 * bundler cases below prove `./*` still resolving under `[]` while `./env` does not.
 *
 * CREATED AND DESTROYED INSIDE ONE CALL. An earlier version pushed onto a shared array that
 * `afterEach` drained, which is only correct while nothing runs concurrently — a `test.concurrent`
 * added later would have had its fixture deleted out from under it by a neighbour finishing first.
 */
function withFixture<T>(
  moduleResolution: 'nodenext' | 'bundler',
  source: string,
  fn: (root: string) => T,
): T {
  const root = mkdtempSync(join(tmpdir(), 'passbook-entry-'))
  try {
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'junction')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/probe.ts'), source)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'entry-probe', type: 'module' }))
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          // `bundler` resolution requires an ESM module target; NodeNext pairs with itself.
          module: moduleResolution === 'bundler' ? 'ESNext' : 'NodeNext',
          moduleResolution,
          target: 'ES2023',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: moduleResolution === 'nodenext' ? ['node'] : [],
          verbatimModuleSyntax: true,
        },
        include: ['src'],
      }),
    )
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Compiles a fixture and returns tsc's exit code with its diagnostics. Non-zero is expected here. */
function tsc(moduleResolution: 'nodenext' | 'bundler', source: string): { code: number; out: string } {
  // PREFLIGHT, because the alternative is a lie. A missing compiler makes the spawn fail, the
  // diagnostics come back empty, and the assertions below report "expected [] to equal
  // ['error TS2322']" — a toolchain miss wearing the costume of a resolution regression, which
  // is the exact confusion this file's header exists to prevent.
  if (!existsSync(TSC)) throw new Error(`the repo's tsc is missing at ${TSC} — run \`npm install\``)
  return withFixture(moduleResolution, source, (root) => {
    const r = spawnSync(process.execPath, [TSC, '--project', root], { encoding: 'utf8' })
    if (r.error) throw new Error(`could not run tsc: ${r.error.message}`)
    // BOTH STREAMS. tsc writes diagnostics to stdout but crashes to stderr, and a test asserting
    // "output is empty" while ignoring stderr would call a compiler crash a clean compile.
    return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  })
}

/** The diagnostic codes tsc reported, deduplicated — assertions here are about kind, not count. */
function codes(out: string): string[] {
  return [...new Set(out.match(/error TS\d+/g) ?? [])].sort()
}

/**
 * Every module tsc could not resolve, by name.
 *
 * The load-bearing matcher of the browser sweep. Asserting only on `codes()` is not enough:
 * a `node:fs` import added to `balances.ts` also reports TS2307, so the code set would still read
 * `['error TS2307']` and the sweep would pass while the boundary leaked. The NAMES are what
 * distinguish "env is gated, as designed" from "a second module just went Node-bound".
 */
function missingModules(out: string): string[] {
  return [...new Set([...out.matchAll(/Cannot find module '([^']+)'/g)].map((m) => m[1]!))].sort()
}

/**
 * Node's OWN resolver, in a real subprocess.
 *
 * Deliberately not vitest's: inside a test, `import.meta.resolve` is whatever Vite rewrote it
 * to, which would prove that Vite agrees with Vite. `import.meta.resolve` runs the real
 * PACKAGE_EXPORTS_RESOLVE algorithm without executing the target, so it answers the resolution
 * question for TypeScript sources Node would otherwise have to strip and run.
 */
function nodeResolves(specifiers: string[]): Record<string, string> {
  const script = `
    const out = {}
    for (const s of ${JSON.stringify(specifiers)}) {
      try { out[s] = import.meta.resolve(s) } catch (e) { out[s] = 'THREW ' + e.code }
    }
    console.log(JSON.stringify(out))
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  })
  if (r.error) throw new Error(`could not run node: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`node exited ${r.status}: ${r.stderr}`)
  // THE LAST NON-EMPTY LINE, not the whole stream. A loader, a deprecation notice, or anything
  // NODE_OPTIONS injects prints ahead of the payload, and `JSON.parse` on the lot throws a bare
  // SyntaxError that says nothing about what actually went wrong.
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '')
  const last = lines.at(-1)
  if (!last) throw new Error(`node printed no output; stderr: ${r.stderr}`)
  try {
    return JSON.parse(last) as Record<string, string>
  } catch {
    throw new Error(`could not parse node's output as JSON: ${last}`)
  }
}

describe('the exports map is the shape the boundary depends on', () => {
  // IN beforeAll, NOT THE DESCRIBE BODY. Reading a file during collection turns any failure into
  // a file-level collect error with no test names attached, so a missing manifest would look like
  // the suite itself being broken rather than the one fact it was checking.
  let pkg: {
    name: string
    type: string
    private?: boolean
    scripts?: Record<string, string>
    exports: Record<string, unknown>
  }
  beforeAll(() => {
    pkg = JSON.parse(readFileSync(PROTOCOL_PKG, 'utf8'))
  })

  it('still identifies the package the rest of the repo imports', () => {
    expect(pkg.name).toBe('@strk20/protocol')
    // The map's targets are bare `.ts` paths with no build step behind them; `type: module`
    // is what makes them ESM rather than CommonJS once a consumer actually loads one.
    expect(pkg.type).toBe('module')
  })

  it('is private — it carries a version and an exports map but is never published', () => {
    // Without this the manifest reads as publishable: a `version`, a public `exports` map, and no
    // `files` field, which means the tarball would be the entire directory. It is a workspace
    // package reached through a symlink, exactly like the root manifest that also sets this.
    expect(pkg.private).toBe(true)
  })

  it('publishes every module by subpath, straight from src, with no build step', () => {
    expect(pkg.exports['./*']).toBe('./src/*.ts')
  })

  it('exposes its own package.json, which the wildcard would otherwise mangle', () => {
    // `"./*"` alone sends `@strk20/protocol/package.json` to `./src/package.json.ts`, which does
    // not exist. Tooling that reads a dependency's manifest expects this exact standard key.
    expect(pkg.exports['./package.json']).toBe('./package.json')
  })

  it('gates env on the node condition ALONE — the absent default IS the boundary', () => {
    expect(pkg.exports['./env']).toEqual({ node: './src/env.ts' })
    // Spelled out as its own assertion because this is the one-character regression: a `default`
    // here resolves env everywhere and silently deletes the browser boundary the suite enforces.
    expect(Object.keys(pkg.exports['./env'] as object)).toEqual(['node'])
  })

  it('has NO root key — see the header: one import nobody should be able to write', () => {
    expect(pkg.exports['.']).toBeUndefined()
    expect('main' in pkg).toBe(false)
  })

  it('has no `.js` wildcard — see the header: it would resolve env under every condition', () => {
    // The tempting one-line "fix" for the pinned `.js` behaviour further down. It would match
    // `./env.js` unconditionally and delete the gate, so its ABSENCE is pinned here.
    expect(pkg.exports['./*.js']).toBeUndefined()
  })
})

describe('only one module in the package is Node-bound (the premise the gate rests on)', () => {
  // The gate names ONE module. That is only a boundary while it is also the complete list —
  // gating `env` while `balances.ts` quietly grows a `node:fs` import protects nothing, and the
  // hand-written three-module check this replaced could not see it. Generated from the directory
  // so a new module is in scope the moment it lands.
  const modules = srcModules()

  it('found the source tree it is supposed to be sweeping', () => {
    // A sweep that silently found nothing is a guard that passes by doing nothing.
    expect(modules.length).toBeGreaterThan(20)
    expect(modules).toContain('env')
    expect(modules).toContain('constants')
    expect(modules).toContain('discovery')
  })

  it('EXACTLY env.ts reaches for node: imports, process, or import.meta', () => {
    const nodeBound = modules
      .filter((m) => isNodeBound(readFileSync(join(PROTOCOL_SRC, `${m}.ts`), 'utf8')))
      .sort()
    // If this fails with a new name, the choice is to make that module browser-safe or to gate it
    // in the map like `env` — never to add it to an allowlist here.
    expect(nodeBound).toEqual(['env'])
  })

  it('the detector catches each form it claims to, and ignores prose', () => {
    // A policy test that silently stops matching is worse than no policy test.
    for (const src of [
      `import { existsSync } from 'node:fs'`,
      `import {readFile} from "node:fs/promises"`,
      `const fs = await import('node:fs')`,
      `const fs = require('node:path')`,
      `const dir = process.cwd()`,
      `const here = import.meta.url`,
    ]) expect(isNodeBound(src), src).toBe(true)

    for (const src of [
      `// restarts the process. Then it retries`,
      `/* uses node:fs in the relayer, not here */`,
      `const msg = 'call process.exit to stop'`,
      `const label = "node:fs"`,
      `import { NET } from './constants.js'`,
      // A local named `process` is not the global, but a property read on it would be caught —
      // this is the narrow shape the rule deliberately does not chase.
      `const processed = items.map(x => x)`,
    ]) expect(isNodeBound(src), src).toBe(false)
  })
})

describe("Node resolves the map the way the boundary's reasoning claims", () => {
  // One subprocess, every specifier — so the positive and negative answers below are the same
  // resolver on the same run, not several runs that could disagree for an environmental reason.
  // In beforeAll rather than the describe body: a spawn failure during collection would take the
  // whole file down with no test names to point at.
  let resolved: Record<string, string>
  beforeAll(() => {
    resolved = nodeResolves([
      '@strk20/protocol/constants',
      '@strk20/protocol/env',
      '@strk20/protocol',
      '@strk20/protocol/constants.js',
      '@strk20/protocol/env.js',
    ])
  })

  it('resolves a subpath to the TypeScript source itself (no .js emit exists to point at)', () => {
    expect(resolved['@strk20/protocol/constants']).toMatch(/packages\/protocol\/src\/constants\.ts$/)
  })

  it('resolves env under the node condition, which is why scripts and the relayer are unaffected', () => {
    expect(resolved['@strk20/protocol/env']).toMatch(/packages\/protocol\/src\/env\.ts$/)
  })

  it('refuses the root import at the resolver level, not merely in the type checker', () => {
    expect(resolved['@strk20/protocol']).toBe('THREW ERR_PACKAGE_PATH_NOT_EXPORTED')
  })

  it('sends a `.js` specifier to a file that does not exist — see the header before "fixing" it', () => {
    // This repo writes `.js`-suffixed relative imports everywhere, so someone WILL write
    // `@strk20/protocol/env.js`. Pinned rather than repaired: the wildcard appends `.ts` to the
    // whole specifier, giving `src/env.js.ts`, and the import fails at load. That visible failure
    // is the desired outcome — the `"./*.js"` key that would make it "work" resolves env under
    // every condition and deletes the gate.
    for (const spec of ['@strk20/protocol/constants.js', '@strk20/protocol/env.js']) {
      const url = resolved[spec]!
      expect(url, spec).toMatch(/\.js\.ts$/)
      // `import.meta.resolve` does not stat a wildcard target, so the URL comes back looking
      // plausible. Assert the file is genuinely absent — that is what makes this a dead end and
      // not a second, unguarded door to `env.ts`.
      expect(existsSync(fileURLToPath(url)), `${url} should not exist`).toBe(false)
    }
    // The decisive half: the `.js` spelling does NOT reach the real module.
    expect(resolved['@strk20/protocol/env.js']).not.toMatch(/src\/env\.ts$/)
  })
})

describe('a Node consumer (moduleResolution: NodeNext)', () => {
  it('gets both subpaths AND real types — a wrong assignment is TS2322, not silent any', () => {
    // The type assertion is the load-bearing half. A subpath that resolved to `any` would pass
    // any import-shaped test while giving epic 6 no type safety at all; TS2322 proves the
    // declarations flowed through the map rather than being lost at the package boundary.
    const { code, out } = tsc(
      'nodenext',
      `import { ACTIVE_NETWORK } from '@strk20/protocol/constants'\n` +
        `import { loadDotEnv } from '@strk20/protocol/env'\n` +
        `export const net: string = ACTIVE_NETWORK\n` +
        `export const load = loadDotEnv\n` +
        `export const wrong: number = ACTIVE_NETWORK\n`,
    )
    expect(codes(out)).toEqual(['error TS2322'])
    expect(missingModules(out)).toEqual([])
    expect(code).not.toBe(0)
  })

  it('compiles clean once the deliberate type error is removed', () => {
    // The control for the case above: without the bad assignment there is nothing left to
    // report, which is what makes the single TS2322 meaningful rather than incidental.
    const { code, out } = tsc(
      'nodenext',
      `import { ACTIVE_NETWORK } from '@strk20/protocol/constants'\n` +
        `import { loadDotEnv } from '@strk20/protocol/env'\n` +
        `export const net: string = ACTIVE_NETWORK\n` +
        `export const load = loadDotEnv\n`,
    )
    expect(out.trim()).toBe('')
    expect(code).toBe(0)
  })
})

describe('a browser consumer (moduleResolution: bundler)', () => {
  it('is REFUSED env and GRANTED constants in the same compilation', () => {
    // Both directions in one tsc run. Either half alone is worthless: a passing negative could
    // just mean the package is unresolvable here, and a passing positive says nothing about the
    // gate. Together they show the wildcard is live and still cannot reach `./env`.
    const { code, out } = tsc(
      'bundler',
      `import { ACTIVE_NETWORK } from '@strk20/protocol/constants'\n` +
        `import { loadDotEnv } from '@strk20/protocol/env'\n` +
        `export const net: string = ACTIVE_NETWORK\n` +
        `export const load = loadDotEnv\n`,
    )
    expect(code).not.toBe(0)
    expect(missingModules(out)).toEqual(['@strk20/protocol/env'])
  })

  it('grants EVERY other published subpath — the gate is one leaf, not the package', () => {
    // THE SWEEP. Generated from the directory, never a hand-written list: the hand-written
    // three-module version of this test was satisfied by `constants`, `pool` and `identity`, and
    // would have waved through a `node:fs` import added to any of the other 27.
    //
    // Asserted on module NAMES rather than diagnostic codes, because a newly Node-bound module
    // reports the same TS2307 that the gate does — `missingModules` is what tells the two apart.
    const modules = srcModules()
    expect(modules.length).toBeGreaterThan(20)
    const source =
      modules.map((m, i) => `import * as m${i} from '@strk20/protocol/${m}'`).join('\n') +
      `\nexport const all = [${modules.map((_, i) => `m${i}`).join(', ')}]\n`

    const { out } = tsc('bundler', source)
    // env, and nothing else, is unreachable from a browser build.
    expect(missingModules(out)).toEqual(['@strk20/protocol/env'])
    // And no OTHER kind of diagnostic either — a module using `Buffer` or a node global would
    // surface here as TS2304 rather than a missing module, and must fail this sweep too.
    expect(codes(out)).toEqual(['error TS2307'])
  })

  it('refuses the root import here too', () => {
    const { code, out } = tsc(
      'bundler',
      `import * as protocol from '@strk20/protocol'\nexport const p = protocol\n`,
    )
    expect(code).not.toBe(0)
    expect(missingModules(out)).toEqual(['@strk20/protocol'])
  })
})

describe('a real Vite build resolver, which is the one epic 6 actually ships against', () => {
  // `moduleResolution: bundler` is tsc's MODEL of a bundler, not a bundler. The app is a Vite
  // app, so the boundary has to hold in Vite's resolver specifically — and Vite's condition
  // defaults are its own, not TypeScript's. Resolved through Vite's real plugin container with
  // `ssr: false`, which is the client build's condition set.
  let server: { pluginContainer: { resolveId: (id: string, importer: string, opts: { ssr: boolean }) => Promise<{ id: string } | null> }; close: () => Promise<void> }
  const answers = new Map<string, string>()

  beforeAll(async () => {
    const { createServer } = await import('vite')
    server = (await createServer({
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
    })) as unknown as typeof server
    // An importer inside the repo, so resolution walks the same node_modules a real app would.
    const importer = join(REPO_ROOT, 'apps/web/main.ts')
    for (const id of ['@strk20/protocol/constants', '@strk20/protocol/env', '@strk20/protocol']) {
      try {
        const r = await server.pluginContainer.resolveId(id, importer, { ssr: false })
        answers.set(id, r ? r.id : 'UNRESOLVED')
      } catch (e) {
        answers.set(id, `THREW ${(e as Error).message}`)
      }
    }
  })

  afterAll(async () => {
    await server?.close()
  })

  it('resolves a normal subpath to the TypeScript source', () => {
    expect(answers.get('@strk20/protocol/constants')).toMatch(/packages\/protocol\/src\/constants\.ts$/)
  })

  it('refuses env with the condition error — the boundary holds in the real bundler', () => {
    // The exact message the spec's I/O matrix names. Matched on its distinctive phrase so this
    // stays readable if Vite reformats the surrounding sentence.
    expect(answers.get('@strk20/protocol/env')).toContain('No known conditions for "./env"')
    // Same run, opposite answer: the wildcard is live here, so the refusal is the gate rather
    // than Vite failing to see the package at all.
    expect(answers.get('@strk20/protocol/constants')).not.toContain('THREW')
  })

  it('refuses the root import', () => {
    expect(answers.get('@strk20/protocol')).toContain('Missing "." specifier')
  })
})

describe('relative imports are untouched by any of this', () => {
  it('a relative specifier reaches the SAME module instance the bare subpath does', async () => {
    // Relative specifiers never consult an exports map, so the consumer files that import
    // `../../protocol/src/X.js` today keep working with nothing changed.
    //
    // IDENTITY OF THE NAMESPACE OBJECTS, not of a value read out of them. Comparing
    // `viaBare.ACTIVE_NETWORK` to `viaRelative.ACTIVE_NETWORK` compares the string 'mainnet' to
    // itself, which two SEPARATE instances of the module would also pass. That distinction is
    // not academic here: `rpc.ts` holds a `cached` provider and `session-store.ts` a
    // `probeCounter`, so a duplicated instance would split live module state down the middle
    // while every value-level assertion kept passing.
    const [viaRelative, viaBare] = await Promise.all([
      import('../src/constants.js'),
      import('@strk20/protocol/constants'),
    ])
    expect(viaBare).toBe(viaRelative)
  })

  it('the package really has no build step, so `./src/*.ts` is the only thing to point at', () => {
    // PARSED, not substring-scanned. `expect(raw).not.toContain('"build"')` was wrong in both
    // directions: any future dependency or script whose NAME contains "build" tripped it, while
    // the thing it meant to catch — an emitted bundle sitting beside the sources — sailed past.
    const pkg = JSON.parse(readFileSync(PROTOCOL_PKG, 'utf8')) as {
      scripts?: Record<string, string>
      files?: string[]
    }
    expect(pkg.scripts?.build).toBeUndefined()
    // No emitted output beside the sources, and no dist to point at. If a build ever lands,
    // `./src/*.ts` would silently keep serving the un-built originals — so the premise is
    // checked on disk rather than assumed.
    expect(readdirSync(PROTOCOL_SRC).filter((f) => f.endsWith('.js'))).toEqual([])
    expect(existsSync(join(REPO_ROOT, 'packages/protocol/dist'))).toBe(false)
  })
})
