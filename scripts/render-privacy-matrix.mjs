//
// Renders the generated TABLES of docs/privacy.md from the modules the app renders them from, so
// FR-058 — "the docs' hidden/visible matrix is generated from the same source of truth as this
// component so app and docs cannot drift" — is a mechanism instead of a sentence.
//
// WHAT THIS OWNS AND WHAT IT DOES NOT. Everything between a pair of
// `<!-- generated:NAME -->` / `<!-- /generated:NAME -->` markers is written by this script and must
// not be hand-edited — regenerate with `pnpm run render:privacy` after editing either module.
// Everything OUTSIDE the markers is prose a human owns and this script never touches it.
//
// AND THIS ONE ACTUALLY FAILS THE BUILD. `render-topology.mjs:8` has claimed since it was written
// that it "fails the build when the committed doc and the modules disagree", and
// `docs/topology.md:7` admits the claim is false — its `--check` mode is wired to nothing. This is
// the first document in the repository where that sentence is true: `scripts/build-web.mjs` calls
// `checkFreshness()` below and throws. Topology's hole stays open; it is not this story's to close.
//
// The facts come from two modules, each the authority for its own half:
//   packages/protocol/src/visibility-matrix.ts  — actors, facts, cells, contexts, the two refusals
//   packages/protocol/src/disclosure-copy.ts    — the headline sentence per context
//
// TYPE STRIPPING, NOT A BUILD STEP (`render-topology.mjs:16-18`). Those are `.ts` files and this is
// plain `node`. BOTH MODULES IMPORT NOTHING, and that is a requirement rather than a coincidence:
// Node's type stripping does not rewrite a `.js` specifier onto a `.ts` file — measured, it throws
// ERR_MODULE_NOT_FOUND — so a single relative import in either of them breaks this script and,
// through it, `pnpm run build:web`. Both module headers say so.
//
//   node scripts/render-privacy-matrix.mjs            # rewrite docs/privacy.md in place
//   node scripts/render-privacy-matrix.mjs --check    # exit 1 if the committed doc is stale
//
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOC = fileURLToPath(new URL('../docs/privacy.md', import.meta.url))

const MATRIX_MODULE = fileURLToPath(new URL('../packages/protocol/src/visibility-matrix.ts', import.meta.url))
const COPY_MODULE = fileURLToPath(new URL('../packages/protocol/src/disclosure-copy.ts', import.meta.url))

const matrix = await import('../packages/protocol/src/visibility-matrix.ts')
const copy = await import('../packages/protocol/src/disclosure-copy.ts')

const {
  ACTOR_LABELS,
  CELL_ENCODING,
  CELL_LABEL,
  CELL_MEANING,
  CONTEXT_LABELS,
  FACT_LABELS,
  VISIBILITY_ACTORS,
  VISIBILITY_CELL_STATES,
  VISIBILITY_CONTEXTS,
  VISIBILITY_FACTS,
  footnoteText,
  matrixFor,
  matrixNotes,
  noteNumber,
} = matrix

const { DISCLOSURE_HEADLINE } = copy

/**
 * The headline for a context, REFUSING to render a page without one.
 *
 * `> ${DISCLOSURE_HEADLINE[context]}` was unguarded, and `DISCLOSURE_HEADLINE` is keyed by plain
 * strings because `disclosure-copy.ts` imports nothing and so cannot name `VisibilityContext`. An
 * authored context with no headline therefore rendered the literal text `> undefined` into the
 * user-facing privacy page — and `checkFreshness` accepted it, because a deterministic render of
 * `undefined` matches a committed `undefined` perfectly.
 *
 * Exported so the guard itself is reachable from `test/privacy-docs.test.ts`. A branch that can
 * only be exercised by breaking a module is a branch nobody tests.
 */
export function headlineFor(context) {
  const headline = DISCLOSURE_HEADLINE[context]
  if (typeof headline !== 'string' || !headline.trim()) {
    throw new Error(
      `\`${context}\` has an authored matrix but no headline in disclosure-copy.ts. Every authored ` +
        'context needs both halves — rendering the page without one writes "undefined" into a ' +
        'document whose whole job is to state privacy facts, and the freshness check cannot tell ' +
        'that apart from a fact.',
    )
  }
  return headline
}

/** Markdown table cells cannot contain a raw pipe, and a newline would end the row. */
function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────

/**
 * The legend, and every word in it comes out of the module.
 *
 * A legend hand-written here would be a SECOND definition of what "hidden" means, in a file the app
 * does not read — which is the drift this generator exists to make impossible, arriving through the
 * one door nobody watches.
 */
function legendSection() {
  return [
    table(
      ['Reads as', 'Shape in the app', 'What it means'],
      VISIBILITY_CELL_STATES.map((state) => [
        `**${CELL_LABEL[state]}**`,
        CELL_ENCODING[state],
        CELL_MEANING[state],
      ]),
    ),
    '',
    `**Columns:** ${VISIBILITY_ACTORS.map((a) => ACTOR_LABELS[a]).join(' · ')}.`,
    `**Rows:** ${VISIBILITY_FACTS.map((f) => FACT_LABELS[f]).join(' · ')}.`,
  ].join('\n')
}

/** One review context: what it says, then who can read what, then any qualifiers. */
function contextSection(context) {
  const record = matrixFor(context)

  if (!record.authored) {
    return [
      `### ${CONTEXT_LABELS[context]}`,
      '',
      `> **Nobody has written this one down.** ${record.because}`,
    ].join('\n')
  }

  //
  // THE NUMBERING IS THE MODULE'S, NOT THIS SCRIPT'S. It used to be a closure here and a `Set` walk
  // in `VisibilityMatrix.tsx`, agreeing only because both happened to iterate rows before columns —
  // so the app's footnote 1 and this page's footnote 1 were the same sentence by coincidence, with
  // nothing pinning them. One implementation, two callers.
  //
  const notes = matrixNotes(record)
  const headline = headlineFor(context)

  const rows = VISIBILITY_FACTS.map((fact) => [
    `**${FACT_LABELS[fact]}**`,
    ...VISIBILITY_ACTORS.map((actor) => {
      const c = record.cells[fact][actor]
      const n = noteNumber(notes, c)
      return n === null ? CELL_LABEL[c.state] : `${CELL_LABEL[c.state]} [${n}]`
    }),
  ])

  const body = [
    `### ${CONTEXT_LABELS[context]}`,
    '',
    `> ${headline}`,
    '',
    table(['', ...VISIBILITY_ACTORS.map((a) => ACTOR_LABELS[a])], rows),
  ]

  if (notes.length) {
    // A footnote the blockquote above already states in full is printed as a POINTER. The Markets
    // headline IS FR-009 in full and FR-009's second clause is the qualifier on its own sender
    // cell, so this page printed the same twenty-seven words twice, four lines apart. The dedupe
    // rule is `footnoteText`'s, in the module, so the panel and this page make the same call.
    body.push('', ...notes.map((note, index) => `${index + 1}. ${footnoteText(note, headline)}`))
  }

  return body.join('\n')
}

/**
 * The provenance line: a SOURCE HASH and no timestamp.
 *
 * `render-design-tokens.mjs:490-491`'s rule — a timestamp turns the freshness gate into "who ran it
 * last" and makes every regeneration a diff. Hashing the module BYTES rather than the rendered
 * output is deliberate and slightly stricter than it needs to be: editing a comment in either
 * module fails the build until the doc is regenerated, which costs one command and buys a gate that
 * cannot be defeated by a change whose effect on the tables is not obvious.
 */
function sourceSection() {
  const sha = createHash('sha256')
    .update(readFileSync(MATRIX_MODULE))
    .update(readFileSync(COPY_MODULE))
    .digest('hex')
  return (
    `*Generated from \`packages/protocol/src/visibility-matrix.ts\` and ` +
    `\`packages/protocol/src/disclosure-copy.ts\` — sha256 ${sha}. Regenerate with ` +
    `\`pnpm run render:privacy\`; do not hand-edit anything between the generated markers.*`
  )
}

const SECTIONS = {
  source: sourceSection,
  legend: legendSection,
}

for (const context of VISIBILITY_CONTEXTS) {
  SECTIONS[context] = () => contextSection(context)
}

// ── Splice ────────────────────────────────────────────────────────────────────────────────

/**
 * Replaces the body of every `<!-- generated:NAME -->` block, and fails on anything unexpected.
 *
 * Three hard failures, all of them silent otherwise: a marker in the doc with no section here, a
 * section here with no marker in the doc, and an unclosed marker — which renders nothing at all and
 * looks exactly like a document that is simply up to date.
 */
export function render(source) {
  //
  // COUNTED IN `source`, BEFORE THE SPLICE, AND THAT ORDER IS THE CHECK.
  //
  // It used to count in the OUTPUT, which cannot see the failure it was written for: the section
  // regex is non-greedy, so a doc carrying a duplicated OPEN marker matches from the first open to
  // the close and EATS everything between the two — including whatever prose a human owned there.
  // The replacement then writes exactly one open and one close, so counting afterwards found 1/1
  // and reported a document from which content had just been silently deleted as healthy.
  //
  // A section with NO markers at all falls through on purpose: it is a real and different failure,
  // and the message below names it far better than "found 0/0" would.
  //
  for (const name of Object.keys(SECTIONS)) {
    const opens = (source.match(new RegExp(`<!-- generated:${name} -->`, 'g')) ?? []).length
    const closes = (source.match(new RegExp(`<!-- /generated:${name} -->`, 'g')) ?? []).length
    if (opens === 0 && closes === 0) continue
    if (opens !== 1 || closes !== 1) {
      throw new Error(
        `docs/privacy.md must have exactly one open and one close marker for "${name}", found ` +
          `${opens}/${closes}. A duplicated open marker is the dangerous one: the splice would ` +
          'swallow everything between the two and report the result as up to date.',
      )
    }
  }

  const seen = new Set()
  const out = source.replace(
    /<!-- generated:([a-z-]+) -->[\s\S]*?<!-- \/generated:\1 -->/g,
    (_match, name) => {
      const section = SECTIONS[name]
      if (!section) {
        throw new Error(
          `docs/privacy.md has a <!-- generated:${name} --> block, but render-privacy-matrix.mjs ` +
            `has no section named "${name}"`,
        )
      }
      seen.add(name)
      return `<!-- generated:${name} -->\n${section()}\n<!-- /generated:${name} -->`
    },
  )

  const missing = Object.keys(SECTIONS).filter((n) => !seen.has(n))
  if (missing.length) {
    throw new Error(
      `render-privacy-matrix.mjs generates section(s) ${missing.join(', ')}, but docs/privacy.md ` +
        `has no matching <!-- generated:… --> block, so they would never appear. Add the markers ` +
        `or drop the section. A review context with no section in the document is a privacy claim ` +
        `the docs do not make.`,
    )
  }

  return out
}

export function currentDoc() {
  return readFileSync(DOC, 'utf8')
}

export const DOC_PATH = DOC

/** The provenance line, reported separately: a hash change is not "line 12 differs". */
const SOURCE_LINE = /^\*Generated from `packages\/protocol\/src\/visibility-matrix\.ts`/

/**
 * PURE OVER THE DOCUMENT TEXT, so a test can hand it a mutated one.
 *
 * @returns {{fresh: boolean, expected: string, actual: string, firstDiffLine: number|null,
 *            hashOnly: boolean}}
 */
export function checkFreshness({ source = currentDoc() } = {}) {
  const expected = render(source)
  if (expected === source) {
    return { fresh: true, expected, actual: source, firstDiffLine: null, hashOnly: false }
  }

  const a = source.split('\n')
  const b = expected.split('\n')
  let firstDiffLine = null
  let hashOnly = true
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue
    // Reporting the provenance line as "line 12 differs" is useless: the hash differs because a
    // module changed. Skip it for the line number and say what actually happened.
    if (SOURCE_LINE.test(b[i] ?? '') && SOURCE_LINE.test(a[i] ?? '')) continue
    hashOnly = false
    firstDiffLine = i + 1
    break
  }
  return { fresh: false, expected, actual: source, firstDiffLine, hashOnly }
}

/** The house sentence. It is load-bearing: it tells the reader which command to run. */
export function staleMessage({ firstDiffLine, hashOnly }) {
  const where = hashOnly
    ? 'the source hash changed, so a module was edited and the document was not regenerated'
    : `first difference at line ${firstDiffLine}`
  return (
    '`docs/privacy.md` is STALE: its generated sections do not match the modules they are rendered ' +
    `from (${where}). Run \`pnpm run render:privacy\` and commit the result. Do not hand-edit ` +
    'anything between the `<!-- generated:… -->` markers; edit ' +
    '`packages/protocol/src/visibility-matrix.ts` — it is the single source every surface reads.'
  )
}

export function write() {
  const rendered = render(currentDoc())
  writeFileSync(DOC, rendered)
  return rendered
}

//
// REALPATH BOTH SIDES, for `render-design-tokens.mjs`'s reason: `resolve(process.argv[1])` does not
// follow symlinks, so under a worktree or a `/tmp` checkout on macOS a plain comparison silently
// fails and this script exits 0 having rendered nothing and checked nothing.
//
const entrypoint = process.argv[1] ? realpathSync(resolve(process.argv[1])) : null
if (entrypoint && entrypoint === realpathSync(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--check')) {
    const result = checkFreshness()
    if (!result.fresh) {
      console.error(staleMessage(result))
      process.exit(1)
    }
    console.log('privacy doc: generated sections match the source modules')
  } else {
    write()
    console.log(
      `rendered ${Object.keys(SECTIONS).length} generated section(s) into docs/privacy.md`,
    )
  }
}
