//
// Renders the generated TABLES of docs/topology.md from the modules that own their facts, so
// "one truth, two views" is a mechanism instead of a promise.
//
// WHAT THIS OWNS AND WHAT IT DOES NOT. Everything between a pair of
// `<!-- generated:NAME -->` / `<!-- /generated:NAME -->` markers is written by this script and
// must not be hand-edited — regenerate with `pnpm run render:topology` after editing, and
// fails the build when the committed doc and the modules disagree. Everything OUTSIDE the
// markers is hand-written prose that a human owns; this script never touches it.
//
// The facts come from three modules, each the authority for its own section:
//   packages/relayer/src/topology.ts     — signers, jobs, degrade matrix, demo-critical, Q5
//   packages/relayer/src/quote-proxy.ts  — allowlisted upstreams and browser-direct exceptions
//   packages/protocol/src/constants.ts   — the explorer base for deployment links
//
// TYPE STRIPPING, NOT A BUILD STEP. Those are `.ts` files and this is plain `node`; Node has
// stripped types on import since 23.6, and the repo's toolchain is Node 24+. All three modules
// are import-free data, which is why importing them here costs nothing and pulls in no runtime.
//
//   node scripts/render-topology.mjs            # rewrite docs/topology.md in place
//   node scripts/render-topology.mjs --check    # exit 1 if the committed doc is stale
//
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DOC = fileURLToPath(new URL('../docs/topology.md', import.meta.url))

const topology = await import('../packages/relayer/src/topology.ts')
const proxy = await import('../packages/relayer/src/quote-proxy.ts')
const { NET } = await import('../packages/protocol/src/constants.ts')

const { SIGNERS, RELAYER_JOBS, DEMO_CRITICAL, COLD_START_CAVEAT } = topology

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

/** `0x10fe91ce…f4b97` — long felts are unreadable in a table and useless at full width. */
function shortHex(hex) {
  return hex.length <= 18 ? hex : `${hex.slice(0, 8)}…${hex.slice(-5)}`
}

const yesNo = (b) => (b ? 'Yes' : '**No**')

// ── Sections ──────────────────────────────────────────────────────────────────────────────

function signersSection() {
  return table(
    ['Signer', 'Exists today', 'Host — the process that holds it', 'Key location'],
    SIGNERS.map((s) => [s.role, yesNo(s.builtToday), s.host, s.keyLocation]),
  )
}

function disciplineSection() {
  return SIGNERS.map((s) => {
    const owner = s.builtToday ? '' : ` — owned by \`${s.owningStory}\``
    return [
      `#### ${s.role}${s.builtToday ? '' : ' (not built)'}`,
      '',
      s.purpose,
      '',
      ...s.discipline.map((d) => `- ${d}`),
      '',
      `*Monitoring:* ${s.monitoring}${owner}`,
    ].join('\n')
  }).join('\n\n')
}

function deploymentsSection() {
  const built = SIGNERS.filter((s) => s.deployment)
  if (!built.length) return '*No account has been deployed yet.*'
  const rows = built.map((s) => {
    const d = s.deployment
    return [
      s.role,
      `[\`${shortHex(d.address)}\`](${NET.explorer}/contract/${d.address})`,
      `[\`${shortHex(d.transactionHash)}\`](${NET.explorer}/tx/${d.transactionHash})`,
      String(d.verifiedAtBlock),
    ]
  })
  const classes = [...new Set(built.map((s) => s.deployment.classHash))]
  const records = [...new Set(built.map((s) => s.deployment.record))]
  return [
    table(['Signer', 'Address', 'Deploy transaction', 'Class verified at block'], rows),
    '',
    `Class ${classes.map((c) => `\`${shortHex(c)}\``).join(', ')}, read back off the chain rather ` +
      `than trusted from the response. Record: ${records.map((r) => `\`${r}\``).join(', ')}.`,
  ].join('\n')
}

/** The matrix: one sub-table per job, so a row's scope is legible beside its trigger. */
function matrixSection() {
  return RELAYER_JOBS.map((job) => {
    const head = [
      `#### ${job.job}${job.builtToday ? '' : ' — designed, NOT built'}`,
      '',
      job.summary,
      '',
      job.routes.length
        ? `*Routes:* ${job.routes.map((r) => `\`${r}\``).join(' · ')}`
        : '*Routes:* none today.',
      '',
    ]
    const rows = job.degradeStates.map((d) => [
      d.trigger,
      d.answers === 'not-built'
        ? '*not built*'
        : `\`${d.status}\`${d.reason ? ` \`${d.reason}\`` : ''}`,
      d.affectsRoutes.length ? d.affectsRoutes.map((r) => `\`${r}\``).join(' · ') : '*nothing*',
      d.stillServedInThisJob ?? '*nothing — every route of this job is affected*',
      d.otherJobsUnaffected.length ? d.otherJobsUnaffected.join(', ') : '*none*',
    ])
    const notes = job.degradeStates
      .map((d) => `- **${d.trigger.split('—')[0].trim()}:** ${d.note}`)
      .join('\n')
    return [
      ...head,
      table(
        ['Trigger', 'Answer', 'Routes affected', 'Same job still serves', 'Other jobs unaffected'],
        rows,
      ),
      '',
      notes,
      '',
      `*${job.note}*`,
    ].join('\n')
  }).join('\n\n')
}

function proxySection() {
  const targets = Object.entries(proxy.PROXY_TARGETS).map(([name, t]) => [
    `\`${name}\``,
    `\`${t.host}\``,
    t.injectsCredential ? 'server-side credential attached' : 'keyless',
  ])
  const exceptions = proxy.PROXY_EXCEPTIONS.map((e) => `- **${e.what}** — ${e.leaks}`)
  return [
    table(['Target', 'Host', 'Credential'], targets),
    '',
    'Calls the browser still makes **directly**, and what each costs the user:',
    '',
    ...exceptions,
  ].join('\n')
}

function demoCriticalSection() {
  return [
    `**Surfaces:** ${DEMO_CRITICAL.surfaces.join(' and ')}. ` +
      `**Processes they need:** ${DEMO_CRITICAL.processes.map((p) => `\`${p}\``).join(' + ')}.`,
    '',
    `**Off the demo-critical path:** ${DEMO_CRITICAL.offPath.join(', ')} — ` +
      `${DEMO_CRITICAL.offPathRationale}`,
    '',
    '**Also required, though not processes we run:**',
    '',
    ...DEMO_CRITICAL.alsoRequired.map((d) => `- ${d}`),
  ].join('\n')
}

function coldStartSection() {
  const c = COLD_START_CAVEAT
  return [
    `**${c.status} — spine ${c.spineQuestion}.** ${c.notResolvedHere}`,
    '',
    `> ${c.question}`,
    '',
    `**Sharpened by story 1.13.** ${c.sharpenedBy1_13}`,
    '',
    `**The unsponsored half.** ${c.deploymentIsUnsponsored}`,
    '',
    `**Measured.** ${c.measured}`,
    '',
    `Record: \`${c.evidence}\`.`,
  ].join('\n')
}

const SECTIONS = {
  signers: signersSection,
  discipline: disciplineSection,
  deployments: deploymentsSection,
  matrix: matrixSection,
  proxy: proxySection,
  'demo-critical': demoCriticalSection,
  'cold-start': coldStartSection,
}

// ── Splice ────────────────────────────────────────────────────────────────────────────────

/**
 * Replaces the body of every `<!-- generated:NAME -->` block, and fails on anything unexpected.
 *
 * A marker in the doc with no section here, or a section here with no marker in the doc, is an
 * error rather than a silent skip: both mean the doc and this script have diverged about what is
 * generated, and a silently unwritten section is exactly the drift the guard exists to catch.
 */
export function render(source) {
  const seen = new Set()
  const out = source.replace(
    /<!-- generated:([a-z-]+) -->[\s\S]*?<!-- \/generated:\1 -->/g,
    (_match, name) => {
      const section = SECTIONS[name]
      if (!section) throw new Error(`docs/topology.md has a <!-- generated:${name} --> block, but render-topology.mjs has no section named "${name}"`)
      seen.add(name)
      return `<!-- generated:${name} -->\n${section()}\n<!-- /generated:${name} -->`
    },
  )
  const missing = Object.keys(SECTIONS).filter((n) => !seen.has(n))
  if (missing.length) {
    throw new Error(
      `render-topology.mjs generates section(s) ${missing.join(', ')}, but docs/topology.md has ` +
        `no matching <!-- generated:… --> block, so they would never appear. Add the markers or ` +
        `drop the section.`,
    )
  }
  // An unclosed marker silently renders nothing, which would look exactly like a doc that is
  // simply up to date.
  for (const name of Object.keys(SECTIONS)) {
    const opens = (out.match(new RegExp(`<!-- generated:${name} -->`, 'g')) ?? []).length
    const closes = (out.match(new RegExp(`<!-- /generated:${name} -->`, 'g')) ?? []).length
    if (opens !== 1 || closes !== 1) {
      throw new Error(`docs/topology.md must have exactly one open and one close marker for "${name}", found ${opens}/${closes}`)
    }
  }
  return out
}

export function currentDoc() {
  return readFileSync(DOC, 'utf8')
}

export const DOC_PATH = DOC

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = currentDoc()
  const rendered = render(source)
  if (process.argv.includes('--check')) {
    if (rendered !== source) {
      console.error(
        'docs/topology.md is STALE: its generated sections do not match the modules they are ' +
          'rendered from. Run `node scripts/render-topology.mjs` and commit the result.',
      )
      process.exit(1)
    }
    console.log('topology doc: generated sections match the source modules')
  } else {
    writeFileSync(DOC, rendered)
    console.log(`rendered ${Object.keys(SECTIONS).length} generated section(s) into docs/topology.md`)
  }
}
