//
// The token generator's suite, and the design system's contrast gate.
//
// Two rules shape everything below. First, a validation nobody has watched go RED is not a
// validation — so every gate in `render-design-tokens.mjs` is fired here against a source mutated
// to break exactly that one rule. Second, the contrast gate asserts on ALL SIX SURFACES PER MODE,
// never against the page background: the historic failure it closes is a palette "constructed for
// >= 4.5:1" that was only ever true on `ground` and failed on `surface3Solid`, which is the one
// surface the Failed and Blocked chips render on.
//
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import YAML from 'yaml'

import { designProblems } from './assert-design-shipped.mjs'

import {
  render,
  currentYaml,
  checkFreshness,
  tokenNames,
  write,
  SURFACES,
  FACE_WGHT_RANGE,
  TOKENS_YAML,
  TOKENS_CSS,
} from './render-design-tokens.mjs'

const SCRIPT = resolve('scripts/render-design-tokens.mjs')
const SOURCE = currentYaml()

/** A copy of the real source with one surgical edit, so each gate is fired in isolation. */
function mutate(edit) {
  const doc = YAML.parse(SOURCE)
  edit(doc)
  return YAML.stringify(doc)
}

function tempTree() {
  const dir = mkdtempSync(join(tmpdir(), 'passbook-tokens-'))
  const yamlPath = join(dir, 'tokens.yaml')
  const cssPath = join(dir, 'tokens.css')
  copyFileSync(TOKENS_YAML, yamlPath)
  return { dir, yamlPath, cssPath }
}

describe('render-design-tokens: the six validations, each proven to fire', () => {
  it('V1 refuses a colour that exists in one mode only', () => {
    const source = mutate((d) => {
      d.colors.light.brandNew = '#123456'
    })
    expect(() => render(source)).toThrow(/light-only: \[brandNew\]/)
  })

  it('V2 refuses a type step that is not in the grammar', () => {
    for (const bad of ['16px/24px', '16', '16/24/32', '16/24 -0.01', '16/24 @535 extra']) {
      const source = mutate((d) => {
        d.typography.scale.body2 = bad
      })
      expect(() => render(source), bad).toThrow(/is not a type step/)
    }
  })

  it('V3 refuses a line height off the 4px grid', () => {
    const source = mutate((d) => {
      d.typography.scale.body2 = '16/25'
    })
    expect(() => render(source)).toThrow(/line height 25px is off the 4px grid/)
  })

  it('V4 refuses a breakpoint with no name, and a name with no breakpoint', () => {
    expect(() =>
      render(mutate((d) => d.spacing.breakpoints.push(1440))),
    ).toThrow(/1440 has no name/)
    expect(() =>
      render(mutate((d) => { d.spacing.breakpoints = d.spacing.breakpoints.filter((b) => b !== 450) })),
    ).toThrow(/names breakpoint\(s\) \[450\] that the authority no longer declares/)
  })

  it('V5 refuses to invent a missing shadows block', () => {
    expect(() => render(mutate((d) => { delete d.shadows.dark }))).toThrow(/`shadows.dark:` block is missing/)
    expect(() => render(mutate((d) => { d.shadows.light.medium = '' }))).toThrow(/shadows.light.medium/)
  })

  it('V6 resolves `same` against the entry above it, and refuses it on the first entry', () => {
    // Resolution: `quick` inherits `glide` from `quicker` above it, and still renders.
    const resolved = render(mutate((d) => { d.motion.quick.easing = 'same' }))
    expect(resolved).toMatch(/--transition-duration-quick: 200ms;/)

    // The first entry has nothing above it to resolve against — that is the hard failure.
    expect(() => render(mutate((d) => { d.motion.simple.easing = 'same' }))).toThrow(
      /"same" refers to the entry above it, and this is the FIRST entry/,
    )

    // An easing name that the `easings:` block does not declare would emit an invalid value the
    // browser drops in silence, leaving the transition on the UA default.
    expect(() => render(mutate((d) => { d.motion.quick.easing = 'whoosh' }))).toThrow(
      /easing "whoosh" is not declared in the `easings:` block/,
    )
  })

  it('V7 refuses a weight outside the shipped face\'s axis, which clamps rather than errors', () => {
    expect(() => render(mutate((d) => { d.typography.weights = [485, 800] }))).toThrow(
      /weight 800 is outside the shipped face's axis \(100–700\)/,
    )
    expect(() => render(mutate((d) => { d.typography.scale.buttonLabel1 = '18/24 @900' }))).toThrow(
      /weight 900 is outside the shipped face's axis/,
    )
  })

  it('V8 refuses a padding or gap value the spacing scale does not carry', () => {
    expect(() => render(mutate((d) => d.spacing.padding.push(7)))).toThrow(/7 is not on `spacing.scale`/)
  })

  it('refuses a length that would have to be rounded', () => {
    expect(() => render(mutate((d) => { d.rounded.card = 16.5 }))).toThrow(/not a whole number of pixels/)
  })
})

describe('render-design-tokens: determinism', () => {
  it('is byte-identical across two runs in FRESH processes', () => {
    // In-process re-renders share module state and would pass even if the generator kept a counter.
    // Two child processes is what actually proves there is no clock, no hash of a mutable value and
    // no iteration-order surprise in the output.
    const once = execFileSync('node', ['-e', `import('${SCRIPT}').then(async (m) => process.stdout.write(m.render(m.currentYaml())))`], { encoding: 'utf8' })
    const twice = execFileSync('node', ['-e', `import('${SCRIPT}').then(async (m) => process.stdout.write(m.render(m.currentYaml())))`], { encoding: 'utf8' })
    expect(once).toBe(twice)
    expect(once).toBe(readFileSync(TOKENS_CSS, 'utf8'))
  })

  it('carries the SOURCE HASH and never a timestamp', () => {
    const css = render(SOURCE)
    expect(css).toMatch(/sha256 [0-9a-f]{64}/)
    // A timestamp would make every regeneration a diff and turn the freshness gate into
    // "who ran it last".
    expect(css).not.toMatch(/\b20\d\d-\d\d-\d\d\b/)
    expect(css).not.toMatch(/\bGMT\b|\bUTC\b/)
  })

  it('emits LF only and exactly one trailing newline', () => {
    const css = render(SOURCE)
    expect(css.includes('\r')).toBe(false)
    expect(css.endsWith('\n')).toBe(true)
    expect(css.endsWith('\n\n')).toBe(false)
  })

  it('writes nothing at import time', () => {
    const before = readFileSync(TOKENS_CSS, 'utf8')
    execFileSync('node', ['-e', `import('${SCRIPT}')`], { encoding: 'utf8' })
    expect(readFileSync(TOKENS_CSS, 'utf8')).toBe(before)
  })
})

describe('render-design-tokens: the freshness gate', () => {
  it('is fresh on the committed tree', () => {
    expect(checkFreshness().fresh).toBe(true)
  })

  it('goes RED on a hand-edited sheet, and names the first differing line', () => {
    const { dir, yamlPath, cssPath } = tempTree()
    try {
      write({ yamlPath, cssPath })
      const lines = readFileSync(cssPath, 'utf8').split('\n')
      const target = lines.findIndex((l) => l.includes('--color-ground:'))
      lines[target] = '  --color-ground: #BADBAD;'
      writeFileSync(cssPath, lines.join('\n'))

      const result = checkFreshness({ yamlPath, cssPath })
      expect(result.fresh).toBe(false)
      expect(result.hashOnly).toBe(false)
      expect(result.firstDiffLine).toBe(target + 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a moved SOURCE as a hash change, not as "line 5 differs"', () => {
    // The known cosmetic defect this closes: when the yaml changes, the FIRST differing line is
    // the banner's hash, and reporting line 5 sends the reader to a comment.
    const { dir, yamlPath, cssPath } = tempTree()
    try {
      write({ yamlPath, cssPath })
      writeFileSync(yamlPath, `${readFileSync(yamlPath, 'utf8')}\n# a trailing comment\n`)
      const result = checkFreshness({ yamlPath, cssPath })
      expect(result.fresh).toBe(false)
      expect(result.hashOnly).toBe(true)
      expect(result.firstDiffLine).toBe(null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  //
  // A whole isolated repository, because the CLI resolves its paths from its own location and the
  // RED case must never touch the working tree — the runner runs test FILES in parallel and other
  // files assert that the real sheet is fresh.
  //
  function isolatedRepo() {
    const root = mkdtempSync(join(tmpdir(), 'passbook-render-'))
    mkdirSync(join(root, 'scripts'), { recursive: true })
    mkdirSync(join(root, 'apps/web/design'), { recursive: true })
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir')
    copyFileSync(SCRIPT, join(root, 'scripts/render-design-tokens.mjs'))
    for (const name of ['tokens.yaml', 'tokens.css']) {
      copyFileSync(resolve('apps/web/design', name), join(root, 'apps/web/design', name))
    }
    return {
      root,
      css: join(root, 'apps/web/design/tokens.css'),
      yaml: join(root, 'apps/web/design/tokens.yaml'),
      run: (...args) => {
        try {
          return {
            code: 0,
            out: execFileSync('node', [join(root, 'scripts/render-design-tokens.mjs'), ...args], { encoding: 'utf8' }),
          }
        } catch (e) {
          return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
        }
      },
    }
  }

  it('exits 0 from `--check` when the sheet is fresh', () => {
    const repo = isolatedRepo()
    try {
      const { code, out } = repo.run('--check')
      expect(code).toBe(0)
      expect(out).toMatch(/tokens\.css matches/)
    } finally {
      rmSync(repo.root, { recursive: true, force: true })
    }
  })

  it('exits 1 from `--check` with the house message when the sheet is stale', () => {
    // This case had never been executed: the test that claimed it ended on `expect(code).toBe(0)`
    // against the real, fresh tree, so the stale CLI path — print `staleMessage`, exit 1 — was
    // reachable by no test at all.
    const repo = isolatedRepo()
    try {
      writeFileSync(repo.css, readFileSync(repo.css, 'utf8').replace('--color-ground: #FCFAF6;', '--color-ground: #BADBAD;'))
      const { code, out } = repo.run('--check')
      expect(code).toBe(1)
      expect(out).toMatch(/tokens\.css` is STALE/)
      expect(out).toMatch(/first difference at line \d+/)
      expect(out).toMatch(/Do not hand-edit tokens\.css; edit tokens\.yaml/)
    } finally {
      rmSync(repo.root, { recursive: true, force: true })
    }
  })

  it('exits 1 from `--check` naming the SOURCE HASH when only the yaml moved', () => {
    const repo = isolatedRepo()
    try {
      writeFileSync(repo.yaml, `${readFileSync(repo.yaml, 'utf8')}# a note the generator does not emit\n`)
      const { code, out } = repo.run('--check')
      expect(code).toBe(1)
      expect(out).toMatch(/the source hash changed/)
      expect(out).not.toMatch(/first difference at line/)
    } finally {
      rmSync(repo.root, { recursive: true, force: true })
    }
  })

  it('exits 1 from the CLI when the yaml cannot render, naming the key', () => {
    const repo = isolatedRepo()
    try {
      writeFileSync(repo.yaml, readFileSync(repo.yaml, 'utf8').replace('body3: "14/20"', 'body3: "14/21"'))
      const { code, out } = repo.run()
      expect(code).toBe(1)
      expect(out).toMatch(/typography\.scale\.body3/)
      expect(out).toMatch(/off the 4px grid/)
    } finally {
      rmSync(repo.root, { recursive: true, force: true })
    }
  })
})

describe('render-design-tokens: the cascade-layer law', () => {
  const css = render(SOURCE)

  it('puts the light sheet in @theme and BOTH dark sheets outside any layer', () => {
    // The mixed shape — light unlayered, dark layered — yields a permanently-light app with no
    // error anywhere, because an unlayered rule beats a layered one at any specificity.
    expect(css).not.toMatch(/@layer\b/)
    expect(css).toMatch(/@theme static \{/)
    // The DARK SHEET's media query, not the `@custom-variant` block's — that one also opens with
    // `@media (prefers-color-scheme: dark)` and sits above `@theme`.
    const media = css.indexOf('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"])')
    const pinned = css.indexOf(':root[data-theme="dark"] {')
    expect(media).toBeGreaterThan(-1)
    expect(media).toBeGreaterThan(css.indexOf('@theme static {'))
    expect(pinned).toBeGreaterThan(media)
  })

  it('emits the two dark arms byte-identically apart from their selector', () => {
    // Read to the line that closes the block, at whatever indentation it carries: the media arm is
    // indented one level and a naive `indexOf('\n}')` walks past its closing brace.
    const body = (selector) => {
      const lines = css.split('\n')
      const start = lines.findIndex((l) => l.trim() === `${selector} {`)
      const end = lines.findIndex((l, i) => i > start && l.trim() === '}')
      return lines.slice(start + 1, end).map((l) => l.trim()).join('\n')
    }
    expect(body(':root:not([data-theme="light"])')).toBe(body(':root[data-theme="dark"]'))
  })

  it('flips `color-scheme`, which is the only thing that reaches native controls', () => {
    expect(css).toMatch(/:root \{[\s\S]*?color-scheme: light;/)
    expect(css.match(/color-scheme: dark;/g)).toHaveLength(2)
  })

  it('gives every shadow whole-value indirection with a literal fallback', () => {
    // A typo in the inner var name yields `box-shadow: none` app-wide and no error, so the literal
    // fallback is hygiene rather than belt-and-braces.
    for (const name of ['short', 'medium', 'large']) {
      expect(css).toMatch(new RegExp(`--shadow-${name}: var\\(--sh-${name}, 0 `))
      expect(css.match(new RegExp(`--sh-${name}:`, 'g'))).toHaveLength(3) // light root + two dark arms
    }
  })
})

describe('render-design-tokens: the sheet says exactly what the yaml says', () => {
  const css = render(SOURCE)
  const names = tokenNames(SOURCE)
  const doc = YAML.parse(SOURCE)

  it('defines every name it advertises, and advertises every name it defines', () => {
    const defined = new Set([...css.matchAll(/^ +(--[a-zA-Z0-9-]+(?:--[a-z-]+)?):/gm)].map((m) => m[1]))
    const expected = [
      ...names.colors.map((c) => `--color-${c}`),
      ...names.text.map((t) => `--text-${t}`),
      ...names.radii.map((r) => `--radius-${r}`),
      ...names.spacing.map((s) => `--spacing-${s}`),
      ...names.breakpoints.map((b) => `--breakpoint-${b}`),
      ...names.durations.map((d) => `--transition-duration-${d}`),
      ...names.easings.map((e) => `--ease-${e}`),
      ...names.weights.map((w) => `--font-weight-${w}`),
      ...names.shadows.map((s) => `--shadow-${s}`),
      '--font-sans', '--font-mono', '--transition-delay-stagger',
    ]
    for (const name of expected) expect(defined, name).toContain(name)
  })

  it('emits no colour value that is not in the yaml', () => {
    // The manual acceptance check, made mechanical: every hex and rgba() on the sheet is one the
    // design authority wrote. The shadow values carry their own inks, so they count as sources too.
    const declared = new Set(
      [
        ...Object.values(doc.colors.light),
        ...Object.values(doc.colors.dark),
        ...Object.values(doc.shadows.light),
        ...Object.values(doc.shadows.dark),
      ]
        .join(' ')
        .match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g)
        .map((v) => v.replace(/\s+/g, '').toLowerCase()),
    )
    for (const found of css.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) ?? []) {
      expect(declared, `${found} is on the sheet but not in tokens.yaml`).toContain(
        found.replace(/\s+/g, '').toLowerCase(),
      )
    }
  })

  it('references the family name the SHIPPED face actually declares', () => {
    // fontsource publishes the variable cut under "<family> Variable". If `--font-sans` named the
    // unsuffixed family the face would simply never apply, and the page would render in the
    // fallback with no error at all.
    const face = readFileSync('node_modules/@fontsource-variable/ibm-plex-sans/wght.css', 'utf8')
    const shipped = face.match(/font-family:\s*'([^']+)'/)[1]
    expect(css).toContain(`--font-sans: '${shipped}',`)
  })

  it('pins FACE_WGHT_RANGE to what the shipped stylesheet declares', () => {
    const face = readFileSync('node_modules/@fontsource-variable/ibm-plex-sans/wght.css', 'utf8')
    const ranges = [...new Set([...face.matchAll(/font-weight:\s*(\d+)\s+(\d+)/g)].map((m) => `${m[1]}-${m[2]}`))]
    expect(ranges).toEqual([`${FACE_WGHT_RANGE[0]}-${FACE_WGHT_RANGE[1]}`])
  })
})

describe('the design system reaches the BUILT artifact', () => {
  //
  // The hole this closes, measured: delete `import './index.css'` from `src/main.tsx` and the lint
  // is green, the wrapped build is green — warning gate, eager budget, every route evaluating,
  // network assertion — and the browser tests are green, while `dist/assets/` contains no `.css` at
  // all. The whole design system vanishes and every gate reports success.
  //
  // `npm run build:web` now runs `designProbe()` in the loaded page and holds it to
  // `designProblems()`. That real end-to-end run is the gate; these cases exist so the VERDICT can
  // be driven red from the suite, on fabricated inputs, without breaking the working tree.
  //
  const expected = { light: '#FCFAF6', dark: '#14110D', family: 'IBM Plex Sans' }
  const healthy = {
    light: { background: 'rgb(252, 250, 246)', colorScheme: 'light', ground: '#FCFAF6', fontFamily: '"IBM Plex Sans Variable", Inter, system-ui, sans-serif', shadow: '0 1px 6px 2px rgba(33,26,18,0.03)' },
    dark: { background: 'rgb(20, 17, 13)', colorScheme: 'dark', ground: '#14110D', fontFamily: '"IBM Plex Sans Variable", Inter, system-ui, sans-serif', shadow: '0 1px 3px 0 rgba(0,0,0,0.12)' },
    styleSheetCount: 1,
  }

  it('passes a healthy artifact', () => {
    expect(designProblems({ cssAssets: ['apps/web/dist/assets/index.css'], probed: healthy, expected })).toEqual([])
  })

  it('agrees with the real values the authority declares', () => {
    // If the fabricated "healthy" fixture drifted from the sheet, every case here would be testing
    // a design system that does not exist.
    const doc = YAML.parse(SOURCE)
    expect(healthy.light.ground).toBe(doc.colors.light.ground)
    expect(healthy.dark.ground).toBe(doc.colors.dark.ground)
    expect(expected.family).toBe(doc.typography.family)
  })

  it('goes RED when the build emitted no stylesheet — the exact deleted-import case', () => {
    const problems = designProblems({ cssAssets: [], probed: healthy, expected })
    expect(problems.join('\n')).toMatch(/emitted NO stylesheet at all/)
  })

  it('goes RED when a stylesheet exists but nothing links it', () => {
    const probed = { ...healthy, styleSheetCount: 0 }
    expect(designProblems({ cssAssets: ['x.css'], probed, expected }).join('\n')).toMatch(/nothing links it/)
  })

  it('goes RED when the token exists but the body does not paint it', () => {
    const probed = { ...healthy, light: { ...healthy.light, background: 'rgb(255, 255, 255)' } }
    const problems = designProblems({ cssAssets: ['x.css'], probed, expected }).join('\n')
    expect(problems).toMatch(/the body painted rgb\(255, 255, 255\), expected rgb\(252, 250, 246\)/)
  })

  it('goes RED when the dark sheet never wins — the permanently-light app', () => {
    // The failure that produces NO error anywhere: a layered dark sheet loses to an unlayered light
    // one forever, and the only visible symptom is that dark mode is light.
    const probed = { ...healthy, dark: { ...healthy.light, colorScheme: 'light' } }
    const problems = designProblems({ cssAssets: ['x.css'], probed, expected }).join('\n')
    expect(problems).toMatch(/dark: --color-ground computed to "#FCFAF6", expected #14110D/)
    expect(problems).toMatch(/dark: color-scheme computed to "light"/)
  })

  it('goes RED when shadows do not re-theme', () => {
    const probed = { ...healthy, dark: { ...healthy.dark, shadow: healthy.light.shadow } }
    expect(designProblems({ cssAssets: ['x.css'], probed, expected }).join('\n')).toMatch(/identical in both themes/)
  })

  it('goes RED when the typeface is not the one that shipped', () => {
    const probed = { ...healthy, light: { ...healthy.light, fontFamily: 'Times' } }
    expect(designProblems({ cssAssets: ['x.css'], probed, expected }).join('\n')).toMatch(/does not name "IBM Plex Sans"/)
  })

  it('goes RED when the probe never ran at all', () => {
    expect(designProblems({ cssAssets: ['x.css'], probed: undefined, expected }).join('\n')).toMatch(/did not run in the page/)
  })
})

describe('check-tokens-verbatim: the copy really is the authority', () => {
  const CHECKER = resolve('scripts/check-tokens-verbatim.mjs')
  const runChecker = (args = []) => {
    try {
      return { code: 0, out: execFileSync('node', [CHECKER, ...args], { encoding: 'utf8' }) }
    } catch (e) {
      return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
    }
  }

  it('passes on the real tree, where the authority is present', () => {
    const { code, out } = runChecker()
    expect(code).toBe(0)
    expect(out).toMatch(/tokens\.yaml is verbatim from/)
  })

  it('REFUSES with exit 2 when the authority is absent — never a silent skip', () => {
    // The whole reason this script exists as a separate local gate. "The authority is missing" and
    // "the copy is correct" are different answers, and returning the second when the first is true
    // is how a stale copy gets ratified.
    const { code, out } = runChecker([join(tmpdir(), 'no-such-DESIGN.md')])
    expect(code).toBe(2)
    expect(out).toMatch(/REFUSING to report a verdict/)
  })

  it('REFUSES with exit 2 on a document with no frontmatter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'passbook-authority-'))
    try {
      const path = join(dir, 'DESIGN.md')
      writeFileSync(path, '# a design document with no frontmatter at all\n')
      const { code, out } = runChecker([path])
      expect(code).toBe(2)
      expect(out).toMatch(/has no YAML frontmatter/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 1 on drift, naming the first differing line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'passbook-authority-'))
    try {
      const path = join(dir, 'DESIGN.md')
      const drifted = SOURCE.replace('ground: "#FCFAF6"', 'ground: "#FFFFFF"')
      writeFileSync(path, `---\n${drifted}---\n\n# body\n`)
      const { code, out } = runChecker([path])
      expect(code).toBe(1)
      expect(out).toMatch(/is NOT the verbatim frontmatter/)
      expect(out).toMatch(/first difference at line 4/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── The contrast gate ─────────────────────────────────────────────────────────────────────────

const parseColour = (v) => {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(v.trim())
  if (hex) {
    const n = parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgba = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(v.replace(/\s+/g, ''))
  if (rgba) return [+rgba[1], +rgba[2], +rgba[3], rgba[4] === undefined ? 1 : +rgba[4]]
  throw new Error(`unparseable colour: ${v}`)
}
const composite = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]))
const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
function contrast(fgValue, bgValue) {
  const bg = parseColour(bgValue)
  const a = luminance(composite(parseColour(fgValue), bg))
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

//
// 4.6, not 4.5. Measured against real Chrome paint, a computed ratio within about 0.1 of 4.5 is not
// reliably passing once the browser premultiplies an alpha foreground — so the sheet is held to an
// internal floor with the margin already in it.
//
const FLOOR = 4.6

/** Every token that is ever painted AS text or as a semantic mark on one of the six surfaces. */
const FOREGROUNDS = [
  'neutral1', 'neutral1Hovered', 'neutral2', 'neutral2Hovered', 'neutral3', 'neutral3Hovered',
  'accent1', 'accent1Hovered', 'accent3',
  'settled', 'settledHovered', 'exposed', 'exposedHovered', 'irreversible', 'irreversibleHovered',
]

//
// THE EXEMPTIONS, and the conditions each one survives on.
//
// Every entry is printed on every run. A silent exemption is how a false claim eventually ships —
// the same reasoning `lint-claims.mjs` applies to its disable markers. Each is also self-cleaning:
// an exemption whose cell has climbed back over the floor FAILS as stale, so this list cannot rot
// into a permanent waiver for a bug that was fixed years ago.
//
const EXEMPTIONS = [
  {
    mode: 'light',
    token: 'neutral3',
    surfaces: 'all',
    // No AA floor to hold it to: it measures 2.12–2.18 and cannot be fixed. The alpha that reaches
    // 4.5 (0.63) composites BYTE-IDENTICALLY to neutral2, so raising it deletes the third level
    // rather than rescuing it.
    floor: null,
    requires: 'notYetReal',
    why: 'ratified 2026-08-25: the third text level is carried by a 1px dotted underline, not by grey. neutral3 is a SECONDARY cue and may never be the sole carrier of meaning on a text run.',
  },
  {
    mode: 'light',
    token: 'neutral3Hovered',
    surfaces: 'all',
    floor: null,
    requires: 'notYetReal',
    why: 'the hover state of the same demoted level, and subject to the same ruling.',
  },
  {
    mode: 'dark',
    token: 'neutral3',
    surfaces: 'all',
    floor: null,
    requires: 'notYetReal',
    why: 'as light: the level is structural, not chromatic.',
  },
  {
    mode: 'dark',
    token: 'irreversible',
    surfaces: ['surface3Solid'],
    // This one DOES clear AA — it is a margin waiver, not a standard waiver, and it turns back into
    // a hard failure the moment the value drops under 4.5.
    floor: 4.5,
    requires: null,
    why: 'ratified 2026-08-25 at #FF5E4F, which clears AA on all six dark surfaces (worst 4.52) but sits inside the premultiply margin on surface3Solid. The chip recipe already forbids the status colour from carrying the LABEL — "label: always full text contrast, never the status color" — so on this surface the token paints a 1px border and a tint, where the applicable floor is 3:1.',
  },
]

const exemptionFor = (mode, token, surface) =>
  EXEMPTIONS.find(
    (e) => e.mode === mode && e.token === token && (e.surfaces === 'all' || e.surfaces.includes(surface)),
  )

describe('contrast: every semantic and text token, on all six surfaces, in both modes', () => {
  const doc = YAML.parse(SOURCE)

  it('has a non-chromatic encoding for every structurally-exempted token', () => {
    // The exemption the AC allows is "only where the non-chromatic encoding carries the meaning".
    // That is enforced here rather than trusted: delete the block, or point its colour cue
    // somewhere else, and three exemptions stop being available.
    const nyr = doc.notYetReal
    expect(nyr, 'the `notYetReal:` block is what the neutral3 exemptions stand on').toBeTruthy()
    expect(nyr.encoding).toBe('dotted-underline')
    expect(nyr.colorCue).toBe('neutral3')
    expect(nyr.appliesTo.length).toBeGreaterThan(0)
  })

  for (const mode of ['light', 'dark']) {
    it(`${mode}: no unexempted token falls under ${FLOOR}:1`, () => {
      const palette = doc.colors[mode]
      const failures = []
      for (const token of FOREGROUNDS) {
        const ratios = SURFACES.map((s) => ({ surface: s, ratio: contrast(palette[token], palette[s]) }))
        for (const { surface, ratio } of ratios) {
          if (ratio >= FLOOR) continue
          if (exemptionFor(mode, token, surface)) continue
          const worst = ratios.reduce((a, b) => (a.ratio <= b.ratio ? a : b))
          failures.push(
            `${mode}.${token} is ${ratio.toFixed(2)}:1 on ${surface} (worst surface: ` +
              `${worst.surface} at ${worst.ratio.toFixed(2)}:1, floor ${FLOOR})`,
          )
        }
      }
      expect(failures, failures.join('\n')).toEqual([])
    })
  }

  it('every exemption is still needed, still clears its own floor, and is printed', () => {
    const printed = []
    for (const e of EXEMPTIONS) {
      const palette = doc.colors[e.mode]
      const surfaces = e.surfaces === 'all' ? SURFACES : e.surfaces
      const ratios = surfaces.map((s) => ({ surface: s, ratio: contrast(palette[e.token], palette[s]) }))

      // Stale-exemption gate: if every cell now clears the floor, the waiver has outlived the bug.
      const stillNeeded = ratios.some(({ ratio }) => ratio < FLOOR)
      expect(
        stillNeeded,
        `${e.mode}.${e.token} now clears ${FLOOR}:1 everywhere it is exempted — delete the ` +
          `exemption rather than leaving a standing waiver for a bug that is fixed.`,
      ).toBe(true)

      if (e.floor !== null) {
        for (const { surface, ratio } of ratios) {
          expect(
            ratio,
            `${e.mode}.${e.token} on ${surface} is ${ratio.toFixed(2)}:1, under its own stated ` +
              `floor of ${e.floor} — this exemption waives the premultiply MARGIN, never the standard.`,
          ).toBeGreaterThanOrEqual(e.floor)
        }
      }

      const worst = ratios.reduce((a, b) => (a.ratio <= b.ratio ? a : b))
      printed.push(
        `  ${e.mode}.${e.token} on ${e.surfaces === 'all' ? 'all six surfaces' : e.surfaces.join(', ')} ` +
          `— worst ${worst.ratio.toFixed(2)}:1 @${worst.surface}${e.floor ? ` (own floor ${e.floor})` : ' (no AA floor)'}\n` +
          `      ${e.why}`,
      )
    }
    console.log(`\n${EXEMPTIONS.length} contrast exemption(s), each read and re-checked:\n${printed.join('\n')}\n`)
  })

  it('reproduces the published matrix, so the arithmetic itself is not the thing being trusted', () => {
    // Spot checks against independently measured values, including two that were checked against
    // real Chrome-painted pixels. If this implementation drifts, the whole gate is meaningless.
    const light = YAML.parse(SOURCE).colors.light
    const dark = YAML.parse(SOURCE).colors.dark
    expect(contrast(light.neutral1, light.ground)).toBeCloseTo(16.5, 1)
    expect(contrast(light.neutral2, light.surface3Solid)).toBeCloseTo(4.64, 1)
    expect(contrast(dark.settled, dark.ground)).toBeCloseTo(8.42, 1)
    expect(contrast(dark.exposed, dark.ground)).toBeCloseTo(9.67, 1)
    expect(contrast(dark.irreversible, dark.surface3Solid)).toBeCloseTo(4.52, 2)
  })

  it('goes RED when a token is moved under the floor', () => {
    // The gate itself, fired. Without this the suite above could be asserting nothing at all.
    const palette = YAML.parse(SOURCE).colors.light
    const failures = []
    const broken = { ...palette, settled: '#9ACF9F' } // a green that fails on the lower surfaces
    for (const s of SURFACES) {
      const ratio = contrast(broken.settled, broken[s])
      if (ratio < FLOOR) failures.push(`${s} ${ratio.toFixed(2)}`)
    }
    expect(failures.length).toBeGreaterThan(0)
  })
})
