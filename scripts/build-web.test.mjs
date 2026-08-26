//
// The build gate's own suite — and the three reds it was written from.
//
// `scripts/build-web.mjs` says in its own comment that it evaluates EVERY route. Three defects made
// that untrue the moment the app's real route tree arrives, and all three are the same shape: a
// check that reads a STRING where it should read a STRUCTURE, and therefore keeps passing after the
// thing it was reading stops existing.
//
//   R14  the `fullPaths:` regex read one LINE. The generator prettifies the union across lines at
//        around 13 routes, at which point the line it captures is `| '/'` and the gate evaluates
//        exactly one route while still reporting that it evaluated them all.
//   R15a the error detector grepped the literal `Something went wrong!` — the router's DEFAULT
//        boundary text, which stops existing the moment a route carries its own `errorComponent`.
//   R15b the settle was `waitForTimeout(250)`, which is a race with any error UI that arrives in a
//        lazily-loaded chunk. On one identical artifact, changing only that number flipped the
//        build from exit 0 to exit 1.
//
// So the pre-repair code is REPRODUCED VERBATIM in this file and run on the same fixtures the
// repaired code is run on, side by side, in the same test. A test written after the fix and never
// seen red is the defect this story exists to remove.
//
// Be exact about what those copies are and are not. They are FROZEN SNAPSHOTS of a8869f0 — they
// cannot notice a future regression, because nothing changes them. What guards against regression
// is the other half of each pair: the assertion against the SHIPPED function, on the same input.
// The snapshot's job is to make the failure it fixes legible, and to fail this suite if someone
// ever reintroduces the old shape by editing the real one back.
//
// The browser cases drive the SHIPPED `evaluate()` against a hand-written `dist/` served by the
// same `vite preview` the gate uses. No bundler runs: what is under test is the gate's reading of a
// document, and the documents here are the ones the pillars document measured React produce.
//
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { chromium } from 'playwright-core'

import {
  assertBrowserAvailable,
  assertEvaluatedClean,
  BROWSER_INSTALL_COMMAND,
  evaluate,
  routeLeafFiles,
  routePathsFromGeneratedTree,
} from './build-web.mjs'

// ---- the pre-repair code, verbatim ---------------------------------------------------------------

/**
 * `routePathsFromGeneratedTree` as it stood at a8869f0, `scripts/build-web.mjs:388-399`.
 *
 * Note what `\s*` does here: `\s` matches a newline, so on a prettified block the capture group
 * walks past the end of the `fullPaths:` line and takes the FIRST LINE OF THE UNION instead. That
 * is why the failure is one path rather than zero paths — zero would have been loud.
 */
function preRepairRoutePaths(generatedTreePath) {
  const source = readFileSync(generatedTreePath, 'utf8')
  const line = source.match(/^\s*fullPaths:\s*(.+)$/m)?.[1]
  return [...(line ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/**
 * The count cross-check exactly as `6-3-verified-pillars.md` §3.3 prescribes it.
 *
 * This story ships a corrected form instead, and this function is here to show why: it is wrong in
 * BOTH directions. It counts `_shell.tsx`, which owns no path, and `readdirSync` does not recurse,
 * so it never sees `wallet/receive.tsx` at all.
 */
function prescribedLeafCount(routesDir) {
  return readdirSync(routesDir).filter((f) => f.endsWith('.tsx') && !f.startsWith('__')).length
}

/**
 * The whole of `assertEvaluatedClean`'s render check as it stood at a8869f0 (`:423-433`).
 *
 * Returned rather than thrown so a test can assert on the EMPTY list — "this input produced no
 * complaint" is the red for R15a, and an empty array states it more plainly than a non-throw.
 */
function preRepairRenderedProblems(rendered) {
  const problems = []
  for (const [path, text] of Object.entries(rendered)) {
    if (!text) problems.push(`route ${path} rendered an empty document — nothing mounted there`)
    else if (/Something went wrong!/.test(text)) problems.push(`route ${path} rendered the router's error boundary`)
  }
  return problems
}

// ---- fixtures ------------------------------------------------------------------------------------

/** Resolved from this file, never from `process.cwd()` — the runner's directory is not an input. */
const REPO_ROOT = join(import.meta.dirname, '..')

const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

function scratch(name) {
  const dir = mkdtempSync(join(tmpdir(), `passbook-${name}-`))
  dirs.push(dir)
  return dir
}

/** The six surfaces plus the ancillary routes — the tree 6-3 lands, at its real size. */
const THIRTEEN = [
  '/',
  '/wallet',
  '/chat',
  '/swap',
  '/bridge',
  '/markets',
  '/launch',
  '/settings',
  '/docs',
  '/status',
  '/contracts',
  '/activity/$id',
  '/pay/$address',
]

/**
 * A `routeTree.gen.ts` in the generator's own shape, in either of its two formattings.
 *
 * The `id:` member below the union is not decoration: it holds `'__root__'` and a second copy of
 * every path, so a reader that runs past the end of the block reports too many paths — and one that
 * captures `'__root__'` as a route would send the evaluation to a URL that does not exist.
 */
function generatedTree(paths, { pretty }) {
  const union = pretty ? `\n${paths.map((p) => `    | '${p}'`).join('\n')}` : ` ${paths.map((p) => `'${p}'`).join(' | ')}`
  const ids = pretty
    ? `\n${["'__root__'", ...paths.map((p) => `'${p}'`)].map((i) => `    | ${i}`).join('\n')}`
    : ` ${["'__root__'", ...paths.map((p) => `'${p}'`)].join(' | ')}`
  return `/* eslint-disable */

// This file was automatically generated by TanStack Router.

export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths:${union}
  fileRoutesByTo: FileRoutesByTo
  to:${union}
  id:${ids}
  fileRoutesById: FileRoutesById
}
`
}

/** Writes a `routeTree.gen.ts` + a `routes/` directory beside it, as the plugin lays them out. */
function treeWith({ paths, pretty = true, files }) {
  const src = scratch('route-tree')
  writeFileSync(join(src, 'routeTree.gen.ts'), generatedTree(paths, { pretty }))
  for (const file of files) {
    const full = join(src, 'routes', file)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, '// fixture route file\n')
  }
  return { treePath: join(src, 'routeTree.gen.ts'), routesDir: join(src, 'routes') }
}

/** The route files that back `THIRTEEN`, in the layout the generator would have read them from. */
const THIRTEEN_FILES = [
  '__root.tsx',
  'index.tsx',
  'wallet.tsx',
  'chat.tsx',
  'swap.tsx',
  'bridge.tsx',
  'markets.tsx',
  'launch.tsx',
  'settings.tsx',
  'docs.tsx',
  'status.tsx',
  'contracts.tsx',
  'activity/$id.tsx',
  'pay/$address.tsx',
]

// ---- R14: the block reader -----------------------------------------------------------------------

describe('routePathsFromGeneratedTree: the fullPaths BLOCK, not the fullPaths line (R14)', () => {
  it('THE RED — the shipped single-line regex finds exactly ONE route in a 13-route tree', () => {
    const { treePath } = treeWith({ paths: THIRTEEN, files: THIRTEEN_FILES })

    expect(preRepairRoutePaths(treePath)).toEqual(['/'])

    // Said plainly, because this is the whole story: twelve surfaces, including every one that can
    // throw, were never opened by a gate whose output said it had opened them all.
    expect(preRepairRoutePaths(treePath)).toHaveLength(1)
    expect(THIRTEEN).toHaveLength(13)
  })

  it('reads all 13 paths out of the prettified block', () => {
    const { treePath, routesDir } = treeWith({ paths: THIRTEEN, files: THIRTEEN_FILES })
    expect(routePathsFromGeneratedTree(treePath, routesDir)).toEqual(THIRTEEN)
  })

  it('stops at the end of the block — no `__root__`, no path counted twice', () => {
    const { treePath, routesDir } = treeWith({ paths: THIRTEEN, files: THIRTEEN_FILES })
    const paths = routePathsFromGeneratedTree(treePath, routesDir)

    expect(paths).not.toContain('__root__')
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('still reads the single-line form a small tree emits', () => {
    const { treePath, routesDir } = treeWith({
      paths: ['/', '/settings'],
      pretty: false,
      files: ['__root.tsx', 'index.tsx', 'settings.tsx'],
    })
    expect(routePathsFromGeneratedTree(treePath, routesDir)).toEqual(['/', '/settings'])
  })

  it("reads this repository's own committed tree, with the routes directory defaulted", () => {
    // One argument, the way `smoke-sdk-build.mjs` calls it. A required second parameter would make
    // that call `readdirSync(undefined)` and take `npm run smoke:sdk` down with it.
    //
    // Asserted as PROPERTIES, never as a literal route list. 6-3 adds eleven routes to this tree,
    // and a test that has to be edited to match a healthy unrelated change teaches exactly the
    // habit this suite exists against. Resolved from this file rather than from `process.cwd()`,
    // so it says the same thing whatever directory the runner was started in.
    const paths = routePathsFromGeneratedTree(join(REPO_ROOT, 'apps/web/src/routeTree.gen.ts'))

    expect(paths.length).toBeGreaterThanOrEqual(
      routeLeafFiles(join(REPO_ROOT, 'apps/web/src/routes')).length,
    )
    expect(paths).toContain('/')
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) expect(path.startsWith('/')).toBe(true)
  })

  it('refuses a tree with no fullPaths declaration rather than evaluating nothing', () => {
    const src = scratch('no-full-paths')
    writeFileSync(join(src, 'routeTree.gen.ts'), 'export interface FileRouteTypes {\n  to: never\n}\n')
    expect(() => routePathsFromGeneratedTree(join(src, 'routeTree.gen.ts'))).toThrow(/fullPaths/)
  })
})

// ---- the count cross-check, and why §3.3's form is not the one that ships -------------------------

describe('the route-count cross-check', () => {
  it('exits on a shortfall, naming both numbers, BEFORE anything is evaluated', () => {
    // The extraction has collapsed; the files have not. This is what the R14 failure looks like
    // from the inside, and it throws out of the extractor — so `main()` never reaches `evaluate()`
    // and no subset is ever quietly visited.
    const { treePath, routesDir } = treeWith({
      paths: ['/'],
      files: THIRTEEN_FILES,
    })
    let error
    try {
      routePathsFromGeneratedTree(treePath, routesDir)
    } catch (e) {
      error = e
    }
    expect(error).toBeDefined()
    expect(error.message).toMatch(/returned 1 path\(s\)/)
    expect(error.message).toMatch(/at least 13 route file\(s\)/)
  })

  it('THE RED — §3.3 fails a HEALTHY tree that contains a pathless layout', () => {
    // `_shell.tsx` is exactly how 6-3 builds its persistent tab bar. It owns no path, so a tree
    // with it is healthy at two paths and three `.tsx` files.
    const files = ['__root.tsx', '_shell.tsx', 'index.tsx', 'settings.tsx']
    const { treePath, routesDir } = treeWith({ paths: ['/', '/settings'], files })

    // §3.3's check is `if (paths.length < leaves) throw`. Two healthy paths against three counted
    // files is 2 < 3 — a tree with nothing wrong with it, exiting 1.
    expect(prescribedLeafCount(routesDir)).toBe(3)
    expect(2).toBeLessThan(prescribedLeafCount(routesDir))

    // The shipped form counts the files that own a path, so the same tree passes.
    expect(routeLeafFiles(routesDir).sort()).toEqual(['index.tsx', 'settings.tsx'])
    expect(routePathsFromGeneratedTree(treePath, routesDir)).toEqual(['/', '/settings'])
  })

  it('THE RED — §3.3 cannot see routes in subdirectories, so it tolerates the collapse it exists to catch', () => {
    const files = [
      '__root.tsx',
      'index.tsx',
      'settings.tsx',
      'wallet/index.tsx',
      'wallet/receive.tsx',
      'pay/$address.tsx',
    ]
    const { routesDir } = treeWith({ paths: ['/'], files })

    // Five real routes read as two — and a collapsed extraction returning two paths therefore
    // passes the prescribed check with nothing to say.
    expect(prescribedLeafCount(routesDir)).toBe(2)
    expect(routeLeafFiles(routesDir).sort()).toEqual([
      'index.tsx',
      'pay/$address.tsx',
      'settings.tsx',
      'wallet/index.tsx',
      'wallet/receive.tsx',
    ])
  })

  it('THE RED — in a mixed tree §3.3 reports GREEN on a collapsed extraction, the worst of the three outcomes', () => {
    // A pathless layout AND a subdirectory. Four routes exist; the extraction has lost one of them.
    const files = ['__root.tsx', '_shell.tsx', 'index.tsx', 'settings.tsx', 'wallet/index.tsx', 'wallet/receive.tsx']
    const { treePath, routesDir } = treeWith({ paths: ['/', '/settings', '/wallet'], files })

    // The over-count (`_shell.tsx`) and the under-count (`wallet/`) cancel to exactly the number of
    // paths the broken extraction returned, so §3.3 has nothing to say: 3 < 3 is false.
    expect(prescribedLeafCount(routesDir)).toBe(3)
    expect(3).not.toBeLessThan(prescribedLeafCount(routesDir))

    // Four routes really exist, and the shipped form says so.
    expect(routeLeafFiles(routesDir)).toHaveLength(4)
    expect(() => routePathsFromGeneratedTree(treePath, routesDir)).toThrow(/at least 4 route file\(s\)/)
  })

  it('counts what the generator counts and skips what it skips', () => {
    // Every exclusion here was read out of the generator this repo has installed
    // (`router-generator/dist/esm/filesystem/physical/getRouteNodes.js`), not out of recall:
    // `-` and `.` prefixes are dropped whole, split files attach to a route declared elsewhere,
    // `route.tsx` names the same path its sibling `index.tsx` does, and a pathless layout's
    // CHILDREN keep their paths even though the layout has none.
    const { routesDir } = treeWith({
      paths: ['/'],
      files: [
        '__root.tsx',
        'index.tsx',
        '_shell.tsx',
        '_shell.wallet.tsx',
        'wallet/route.tsx',
        'wallet/index.tsx',
        'wallet/receive.lazy.tsx',
        'wallet/receive.tsx',
        'markets.errorComponent.tsx',
        'markets.tsx',
        '-components/AmountField.tsx',
        'notes.md',
      ],
    })
    expect(routeLeafFiles(routesDir).sort()).toEqual([
      '_shell.wallet.tsx',
      'index.tsx',
      'markets.tsx',
      'wallet/index.tsx',
      'wallet/receive.tsx',
    ])
  })

  it('never counts two files against one path — the route-group collision', () => {
    // A route group erases a path SEGMENT, not the route: `(app)/index.tsx` and `index.tsx` both
    // resolve to `/`, and the generated union carries `/` once. Counting both files would fail a
    // healthy tree — a false red, which is how a check like this gets deleted by the next person in
    // a hurry. Group files are therefore not counted at all: the floor may only ever soften.
    const nested = treeWith({
      paths: ['/', '/settings'],
      files: ['__root.tsx', 'index.tsx', 'settings.tsx', '(app)/index.tsx', '(app)/settings.tsx'],
    })
    expect(routeLeafFiles(nested.routesDir).sort()).toEqual(['index.tsx', 'settings.tsx'])
    expect(() => routePathsFromGeneratedTree(nested.treePath, nested.routesDir)).not.toThrow()

    // The flat spelling of the same thing, which is what anyone writing it by hand reaches for.
    const flat = treeWith({
      paths: ['/', '/settings'],
      files: ['__root.tsx', 'index.tsx', 'settings.tsx', '(app).settings.tsx'],
    })
    expect(routeLeafFiles(flat.routesDir).sort()).toEqual(['index.tsx', 'settings.tsx'])
    expect(() => routePathsFromGeneratedTree(flat.treePath, flat.routesDir)).not.toThrow()
  })

  it('counts the extensions the generator counts, not just .tsx', () => {
    // `getRouteNodes.js:73` matches `.tsx|.ts|.jsx|.js|.vue`. Counting only `.tsx` silently lowers
    // the floor in a mixed tree — the check would still be there, quietly holding less.
    const { routesDir } = treeWith({
      paths: ['/'],
      files: ['__root.tsx', 'index.tsx', 'chat.ts', 'swap.jsx', 'bridge.js', 'README.md'],
    })
    expect(routeLeafFiles(routesDir).sort()).toEqual([
      'bridge.js',
      'chat.ts',
      'index.tsx',
      'swap.jsx',
    ])
  })

  it('refuses rather than skipping when the routes directory is not there', () => {
    const { treePath } = treeWith({ paths: ['/'], files: [] })
    expect(() => routePathsFromGeneratedTree(treePath, join(tmpdir(), 'passbook-no-such-routes-dir')))
      .toThrow(/does not exist/)
  })
})

// ---- R15a / P2: the marker assertion --------------------------------------------------------------

const HEALTHY = {
  label: 'test',
  errors: [],
  consoleErrors: [],
  published: { network: 'mainnet' },
  globalName: '__X__',
  visited: ['/', '/settings'],
  rendered: { '/': 'Passbook', '/settings': 'Settings' },
  markers: { '/': ['/'], '/settings': ['/settings'] },
}

/** The copy a surface's OWN `errorComponent` renders. Note what is not in it. */
const OWN_ERROR_COPY = 'This screen could not load. Try again.'

describe('assertEvaluatedClean: which surface actually rendered (R15a, P2)', () => {
  it('passes a tree where every route rendered itself', () => {
    expect(() => assertEvaluatedClean(HEALTHY)).not.toThrow()
  })

  it('THE RED — a throwing surface with its own errorComponent left the pre-repair check nothing to find', () => {
    const rendered = { '/': 'Passbook', '/settings': OWN_ERROR_COPY }

    // The literal the pre-repair gate grepped for is simply not on the page: the route's own error
    // component replaced the router's default one, which is a 6-3 acceptance criterion. No page
    // error either — the boundary caught the throw, which is what boundaries are for.
    expect(OWN_ERROR_COPY).not.toMatch(/Something went wrong!/)
    expect(preRepairRenderedProblems(rendered)).toEqual([])

    // The repaired gate reads the identity the surface published instead, and that says `__error__`.
    expect(() =>
      assertEvaluatedClean({
        ...HEALTHY,
        rendered,
        markers: { '/': ['/'], '/settings': ['__error__'] },
      }),
    ).toThrow(/route \/settings rendered '__error__' — a fallback, not itself/)
  })

  it('rejects every reserved marker by its prefix, not by a list', () => {
    for (const reserved of ['__error__', '__not_found__', '__pending__']) {
      expect(() =>
        assertEvaluatedClean({ ...HEALTHY, markers: { ...HEALTHY.markers, '/settings': [reserved] } }),
      ).toThrow(new RegExp(`route /settings rendered '${reserved}'`))
    }
  })

  it('is why the reserved rule exists: identity alone cannot see a broken surface', () => {
    // An error component wearing the route's own id is TRUE about identity and silent about state —
    // measured `failures: []` on a surface that throws on every render. Nothing below can catch
    // that, which is precisely why `__`-prefixed values are reserved at the source instead.
    expect(() =>
      assertEvaluatedClean({
        ...HEALTHY,
        rendered: { '/': 'Passbook', '/settings': OWN_ERROR_COPY },
        markers: { '/': ['/'], '/settings': ['/settings'] },
      }),
    ).not.toThrow()
  })

  it('names the route that rendered no marker at all', () => {
    expect(() =>
      assertEvaluatedClean({ ...HEALTHY, markers: { ...HEALTHY.markers, '/settings': [] } }),
    ).toThrow(/route \/settings rendered no \[data-route-id\] marker/)
  })

  it('names both routes when one surface renders another one', () => {
    expect(() =>
      assertEvaluatedClean({ ...HEALTHY, markers: { ...HEALTHY.markers, '/settings': ['/wallet'] } }),
    ).toThrow(/route \/settings rendered '\/wallet' — a DIFFERENT route's surface \(expected '\/settings'\)/)
  })

  it('accepts a declared redirect, and only a declared one', () => {
    const expectedRedirects = { '/': '/wallet' }
    expect(() =>
      assertEvaluatedClean({
        ...HEALTHY,
        rendered: { '/': 'Wallet', '/settings': 'Settings' },
        markers: { '/': ['/wallet'], '/settings': ['/settings'] },
        expectedRedirects,
      }),
    ).not.toThrow()

    // Declared, so the redirect is the expectation — a `/` that renders `/` has stopped redirecting
    // and the gate says so rather than shrugging at a prefix match.
    expect(() =>
      assertEvaluatedClean({ ...HEALTHY, expectedRedirects }),
    ).toThrow(/route \/ rendered '\/' — a DIFFERENT route's surface \(expected '\/wallet'\)/)
  })

  it('names an empty identity as an empty identity, not as another route', () => {
    for (const blank of ['', '   ']) {
      expect(() =>
        assertEvaluatedClean({ ...HEALTHY, markers: { ...HEALTHY.markers, '/settings': [blank] } }),
      ).toThrow(/route \/settings rendered a \[data-route-id\] with an empty value/)
    }
  })

  it('refuses a page carrying two markers, whichever one document order would have picked', () => {
    // 6-3 lands `_shell.tsx`, a persistent layout wrapping every leaf — the exact thing that will be
    // tempted to render a marker of its own. Whichever of the two a reader takes is then decided by
    // nesting order, so neither is a fact.
    expect(() =>
      assertEvaluatedClean({
        ...HEALTHY,
        markers: { ...HEALTHY.markers, '/settings': ['/settings', '/settings'] },
      }),
    ).toThrow(/route \/settings rendered 2 \[data-route-id\] markers/)

    // And it fires on the shape that would otherwise slip past: a correct leaf marker sitting
    // second, behind a layout claiming to be a different route.
    expect(() =>
      assertEvaluatedClean({
        ...HEALTHY,
        markers: { ...HEALTHY.markers, '/settings': ['/wallet', '/settings'] },
      }),
    ).toThrow(/rendered 2 \[data-route-id\] markers \('\/wallet', '\/settings'\)/)
  })

  it('refuses to pass a caller that evaluated routes and threaded no markers', () => {
    // The silent-skip shape: two routes evaluated, zero identity verdicts, and — without this —
    // an assertion loop that iterates nothing and reports clean.
    expect(() => assertEvaluatedClean({ ...HEALTHY, markers: {} })).toThrow(
      /2 of 2 evaluated route\(s\) reached this assertion with no marker verdict at all/,
    )
  })

  it('refuses a caller that threaded NEITHER markers nor rendered — the skip one level up', () => {
    // Both of those parameters default to `{}`. Keyed off either of them, every loop in this
    // function walks zero routes and the artifact is pronounced clean without a single check having
    // run. `visited` is the one input with no empty default, so it is what the checks are driven
    // from.
    expect(() => assertEvaluatedClean({ ...HEALTHY, rendered: {}, markers: {} })).toThrow(
      /2 of 2 evaluated route\(s\) reached this assertion with no marker verdict at all/,
    )
  })

  it('refuses outright when `visited` is missing, rather than answering from an empty default', () => {
    const { visited: _dropped, ...withoutVisited } = HEALTHY
    expect(() => assertEvaluatedClean(withoutVisited)).toThrow(
      /called without `visited`.*cannot tell "every route passed" apart from "no route was checked"/s,
    )
  })
})

// ---- the browser half: what evaluate() reads off a real document ----------------------------------

/**
 * The surface: a shell that paints at once, and a marker that names the route it IS.
 *
 * `renderAfterMs` is the whole point of the lazy case — the shell paints immediately and the marker
 * arrives later, exactly as it does when the error UI is its own lazily-loaded chunk.
 *
 * ONE source string, used two ways. Served from a file it is a `dist/` the shipped `evaluate()`
 * drives through `vite preview`; inlined it is a document `setContent` can put in front of a bare
 * page, which is how the pre-repair settle gets to be measured against the same artifact rather
 * than against a re-description of it. (Served rather than inlined for the gate's own runs because
 * `textContent` on `<body>` would otherwise return the script's SOURCE as rendered copy.)
 */
function surfaceScript({
  marker = 'location.pathname',
  markers: markerList = null,
  renderAfterMs = 0,
  releaseOnSignal = false,
  text = 'surface',
  lateConsoleError = null,
  lateConsoleErrorMs = 150,
} = {}) {
  const ids = markerList ?? (marker === null ? [] : [marker])
  const attach = ids
    .map(
      (id) => `
  var main = document.createElement('main')
  main.setAttribute('data-route-id', ${id})
  main.textContent = ${JSON.stringify(text)}
  document.getElementById('app').append(main)`,
    )
    .join('\n')
  // Released by an explicit signal rather than a clock wherever a test's verdict depends on the
  // marker NOT having arrived yet: a wall-clock margin measures how loaded the machine is.
  const trigger = releaseOnSignal
    ? `var t = setInterval(function () { if (window.__RELEASE__) { clearInterval(t); attach() } }, 10)`
    : `setTimeout(attach, ${renderAfterMs})`
  return `
window.__X__ = { network: 'mainnet' }
function attach() {${attach}
}
${trigger}
${lateConsoleError ? `setTimeout(function () { console.error(${JSON.stringify(lateConsoleError)}) }, ${lateConsoleErrorMs})` : ''}
`
}

function artifactHtml(scriptTag) {
  return `<!doctype html>
<html lang="en">
  <body>
    <div id="app"><header>Passbook</header></div>
    ${scriptTag}
  </body>
</html>
`
}

/** The document for `page.setContent` — the script inline, because there is no server. */
function inlineArtifact(options) {
  return artifactHtml(`<script>${surfaceScript(options)}</script>`)
}

/** The same script, written out as a `dist/` for `evaluate()` to be pointed at. */
function artifact(options) {
  const dir = scratch('artifact')
  writeFileSync(join(dir, 'index.html'), artifactHtml('<script type="module" src="/app.js"></script>'))
  writeFileSync(join(dir, 'app.js'), surfaceScript(options))
  return dir
}

function evaluateArtifact(dir, paths) {
  return evaluate({ root: dir, outDir: dir, globalName: '__X__', paths, label: 'test' })
}

describe('evaluate: the marker comes off the real document', () => {
  let browser
  beforeAll(async () => {
    try {
      assertBrowserAvailable('build-web.test')
      browser = await chromium.launch({ channel: 'chromium-headless-shell' })
    } catch (e) {
      throw new Error(`${e.message}\n\n  (install with: ${BROWSER_INSTALL_COMMAND})`)
    }
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('captures one marker per route, and the healthy tree passes end to end', async () => {
    const dir = artifact()
    const { markers, rendered, errors, consoleErrors, published, visited } = await evaluateArtifact(dir, [
      '/',
      '/settings',
    ])

    expect(visited).toEqual(['/', '/settings'])
    expect(markers).toEqual({ '/': ['/'], '/settings': ['/settings'] })
    expect(rendered).toEqual({ '/': 'surface', '/settings': 'surface' })
    expect(() =>
      assertEvaluatedClean({
        label: 'test',
        errors,
        consoleErrors,
        published,
        globalName: '__X__',
        visited,
        rendered,
        markers,
      }),
    ).not.toThrow()
  }, 60_000)

  it('THE RED — a surface that renders its own error UI passes the pre-repair gate and fails this one', async () => {
    // The document is the one the pillars measured a throwing route with its own `errorComponent`
    // produce: the boundary caught the throw, so there is no page error, no console error and no
    // default boundary text — only the reserved marker.
    const dir = artifact({ marker: JSON.stringify('__error__'), text: OWN_ERROR_COPY })
    const { markers, rendered, errors, consoleErrors, published, visited } = await evaluateArtifact(dir, [
      '/settings',
    ])

    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(preRepairRenderedProblems(rendered)).toEqual([])

    expect(markers).toEqual({ '/settings': ['__error__'] })
    expect(() =>
      assertEvaluatedClean({
        label: 'test',
        errors,
        consoleErrors,
        published,
        globalName: '__X__',
        visited,
        rendered,
        markers,
      }),
    ).toThrow(/route \/settings rendered '__error__' — a fallback, not itself/)
  }, 60_000)

  it('collects an async console error that arrives after the marker has attached', async () => {
    // The settle this gate used to run had TWO jobs, and only one of them was a race. The second —
    // letting THIS route's async console traffic reach the collectors before we navigate away — is
    // what a bare marker wait drops on the floor. A route that renders itself correctly and then
    // logs a failure 150 ms later is a real shape, and it must not ship green.
    const dir = artifact({ lateConsoleError: 'LATE: async failure on /' })
    const { markers, rendered, errors, consoleErrors, published, visited } = await evaluateArtifact(dir, ['/'])

    expect(consoleErrors).toContain('LATE: async failure on /')
    expect(() =>
      assertEvaluatedClean({
        label: 'test',
        errors,
        consoleErrors,
        published,
        globalName: '__X__',
        rendered,
        markers,
        visited,
      }),
    ).toThrow(/1 console error\(s\)/)
  }, 60_000)

  it('an empty surface is empty however much the persistent shell painted around it', async () => {
    // The emptiness check is measured against the SURFACE, not the document: this app's `__root`
    // renders a persistent header, so `body.textContent` is never empty and a check against it can
    // never fire. A surface that renders `<main data-route-id="/status" />` and nothing else is a
    // broken route wearing a correct identity.
    const dir = artifact({ text: '' })
    const { markers, rendered, errors, consoleErrors, published, visited } = await evaluateArtifact(dir, ['/status'])

    expect(markers['/status']).toEqual(['/status'])
    expect(rendered['/status']).toBe('')
    expect(() =>
      assertEvaluatedClean({
        label: 'test',
        errors,
        consoleErrors,
        published,
        globalName: '__X__',
        rendered,
        markers,
        visited,
      }),
    ).toThrow(/route \/status rendered an empty document/)
  }, 60_000)

  it('resolves on a zero-height surface, where the default `visible` state never resolves', async () => {
    // `state: 'attached'` is load-bearing, and this is the measurement that says why: an empty
    // surface has a zero-height box, so `visible` waits out its whole timeout and then reports
    // "no marker" with the marker sitting verbatim in the DOM — a wrong verdict, not a slow one.
    //
    // Stated as "one resolves and the other rejects", never as a stopwatch reading. A wall-clock
    // margin in a gate suite measures how loaded the machine is, and flakes get suites distrusted.
    const page = await browser.newPage()
    try {
      await page.setContent(inlineArtifact({ text: '' }))

      const attached = await page
        .waitForSelector('[data-route-id]', { timeout: 5_000, state: 'attached' })
        .then(() => true)
      expect(attached).toBe(true)

      const visible = await page
        .waitForSelector('[data-route-id]', { timeout: 1_500 })
        .then(() => true)
        .catch(() => false)
      expect(visible).toBe(false)
    } finally {
      await page.close()
    }
  }, 60_000)

  it('THE RED — the 250 ms settle samples before a lazy error chunk lands; the wait does not', async () => {
    // The marker is released by an explicit signal rather than a timer, so this asserts what it
    // means to assert — that the pre-repair settle sampled at a moment the error UI did not yet
    // exist — instead of racing a `setTimeout` against however loaded the runner is.
    const lazyError = {
      marker: JSON.stringify('__error__'),
      releaseOnSignal: true,
      text: OWN_ERROR_COPY,
    }
    const readFirstMarker = () =>
      document.querySelector('[data-route-id]')?.getAttribute('data-route-id') ?? null

    const page = await browser.newPage()
    try {
      await page.setContent(inlineArtifact(lazyError))

      // The pre-repair settle, line for line. The shell has painted, so the body-text wait resolves
      // at once and the 250 ms beat expires with the error UI still unloaded.
      await page
        .waitForFunction(() => (document.body.textContent ?? '').trim().length > 0, undefined, {
          timeout: 10_000,
        })
        .catch(() => {})
      await page.waitForTimeout(250)
      expect(await page.evaluate(readFirstMarker)).toBeNull()

      // The chunk lands. Change ONLY the wait — same page, same artifact — and the verdict flips.
      await page.evaluate(() => {
        window.__RELEASE__ = true
      })
      await page.waitForSelector('[data-route-id]', { timeout: 5_000, state: 'attached' })
      expect(await page.evaluate(readFirstMarker)).toBe('__error__')
    } finally {
      await page.close()
    }

    // And the shipped gate, on a served artifact whose error UI arrives late, is the second of
    // those two verdicts. Nothing here depends on 900 being larger than any other number: the gate
    // waits for the marker, so the delay only has to be shorter than its timeout.
    const { markers } = await evaluateArtifact(
      artifact({ marker: JSON.stringify('__error__'), renderAfterMs: 900, text: OWN_ERROR_COPY }),
      ['/markets'],
    )
    expect(markers).toEqual({ '/markets': ['__error__'] })
  }, 60_000)

  it('sees BOTH markers when a layout and its leaf each claim to be the route', async () => {
    // `querySelector` would have taken the layout's and never mentioned the leaf's. 6-3 lands
    // exactly this shape — a persistent `_shell` wrapping every surface.
    const dir = artifact({ markers: [JSON.stringify('/wallet'), 'location.pathname'] })
    const { markers, rendered, errors, consoleErrors, published, visited } = await evaluateArtifact(dir, [
      '/settings',
    ])

    expect(markers).toEqual({ '/settings': ['/wallet', '/settings'] })
    expect(() =>
      assertEvaluatedClean({
        label: 'test',
        errors,
        consoleErrors,
        published,
        globalName: '__X__',
        visited,
        rendered,
        markers,
      }),
    ).toThrow(/route \/settings rendered 2 \[data-route-id\] markers \('\/wallet', '\/settings'\)/)
  }, 60_000)

  it('reports a page that never renders a marker as the absence it is', async () => {
    // The absent-marker path — the timeout branch, the swallowed TimeoutError and the read that
    // follows it — against a real page rather than against fabricated input. This is the one test
    // here that pays the full marker timeout, on purpose: that wait is the thing under test.
    const dir = artifact({ marker: null })
    const { markers, rendered, errors, consoleErrors, published, visited } = await evaluateArtifact(dir, ['/'])

    expect(markers).toEqual({ '/': [] })
    // With no surface to read, the document's own text is the evidence — this is the case where the
    // router's default boundary has replaced everything and its copy is all there is.
    expect(rendered['/']).toBe('Passbook')
    expect(() =>
      assertEvaluatedClean({
        label: 'test',
        errors,
        consoleErrors,
        published,
        globalName: '__X__',
        visited,
        rendered,
        markers,
      }),
    ).toThrow(/route \/ rendered no \[data-route-id\] marker/)
  }, 60_000)
})
