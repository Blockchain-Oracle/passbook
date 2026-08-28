//
// The build gates, as a Vite plugin.
//
// These used to be an 874-line wrapper script, and `apps/web` deliberately had no `build` script so
// nobody could reach `vite build` and skip them. Inside the config that problem does not exist:
// there is no door that bypasses the plugin, because the plugin IS the build.
//
// `closeBundle` runs after the artifact is written, which is when reading it is meaningful.
//
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/** JS the browser fetches before first paint: the entry chunk plus everything it modulepreloads. */
const MAX_FIRST_PAINT_BYTES = 700_000
/** Every emitted chunk together. A cap on what the app can ever cost, not on one page. */
const MAX_EAGER_BYTES = 2_400_000
/** Below this, route splitting has silently stopped working and everything is in one chunk. */
const MIN_SPLIT_CHUNKS = 3
/** The prover's hash function. In the entry chunk it is ~200 kB nobody asked for on first paint. */
const FORBIDDEN_IN_ENTRY = ['poseidon']
/**
 * Names that can only come from a Node module. Their presence means an alias regressed and the page
 * will die at load with `Buffer is not defined` — a failure `vite build` reports as success.
 * `Buffer` itself is deliberately absent: it appears in healthy third-party code often enough to
 * false-fail.
 */
const NODE_ONLY_MARKERS = ['starknet-devnet', 'spawnInstalled', 'api.github.com', 'fileURLToPath']

/**
 * Warnings the build is allowed to emit, by code. Anything else fails.
 *
 * INEFFECTIVE_DYNAMIC_IMPORT is here because `AccountDrawer` is both lazily imported by the account
 * chip and statically reachable from one other place; it is a real finding that has been read and
 * accepted, not noise.
 */
const ALLOWED_WARNING_CODES = new Set(['INEFFECTIVE_DYNAMIC_IMPORT'])

/**
 * Warnings allowed by message, for the ones rolldown emits without a code.
 *
 * The SDK's logger imports `async_hooks`, which Vite externalizes for the browser. It appears once
 * per BUILD rather than per import site, so the count never tracked how many surfaces use the SDK —
 * but a SECOND one would mean the SDK had been duplicated across two `node_modules` roots, adding
 * ~266 kB for nothing, and that shows up nowhere else.
 */
const ALLOWED_WARNING_PATTERNS = [/Module "async_hooks" has been externalized/]

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/** Files the render layer must not touch, and the digest each carried when it was last approved. */
function frozenMoneyProblems(repoRoot) {
  const manifestPath = join(repoRoot, 'scripts/money-frozen.json')
  if (!existsSync(manifestPath)) return ['scripts/money-frozen.json is missing']
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const problems = []
  for (const [relPath, recorded] of Object.entries(manifest)) {
    const full = join(repoRoot, relPath)
    if (!existsSync(full)) {
      problems.push(`${relPath} is frozen but missing — moved or deleted without --update`)
      continue
    }
    const actual = createHash('sha256').update(readFileSync(full)).digest('hex')
    if (actual !== recorded) {
      problems.push(
        `${relPath} changed (${recorded.slice(0, 12)} -> ${actual.slice(0, 12)}). ` +
          `If deliberate, run \`node scripts/assert-money-frozen.mjs --update\` and commit it.`,
      )
    }
  }
  return problems
}

function bundleProblems(outDir) {
  const problems = []
  const js = walk(join(outDir, 'assets')).filter((f) => f.endsWith('.js'))
  if (!js.length) return ['no JavaScript was emitted']

  const total = js.reduce((sum, f) => sum + statSync(f).size, 0)
  if (total > MAX_EAGER_BYTES) {
    problems.push(`${total.toLocaleString()} B of JS, over the ${MAX_EAGER_BYTES.toLocaleString()} B cap`)
  }
  if (js.length < MIN_SPLIT_CHUNKS) {
    problems.push(`only ${js.length} chunk(s) — route splitting has stopped working`)
  }

  const html = readFileSync(join(outDir, 'index.html'), 'utf8')
  const eagerNames = [...html.matchAll(/(?:src|href)="[^"]*?\/([^/"]+\.js)"/g)].map((m) => m[1])
  const eager = js.filter((f) => eagerNames.includes(basename(f)))
  const firstPaint = eager.reduce((sum, f) => sum + statSync(f).size, 0)
  if (firstPaint > MAX_FIRST_PAINT_BYTES) {
    problems.push(
      `${firstPaint.toLocaleString()} B fetched at first paint, over the ` +
        `${MAX_FIRST_PAINT_BYTES.toLocaleString()} B cap, across ${eager.length} chunk(s)`,
    )
  }
  for (const file of eager) {
    const source = readFileSync(file, 'utf8')
    for (const name of FORBIDDEN_IN_ENTRY) {
      if (source.includes(name)) problems.push(`\`${name}\` reached the first-paint chunk ${basename(file)}`)
    }
  }

  const allSource = js.map((f) => readFileSync(f, 'utf8')).join('\n')
  for (const marker of NODE_ONLY_MARKERS) {
    if (allSource.includes(marker)) {
      problems.push(`node-only marker \`${marker}\` is in the bundle — an alias regressed`)
    }
  }
  return problems
}

function stylesheetProblems(outDir) {
  const css = walk(join(outDir, 'assets')).filter((f) => f.endsWith('.css'))
  if (!css.length) return ['no stylesheet was emitted — the design system did not ship']

  const html = readFileSync(join(outDir, 'index.html'), 'utf8')
  if (!css.some((f) => html.includes(basename(f)))) {
    return ['a stylesheet was emitted but index.html links none of it']
  }

  // Lowercased and de-quoted: Tailwind normalises `#E7E6E1` and the minifier drops the quotes in
  // `[data-theme="dark"]`, so a literal check fails on a correct sheet.
  const sheet = css.map((f) => readFileSync(f, 'utf8')).join('\n').toLowerCase().replace(/["']/g, '')
  const required = [
    ['the light ground', '#e7e6e1'],
    ['the dark ground', '#0a0a0a'],
    ['the media-query dark path', 'prefers-color-scheme'],
    ['the pinned dark path', '[data-theme=dark]'],
    ['color-scheme', 'color-scheme'],
  ]
  return required.filter(([, needle]) => !sheet.includes(needle)).map(([what]) => `missing ${what}`)
}

export function passbookGates({ repoRoot, outDir }) {
  const warnings = []
  const allowed = []

  return {
    name: 'passbook-gates',
    apply: 'build',

    // Collected rather than thrown from here: rollup calls this mid-build, and one warning should
    // not hide the others. They are counted in closeBundle, once the whole picture exists.
    onLog(level, log) {
      if (level !== 'warn') return
      const message = log.message ?? ''
      if (ALLOWED_WARNING_CODES.has(log.code ?? '')) return
      if (ALLOWED_WARNING_PATTERNS.some((pattern) => pattern.test(message))) {
        allowed.push(message)
        return
      }
      warnings.push(`${log.code ?? 'WARNING'}: ${message}`)
    },

    closeBundle() {
      const problems = [
        ...frozenMoneyProblems(repoRoot).map((p) => `[money] ${p}`),
        ...warnings.map((w) => `[warning] ${w}`),
        ...bundleProblems(outDir).map((p) => `[bundle] ${p}`),
        ...stylesheetProblems(outDir).map((p) => `[stylesheet] ${p}`),
      ]
      if (problems.length) {
        this.error(`build gates failed:\n  - ${problems.join('\n  - ')}`)
      }
      // A SECOND allowlisted warning is not noise — see ALLOWED_WARNING_PATTERNS. Counted, not hidden.
      if (allowed.length > 1) {
        this.error(
          `build gates failed:\n  - [warning] ${allowed.length} allowlisted warnings, expected 1. ` +
            `A duplicated SDK across two node_modules roots looks exactly like this.`,
        )
      }
      console.log(
        `\n[gates] money frozen · ${allowed.length} allowlisted warning(s), 0 unexpected · ` +
          `bundle within budget · stylesheet shipped`,
      )
    },
  }
}
