//
// Compiles candidate class names through the REAL Tailwind compiler with the REAL token sheet.
//
// Test-support only — nothing in the build imports this. It exists because the questions that
// matter about a closed vocabulary can only be answered by the compiler: does `bg-red-500` really
// generate nothing after the wipe, and — the one that is easy to get backwards — does every class
// the LINT blesses actually generate something? An allowlist entry that compiles to no rule at all
// is worse than a banned one: the author writes it, the gate approves it, and nothing happens.
//
// It is not named `*.test.mjs`, so the runner does not collect it as a suite.
//
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TAILWIND_ENTRY = join(REPO_ROOT, 'node_modules/tailwindcss/index.css')

/**
 * Builds one stylesheet from `candidates` against `apps/web/design/tokens.css`.
 *
 * @returns {Promise<string>} the compiled CSS
 */
export async function compileCandidates(candidates) {
  const { compile } = await import('tailwindcss')
  const tokens = readFileSync(join(REPO_ROOT, 'apps/web/design/tokens.css'), 'utf8')
  const compiler = await compile(`@import "tailwindcss";\n${tokens}`, {
    base: REPO_ROOT,
    loadStylesheet: async (id) => {
      if (id !== 'tailwindcss') throw new Error(`unexpected @import ${id}`)
      return { path: TAILWIND_ENTRY, base: join(REPO_ROOT, 'node_modules/tailwindcss'), content: readFileSync(TAILWIND_ENTRY, 'utf8') }
    },
  })
  return compiler.build(candidates)
}

/**
 * Compiles the app's REAL entry stylesheet, `apps/web/src/index.css`.
 *
 * Different question from `compileCandidates`: that one asks "does this class produce a rule", this
 * one asks "what does the app's stylesheet actually do to a page". It resolves the three imports the
 * real file carries — the framework, the generated token sheet, and the typeface — so the
 * `@layer base` block that paints `body` is present, which is the whole reason a theme assertion
 * against it means anything.
 */
export async function compileAppStylesheet(candidates = []) {
  const { compile } = await import('tailwindcss')
  const entry = join(REPO_ROOT, 'apps/web/src/index.css')
  const compiler = await compile(readFileSync(entry, 'utf8'), {
    base: join(REPO_ROOT, 'apps/web/src'),
    loadStylesheet: async (id, base) => {
      const path =
        id === 'tailwindcss'
          ? TAILWIND_ENTRY
          : id.startsWith('.')
            ? join(base, id)
            : join(REPO_ROOT, 'node_modules', id)
      return { path, base: join(path, '..'), content: readFileSync(path, 'utf8') }
    },
  })
  return compiler.build(candidates)
}

/**
 * Which candidates produced a rule and which produced nothing.
 *
 * Compared against a BASELINE compile rather than by looking for the class name in the output.
 * Searching for the selector looks obvious and is wrong: the compiler escapes what it emits, so
 * `2xs:p-s4` becomes `.\32 xs\:p-s4` — a leading digit turns into a hex escape plus a SPACE — and a
 * naive lookup reports every responsive utility as dead. Comparing output to the no-candidate
 * baseline needs no escaping rules at all and cannot drift from them.
 *
 * One fresh compiler per candidate is required, not an optimisation to remove: a compiler
 * ACCUMULATES candidates across `build()` calls, so reusing one makes every later comparison include
 * every earlier candidate and reports everything as generating.
 *
 * @returns {Promise<{generated: string[], empty: string[]}>}
 */
export async function whichGenerate(candidates) {
  const baseline = await compileCandidates([])
  const generated = []
  const empty = []
  for (const candidate of candidates) {
    const css = await compileCandidates([candidate])
    ;(css === baseline ? empty : generated).push(candidate)
  }
  return { generated, empty }
}
