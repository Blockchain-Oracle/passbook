//
// The token lint's suite — and the day-one red-team run the story is only trusted after.
//
// The central case is not "the fixture fails". It is that removing ONE planted hatch removes
// EXACTLY that hatch's finding and nothing else: a gate that fails for the wrong reason, or that
// fails wholesale on any input, is indistinguishable from a working one until the day it matters.
// So every line of the fixture is knocked out in turn and the delta is asserted.
//
// The script is run as a subprocess against real files, so what is tested is what `npm run lint`
// runs, not a re-implementation of it.
//
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/lint-tokens.mjs')
const FIXTURE_TSX = resolve('scripts/fixtures/redteam-tokens.tsx')
const FIXTURE_CSS = resolve('scripts/fixtures/redteam-tokens.css')

const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

function run(args) {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, ...args], { cwd: tmpdir(), encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** `path:line  candidate` — the first line of each finding. */
function findings(out) {
  return [...out.matchAll(/^\S+?:(\d+) {2}(.+)$/gm)].map((m) => ({ line: Number(m[1]), what: m[2] }))
}

function scratchFile(name, source) {
  const dir = mkdtempSync(join(tmpdir(), 'passbook-lint-tokens-'))
  dirs.push(dir)
  const file = join(dir, name)
  writeFileSync(file, source)
  return file
}

describe('lint-tokens: the real tree', () => {
  it('is clean, which is the state it must hold', () => {
    const { code, out } = run([])
    expect(out).toMatch(/token lint: \d+ file\(s\) clean/)
    expect(code).toBe(0)
  })

  it('accepts a class list built entirely from the sheet', () => {
    const file = scratchFile(
      'ok.tsx',
      'export const C = () => <div className="bg-ground text-neutral1 p-s16 gap-s8 rounded-card ' +
        'shadow-short duration-quick ease-snap delay-stagger font-medium text-body3 sm:p-s24 ' +
        '2xs:gap-s4 dark:bg-raised hover:bg-raisedHovered flex items-center w-full truncate" />\n',
    )
    expect(run(['--scan', file]).code).toBe(0)
  })

  it('covers everything the FRAMEWORK scans, not just src/', async () => {
    // The framework's scan root is the nearest package.json to the stylesheet — `apps/web`. A class
    // ANYWHERE under it compiles into the shipped CSS, so a gate scoped to `src/` would leave
    // `smoke/` and `vite.config.ts` inside the framework's reach and outside its own.
    const { filesToScan } = await import('./lint-tokens.mjs')
    const covered = filesToScan().map((f) => f.replace(`${process.cwd()}/`, ''))

    for (const inside of ['apps/web/index.html', 'apps/web/vite.config.ts', 'apps/web/src/main.tsx',
      'apps/web/src/index.css', 'apps/web/smoke/entry.ts', 'apps/web/smoke/index.html']) {
      expect(covered, `${inside} is inside the framework's scan root and must be gated`).toContain(inside)
    }
    // The generated sheet is the one file excluded, and build output never.
    expect(covered).not.toContain('apps/web/design/tokens.css')
    expect(covered.filter((f) => f.startsWith('apps/web/dist'))).toEqual([])
  })

  it('never reports a verdict it did not compute', () => {
    // `--scan` does not run the freshness check, so it must not print that tokens.css is fresh. A
    // gate that reports on a check it skipped is worse than one that skips loudly.
    const file = scratchFile('ok.tsx', 'export const C = () => <div className="bg-ground" />\n')
    const scanned = run(['--scan', file])
    expect(scanned.code).toBe(0)
    expect(scanned.out).not.toMatch(/tokens\.css matches tokens\.yaml/)
    expect(scanned.out).toMatch(/freshness not checked/)

    // The full run DOES compute it, and says so.
    expect(run([]).out).toMatch(/tokens\.css matches tokens\.yaml/)
  })

  it('REFUSES a scan that matched no file, rather than reporting it clean', () => {
    // An empty target is how a typo'd path, a moved directory or a renamed extension turns this
    // gate off while it keeps printing a pass.
    const empty = mkdtempSync(join(tmpdir(), 'passbook-lint-empty-'))
    dirs.push(empty)
    const { code, out } = run(['--scan', empty])
    expect(code).toBe(1)
    expect(out).toMatch(/nothing to scan/)
    expect(out).not.toMatch(/file\(s\) clean/)
  })

  it('rejects the one-character slips the closed vocabulary exists to catch', () => {
    for (const bad of ['bg-grouund', 'p-s5', 'duration-quik', 'rounded-cards', 'text-body5', 'md2:p-s4']) {
      const file = scratchFile('slip.tsx', `export const C = () => <div className="${bad}" />\n`)
      const { code, out } = run(['--scan', file])
      expect(code, bad).toBe(1)
      expect(out, bad).toContain(bad.split(':').pop())
    }
  })
})

describe('lint-tokens: everything the allowlist blesses must actually DO something', () => {
  //
  // The failure this exists to catch, which shipped once: `leading-body2` was on the allowlist and
  // compiled to NO RULE AT ALL. The sheet wipes `--leading-*` and carries line height on the type
  // step, so the class was blessed, written, and silently did nothing — which is precisely the
  // outcome the whole gate exists to prevent, produced BY the gate.
  //
  // So: take one representative candidate per allowlisted family and per static entry, compile them
  // through the real compiler, and fail on any that generates nothing.
  //
  it('generates a real rule for one utility per token family', async () => {
    const { whichGenerate } = await import('./tailwind-probe.mjs')
    const { tokenNames } = await import('./render-design-tokens.mjs')
    const names = tokenNames(readFileSync(resolve('apps/web/design/tokens.yaml'), 'utf8'))

    const candidates = [
      // one per colour-consuming prefix
      'bg-ground', 'text-neutral1', 'border-surface3', 'ring-accent1', 'outline-accent1',
      'divide-surface3', 'fill-neutral1', 'stroke-neutral1', 'decoration-neutral3',
      'accent-accent1', 'caret-accent1', 'from-ground', 'via-ground', 'to-ground',
      'placeholder-neutral3', 'border-t-surface3', 'border-x-surface3',
      // type scale
      `text-${names.text[0]}`, 'text-body3', 'text-buttonLabel1',
      // spacing-consuming
      'p-s4', 'px-s16', 'py-s8', 'pt-s4', 'm-s4', 'mx-s8', 'gap-s12', 'gap-x-s4', 'space-x-s8',
      'w-s40', 'h-s40', 'size-s40', 'min-w-s20', 'max-w-s60', 'basis-s20', 'indent-s4',
      'inset-s4', 'top-s4', 'translate-x-s4', 'scroll-m-s4', 'scroll-p-s4',
      // radii, shadow, motion, font
      'rounded-card', 'rounded-t-card', 'rounded-pill', 'shadow-short', 'shadow-large',
      'duration-quick', 'duration-fastExit', 'delay-stagger', 'ease-snap', 'ease-attention',
      'font-sans', 'font-mono', 'font-book', 'font-medium',
      // the breakpoints, as variants
      ...names.breakpoints.map((b) => `${b}:p-s4`),
      // the dark variant the sheet defines by hand
      'dark:bg-raised',
      // static entries that MUST emit something
      'flex', 'grid', 'hidden', 'relative', 'items-center', 'justify-between', 'w-full',
      'truncate', 'sr-only', 'border', 'border-t', 'decoration-dotted', 'tabular-nums',
      'transition', 'transition-colors', 'overflow-hidden', 'cursor-pointer', 'select-none',
    ]

    const { empty } = await whichGenerate(candidates)
    expect(
      empty,
      `these are on the allowlist but compile to NO RULE — a class the gate approves and the ` +
        `browser ignores:\n  ${empty.join('\n  ')}`,
    ).toEqual([])
  }, 120_000)

  it('goes RED for a family whose namespace the sheet wipes', async () => {
    // The negative control, and the exact case that got through: `--leading-*` is wiped, so any
    // `leading-<step>` produces nothing. If this ever starts generating, the check above has stopped
    // being able to fail.
    const { whichGenerate } = await import('./tailwind-probe.mjs')
    const { empty } = await whichGenerate(['leading-body2', 'leading-body3', 'tracking-heading1'])
    expect(empty).toEqual(['leading-body2', 'leading-body3', 'tracking-heading1'])
  }, 120_000)

  it('rejects those same wiped-namespace classes', () => {
    for (const dead of ['leading-body2', 'tracking-heading1']) {
      const file = scratchFile('dead.tsx', `export const C = () => <div className="${dead}" />\n`)
      expect(run(['--scan', file]).code, dead).toBe(1)
    }
  })

  it('accepts the vocabulary the DESIGN AUTHORITY requires', () => {
    // Every one of these compiles to a real rule and is specified by the design document: the 1px
    // hairline on every card/modal/chip/input, the ratified dotted-underline encoding, the marker
    // class that `group-hover:` needs, and the two base primitives index.css itself defines.
    const required =
      'border border-t decoration-dotted group peer numeric dotted-grid ' +
      'transition duration-quick ease-snap'
    const file = scratchFile('required.tsx', `export const C = () => <div className="${required}" />\n`)
    const { code, out } = run(['--scan', file])
    expect(out).toBe(out) // keep the output in the failure message
    expect(code).toBe(0)
  })

  it('still bans the near-neighbours that carry a value', () => {
    for (const bad of ['border-2', 'decoration-2', 'ring-2', 'border-4']) {
      const file = scratchFile('near.tsx', `export const C = () => <div className="${bad}" />\n`)
      expect(run(['--scan', file]).code, bad).toBe(1)
    }
  })

  it('requires a named duration AND a named curve beside any transition utility', () => {
    // Alone, `transition` emits `var(--tw-duration, 0s)` and `var(--tw-ease, ease)` — the wipe
    // removed both defaults, so it animates instantly on an unratified curve while looking correct.
    const cases = [
      ['transition', 1, /needs a named duration .* and a named curve/],
      ['transition duration-quick', 1, /needs a named curve/],
      ['transition ease-snap', 1, /needs a named duration/],
      ['transition duration-quick ease-snap', 0, null],
      ['transition-colors duration-fast ease-glide', 0, null],
      ['hover:transition duration-quick ease-snap', 0, null],
      ['transition duration-300 ease-snap', 1, /duration-300` is not on the sheet/],
    ]
    for (const [classes, code, message] of cases) {
      const file = scratchFile('motion.tsx', `export const C = () => <div className="${classes}" />\n`)
      const result = run(['--scan', file])
      expect(result.code, classes).toBe(code)
      if (message) expect(result.out, classes).toMatch(message)
    }
  })
})

describe('lint-tokens: the red-team fixture', () => {
  const pristine = run(['--scan', FIXTURE_TSX, FIXTURE_CSS])

  it('fails on day one', () => {
    expect(pristine.code).toBe(1)
    expect(pristine.out).toMatch(/off-sheet value\(s\)/)
  })

  it('reports every planted hatch by name', () => {
    const reported = new Set(findings(pristine.out).map((f) => f.what))
    const planted = [
      // H1 · the three arbitrary-value bypass syntaxes
      'bg-[#f00]', 'bg-[oklch(0.7_0.2_20)]', 'bg-[light-dark(white,black)]', 'bg-(--smuggled)',
      '[background-color:rebeccapurple]', 'rounded-[13px]', 'ease-[cubic-bezier(0.1,0.2,0.3,0.4)]',
      'shadow-[0_0_0_1px_#0f0]',
      // H2 · bare-value motion, immune to every wipe; `0.35s` dodges an `ms` regex entirely
      'duration-300', 'delay-150', 'hover:duration-700', 'duration-[0.35s]',
      '[transition-duration:0.42s]',
      // H3 · bare values with no bracket, no hex, no unit — what a deny-pattern cannot enumerate
      'opacity-45', 'rotate-33', 'scale-125', 'border-2', 'ring-2', 'decoration-2',
      'underline-offset-4', 'brightness-125', 'z-50', 'w-1/2', 'from-10%', 'rounded-full',
      // H4 · the opacity modifier, including the runtime-chosen form
      'bg-ground/50', 'text-neutral1/[var(--o)]',
      // H5 · the hardcoded hairline
      'p-px', 'm-px',
      // H9 · silent no-ops under whole-value shadow indirection
      'shadow-short/50', 'shadow-accent1',
      // the spacing trap, and an arbitrary VARIANT
      'p-4', 'min-[500px]:p-s4',
      // H8 · raw colour never reachable through a class attribute
      '#8C2F1E', '#A32318',
      // a variants map rather than an attribute
      'text-[#ff0000]', 'duration-500',
      // a WRAPPED class list — reported at the lines the classes are on, not the attribute's
      'opacity-30', 'rotate-12', 'tracking-tight',
      // H6/H7/H8 in authored CSS
      'bg-[#ff0000]', '@source inline(', '#8c2f1e', 'rgba(', 'light-dark(', 'color-mix(', 'hsl(',
    ]
    const missed = planted.filter((p) => !reported.has(p))
    expect(missed, `the lint did not report: ${missed.join(', ')}`).toEqual([])
  })

  it('defeats the two naive gates that get proposed instead of an allowlist', () => {
    // The argument this settles: "just grep for hex and for `ms`". Most of the planted hatches
    // carry NEITHER — they are bare integers, fractions, percentages, `/` modifiers and seconds —
    // so both greps report a clean file while the vocabulary is wide open. The subset invisible to
    // both is on its own more than enough to fail this lint, which is the whole case for an
    // allowlist over a deny-pattern.
    const invisibleToBothGreps = findings(pristine.out)
      .map((f) => f.what)
      .filter((w) => !/#[0-9a-f]{3,8}\b/i.test(w) && !w.includes('ms'))

    expect(invisibleToBothGreps.length).toBeGreaterThan(25)
    for (const expected of ['duration-300', 'opacity-45', 'rotate-33', 'p-px', 'bg-ground/50', 'p-4', 'duration-[0.35s]']) {
      expect(invisibleToBothGreps).toContain(expected)
    }
  })

  it('removing ONE hatch removes EXACTLY that hatch, and leaves every other finding standing', () => {
    //
    // The occurrence is knocked out, not the LINE it sits on. Blanking a whole line is the obvious
    // version and it is wrong here: a class list wrapped across several lines is one string literal,
    // so deleting a line inside it destroys the closing quote and takes every OTHER class in that
    // attribute with it — which reads as "the lint collapsed" when nothing collapsed.
    //
    // Removing the occurrence is also a closer match to the criterion: each hatch removed
    // individually, its own failure gone, every other failure untouched — including the other
    // findings on the same line.
    //
    for (const fixture of [FIXTURE_TSX, FIXTURE_CSS]) {
      const lines = readFileSync(fixture, 'utf8').split('\n')
      const baseline = findings(run(['--scan', fixture]).out)
      expect(baseline.length).toBeGreaterThan(10)

      for (const target of baseline) {
        const knocked = [...lines]
        const before = knocked[target.line - 1]
        expect(before, `${fixture}:${target.line} does not contain ${target.what}`).toContain(target.what)
        knocked[target.line - 1] = before.replace(target.what, '')

        const file = scratchFile(fixture.endsWith('.css') ? 'knocked.css' : 'knocked.tsx', knocked.join('\n'))
        const after = findings(run(['--scan', file]).out)
        const afterKeys = new Set(after.map((f) => `${f.line}:${f.what}`))

        expect(
          afterKeys.has(`${target.line}:${target.what}`),
          `${fixture}:${target.line} — removing "${target.what}" did not remove its finding, so the ` +
            `lint is not reporting what it claims to be reporting`,
        ).toBe(false)

        for (const other of baseline) {
          const key = `${other.line}:${other.what}`
          if (key === `${target.line}:${target.what}`) continue
          // A `what` that occurs twice on one line legitimately loses one of its two findings.
          if (other.what === target.what && other.line === target.line) continue
          // Findings genuinely nest: `bg-[hsl(210_80%_50%)]` is one arbitrary-value finding AND
          // contains the raw-colour finding `hsl(`; `@apply bg-[#ff0000]` is a banned class AND a
          // raw hex. Removing either span necessarily takes the other with it — no edit exists that
          // deletes one and leaves the other, so this is overlap, not collateral damage.
          const nested =
            other.line === target.line &&
            (target.what.includes(other.what) || other.what.includes(target.what))
          if (nested) continue
          expect(
            afterKeys.has(key),
            `${fixture} — removing "${target.what}" from line ${target.line} also removed the ` +
              `unrelated finding "${key}"`,
          ).toBe(true)
        }
      }
    }
  }, 180_000)

  it('reports a WRAPPED class list at the line each class is written on', () => {
    // Attributing a five-line class list to the line the attribute OPENS sends the reader to the
    // wrong place, and — worse — a dedupe keyed on that one line makes two occurrences of the same
    // class look like one and drops the second silently.
    const source = readFileSync(FIXTURE_TSX, 'utf8').split('\n')
    const found = findings(pristine.out)

    for (const what of ['opacity-30', 'rotate-12', 'tracking-tight']) {
      const hits = found.filter((f) => f.what === what)
      expect(hits.length, `${what} was not reported`).toBeGreaterThan(0)
      for (const hit of hits) {
        expect(source[hit.line - 1], `${what} reported at line ${hit.line}, which does not contain it`).toContain(what)
      }
    }
    // The repeated class is on two DIFFERENT lines, so it is two findings, not one.
    const repeated = found.filter((f) => f.what === 'opacity-30')
    expect(repeated).toHaveLength(2)
    expect(new Set(repeated.map((f) => f.line)).size).toBe(2)
  })

  it('is not derailed by an apostrophe in prose', () => {
    // An unpaired `'` in ordinary UI copy ("Don't", "it's") used to open a string literal that ran
    // to end of file, so every comment below it stopped being blanked and its documentation of a
    // banned class became a finding. An EVEN number of apostrophes hides the bug, so this is
    // asserted on the real fixture, which carries an odd one.
    const prose = readFileSync(FIXTURE_TSX, 'utf8')
      .split('\n')
      .findIndex((l) => l.includes("Don't send"))
    expect(prose, 'the fixture no longer carries the apostrophe case').toBeGreaterThan(-1)
    expect(findings(pristine.out).some((f) => f.line === prose + 1)).toBe(false)

    // And the direct case: prose, then a comment that documents a banned class.
    const file = scratchFile(
      'apostrophe.tsx',
      `export const C = () => <p>It's here</p>\n// never write className="bg-red-500" in this project\n`,
    )
    expect(run(['--scan', file]).code).toBe(0)
  })

  it('reports every finding in ONE run rather than one per run', () => {
    // Reporting the first problem only turns a ten-line fix into ten runs, and a reader who fixes
    // the first and stops never learns the other nine exist.
    expect(findings(pristine.out).length).toBeGreaterThan(30)
  })
})

describe('lint-tokens: scope beyond class strings', () => {
  it('sees a raw hex in a JSX style prop', () => {
    const file = scratchFile('style.tsx', 'export const C = () => <div style={{ color: "#ff0000" }} />\n')
    expect(run(['--scan', file]).out).toContain('#ff0000')
  })

  it('sees a raw hex in an SVG presentation attribute', () => {
    const file = scratchFile('icon.svg', '<svg><path fill="#00ff00" stroke="rgb(1,2,3)"/></svg>\n')
    const { code, out } = run(['--scan', file])
    expect(code).toBe(1)
    expect(out).toContain('#00ff00')
    expect(out).toContain('rgb(')
  })

  it('sees a raw hex inside an index.html <style> block', () => {
    const file = scratchFile('page.html', '<html><head><style>body{background:#123456}</style></head></html>\n')
    expect(run(['--scan', file]).out).toContain('#123456')
  })

  it('sees `@apply` of an arbitrary value inside authored CSS', () => {
    const file = scratchFile('hand.css', '.x { @apply bg-[#abcdef] duration-300; }\n')
    const { code, out } = run(['--scan', file])
    expect(code).toBe(1)
    expect(out).toContain('bg-[#abcdef]')
    expect(out).toContain('duration-300')
  })

  it('reads comments as prose, not as code', () => {
    // The lint's own source, this fixture and the shipped stylesheet all EXPLAIN the banned forms.
    // A gate that fails on its own documentation gets disabled within a week.
    const file = scratchFile(
      'commented.tsx',
      '// never write bg-red-500 or duration-300 here\n' +
        '/* and `@source inline(` is banned, as is #ff0000 */\n' +
        'export const C = () => <a href="https://x.test/a//b" className="bg-ground" />\n',
    )
    expect(run(['--scan', file]).code).toBe(0)
  })

  it('does not mistake ordinary strings for class lists', () => {
    const file = scratchFile(
      'prose.tsx',
      'export const COPY = { charset: "UTF-8", kind: "e-mail", id: "step-3-of-5" }\n',
    )
    expect(run(['--scan', file]).code).toBe(0)
  })
})

describe('lint-tokens: the freshness gate is wired into `npm run lint`', () => {
  /**
   * A whole isolated repository, so the RED case never touches the working tree.
   *
   * An earlier version of this test hand-edited the real `tokens.css` and restored it in a
   * `finally`. It passed on its own and failed intermittently under `npm test`, because the test
   * runner runs FILES in parallel and `render-design-tokens.test.mjs` asserts that same file is
   * fresh. A gate's own suite must not be the thing that makes the suite flaky.
   *
   * `node_modules` is symlinked rather than copied: the scripts resolve their `yaml` import by
   * walking up from their own directory, so one link is the whole of what they need.
   */
  function isolatedRepo() {
    const root = mkdtempSync(join(tmpdir(), 'passbook-repo-'))
    dirs.push(root)
    mkdirSync(join(root, 'scripts'), { recursive: true })
    mkdirSync(join(root, 'apps/web/design'), { recursive: true })
    mkdirSync(join(root, 'apps/web/src'), { recursive: true })
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir')
    for (const name of ['lint-tokens.mjs', 'render-design-tokens.mjs']) {
      copyFileSync(resolve('scripts', name), join(root, 'scripts', name))
    }
    for (const name of ['tokens.yaml', 'tokens.css']) {
      copyFileSync(resolve('apps/web/design', name), join(root, 'apps/web/design', name))
    }
    // One clean, on-sheet component. Without a scannable file the lint now REFUSES rather than
    // reporting a clean run over nothing, so an empty tree would fail these cases for the wrong
    // reason — and the reason under test here is freshness.
    writeFileSync(
      join(root, 'apps/web/src/ok.tsx'),
      'export const C = () => <div className="bg-ground p-s16 text-body3" />\n',
    )
    return {
      root,
      css: join(root, 'apps/web/design/tokens.css'),
      run: () => {
        try {
          return {
            code: 0,
            out: execFileSync('node', [join(root, 'scripts/lint-tokens.mjs')], { cwd: tmpdir(), encoding: 'utf8' }),
          }
        } catch (e) {
          return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
        }
      },
    }
  }

  it('is clean when the copy is fresh, so the RED case below means something', () => {
    const repo = isolatedRepo()
    expect(repo.run().code).toBe(0)
  })

  it('goes RED on a hand-edited tokens.css and says which file to edit instead', () => {
    const repo = isolatedRepo()
    writeFileSync(
      repo.css,
      readFileSync(repo.css, 'utf8').replace('--color-ground: #FCFAF6;', '--color-ground: #BADBAD;'),
    )
    const { code, out } = repo.run()
    expect(code).toBe(1)
    expect(out).toMatch(/tokens\.css` is STALE/)
    expect(out).toMatch(/Do not hand-edit tokens\.css; edit tokens\.yaml/)
  })

  it('goes RED when tokens.yaml moves and nobody re-rendered, naming the SOURCE HASH', () => {
    // A yaml edit that emits NOTHING — a comment. The only line of the sheet that can differ is the
    // banner's hash, and reporting that as "line 5 differs" sends the reader to a comment instead
    // of telling them what happened. This is the case that has to say "the source hash changed".
    const repo = isolatedRepo()
    const yaml = join(repo.root, 'apps/web/design/tokens.yaml')
    writeFileSync(yaml, `${readFileSync(yaml, 'utf8')}# a note the generator does not emit\n`)
    const { code, out } = repo.run()
    expect(code).toBe(1)
    expect(out).toMatch(/the source hash changed/)
    expect(out).not.toMatch(/first difference at line/)
  })
})
