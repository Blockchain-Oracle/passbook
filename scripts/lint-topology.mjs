//
// Build-time guard that docs/topology.md still says what its source modules say.
//
// This is the mechanism behind "one truth, two views". The doc's tables are generated from
// `packages/relayer/src/topology.ts` (plus the proxy allowlist and the network constants), and
// a generated artifact that nothing re-checks is just a copy that happens to have been correct
// once. This re-renders and compares, so the only way to change a rendered table is to change
// the module it comes from — and a hand-edit inside a generated block fails the build.
//
// It deliberately does NOT check the prose outside the markers. That is a human's to write, and
// a lint that demanded generated prose would either produce unreadable documentation or stop
// anyone from writing any.
//
// Run by `npm run lint`, beside lint-claims and lint-secrets.
//
import { render, currentDoc } from './render-topology.mjs'

let source
try {
  source = currentDoc()
} catch (e) {
  console.error(
    `docs/topology.md could not be read (${e.code ?? e.message}). It is a shipped operator ` +
      'document — see .gitignore, which un-excludes exactly this file — so its absence is a ' +
      'failure rather than a skip.',
  )
  process.exit(1)
}

let rendered
try {
  rendered = render(source)
} catch (e) {
  console.error(`topology doc: ${e.message}`)
  process.exit(1)
}

if (rendered !== source) {
  // Naming the first differing block beats "something changed" — the doc is long and the
  // diff is usually one table.
  const firstDiff = source.split('\n').findIndex((line, i) => line !== rendered.split('\n')[i])
  console.error(
    'docs/topology.md is STALE: its generated sections no longer match the modules they are ' +
      `rendered from (first difference at line ${firstDiff + 1}).\n` +
      'Run `node scripts/render-topology.mjs` and commit the result. Do not hand-edit inside a ' +
      '<!-- generated:… --> block; edit the module instead.',
  )
  process.exit(1)
}

console.log('topology lint: docs/topology.md matches packages/relayer/src/topology.ts')
