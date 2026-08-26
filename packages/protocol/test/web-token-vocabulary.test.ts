import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

//
// `cn()` HAS TO KNOW EVERY TOKEN NAME, AND NOTHING MAKES THAT TRUE BY ITSELF.
//
// `apps/web/src/lib/cn.ts` teaches `tailwind-merge` which `text-*` classes are SIZES and which are
// COLOURS, because this app wiped Tailwind's default vocabulary and both look alike. The lists are
// hand-written; the token sheet is generated. Add a colour to `tokens.yaml` and `cn()` silently
// stops knowing about it — and the failure is invisible: no error, no missing rule, just a class
// that loses a merge it should have won.
//
// So this walks the generated sheet and holds the lists to it. It reads both files as TEXT rather
// than importing them: `cn.ts` pulls in `clsx` and `tailwind-merge` from the web app's own
// dependency tree, and a protocol test has no business resolving those. Same device
// `disclosure-gate.test.ts` uses to read `index.css`.
//
// It lives HERE because `vitest.config.ts` collects `packages/*/test/**` only. A test written
// beside the file it checks is a test no runner executes.
//

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const TOKENS_CSS = `${ROOT}apps/web/design/tokens.css`
const CN_TS = `${ROOT}apps/web/src/lib/cn.ts`

/** The `--color-x: …` keys the generated sheet declares, deduped, in sheet order. */
function declaredColors(): string[] {
  const css = readFileSync(TOKENS_CSS, 'utf8')
  const seen = new Set<string>()
  for (const match of css.matchAll(/--color-([A-Za-z0-9]+)\s*:/g)) seen.add(match[1]!)
  return [...seen]
}

/** The `--text-x: …` keys, excluding the `--text-x--line-height` / `--font-weight` sub-keys. */
function declaredTextSizes(): string[] {
  const css = readFileSync(TOKENS_CSS, 'utf8')
  const seen = new Set<string>()
  for (const match of css.matchAll(/--text-([A-Za-z0-9]+)\s*:/g)) seen.add(match[1]!)
  return [...seen]
}

/** The members of one exported `as const` array in `cn.ts`, read as text. */
function listedIn(constName: string): string[] {
  const source = readFileSync(CN_TS, 'utf8')
  const block = source.match(new RegExp(`export const ${constName} = \\[([^\\]]*)\\]`))
  if (!block) throw new Error(`cn.ts no longer exports \`${constName}\` as an array literal`)
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

describe('the sweep is not vacuous', () => {
  it('found both files and they are not empty', () => {
    // A walk that silently found nothing is a guard that passes by doing nothing.
    expect(declaredColors().length).toBeGreaterThan(20)
    expect(declaredTextSizes().length).toBeGreaterThan(10)
    expect(listedIn('COLOR_TOKENS').length).toBeGreaterThan(20)
  })
})

describe('cn() knows the whole token vocabulary', () => {
  it('lists every colour the design authority declares', () => {
    // Sorted on both sides: the sheet groups by theme and `cn.ts` reads top to bottom, so order
    // is not the contract — membership is.
    expect(listedIn('COLOR_TOKENS').sort()).toEqual(declaredColors().sort())
  })

  it('lists every type step the design authority declares', () => {
    expect(listedIn('TEXT_SIZES').sort()).toEqual(declaredTextSizes().sort())
  })

  it('keeps the two apart, which is the entire reason this file exists', () => {
    // `text-body3` is a size and `text-neutral2` is a colour. If a name ever appeared in both
    // lists, `tailwind-merge` would be taught a contradiction and one of them would lose silently.
    const overlap = listedIn('TEXT_SIZES').filter((t) => listedIn('COLOR_TOKENS').includes(t))
    expect(overlap).toEqual([])
  })
})
