// A guard nobody has seen fail is a guard nobody knows works. These run the real script as a
// subprocess against a fixture tree, so what is tested is the thing CI runs.
//
// The two cases story 1.6 added it for are the fail-open ones — a lint that prints "clean"
// while checking nothing is worse than no lint, because it is trusted:
//   - a FILE named in ROOTS that has gone missing must fail, not be skipped;
//   - a forbidden claim inside docs/topology.md must actually be caught, which is only true if
//     that file is genuinely in the scan.
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/lint-claims.mjs')

const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

/**
 * A minimal repository shaped like ours: a mainnet constants.ts (the network guard reads it),
 * a README, and the topology doc that ROOTS names as a file.
 *
 * `topologyDoc: null` deletes it, which is the missing-file-root case.
 */
function fixture({ topologyDoc = '# topology\n', readme = '# readme\n', packageSource = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'passbook-claims-'))
  dirs.push(root)
  mkdirSync(join(root, 'packages/protocol/src'), { recursive: true })
  writeFileSync(
    join(root, 'packages/protocol/src/constants.ts'),
    "export type NetworkName = 'mainnet' | 'sepolia'\n" +
      "export const ACTIVE_NETWORK: NetworkName = 'mainnet'\n" +
      `export const pool = '0x0403deadbeef'\n${packageSource}`,
  )
  writeFileSync(join(root, 'README.md'), readme)
  if (topologyDoc !== null) {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'docs/topology.md'), topologyDoc)
  }
  return root
}

/** Runs the real script with the fixture as its working directory — it resolves ROOTS from cwd. */
function run(root) {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT], { cwd: root, encoding: 'utf8' }) }
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('lint-claims', () => {
  it('passes on the real repository, which is the state it must hold', () => {
    expect(run(process.cwd()).code).toBe(0)
  })

  it('passes on a clean fixture, so the failures below mean something', () => {
    expect(run(fixture()).code).toBe(0)
  })

  // ── The file-root fail-open (story 1.6) ─────────────────────────────────────────────────
  //
  // Before this, a ROOTS entry that had been moved, renamed or gitignored away was simply not
  // scanned, and the lint reported clean. A directory keeps the old tolerance because `apps/`
  // and `workers/` genuinely do not exist yet; a named file does not, because naming it was the
  // decision that it must be checked.
  it('FAILS when a file named in ROOTS is missing, rather than skipping it', () => {
    const r = run(fixture({ topologyDoc: null }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/docs\/topology\.md is named as a scan root but does not exist/)
    expect(r.out).toMatch(/silently stopped running/)
  })

  it('still tolerates a DIRECTORY root that does not exist yet', () => {
    // The fixture has no `apps/`, `workers/` or `src/` at all, and that must stay fine.
    const r = run(fixture())
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/apps|workers/)
  })

  // ── The topology doc is really in the scan ───────────────────────────────────────────────
  it('FAILS on a forbidden claim in docs/topology.md', () => {
    const r = run(fixture({ topologyDoc: '# topology\n\nThis relay is end-to-end encrypted.\n' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/docs\/topology\.md:3\s+forbidden claim "end-to-end"/)
  })

  it('catches every banned phrase there, not just the first one in the list', () => {
    for (const phrase of ['zero-knowledge', 'watch-only', 'only you can', 'amounts are private']) {
      const r = run(fixture({ topologyDoc: `# topology\n\nWe are ${phrase} here.\n` }))
      expect(r.code, phrase).toBe(1)
      expect(r.out, phrase).toMatch(new RegExp(`forbidden claim "${phrase}"`))
    }
  })

  it('honours the scoped opt-out inside the topology doc, and lists what it exempted', () => {
    const r = run(
      fixture({
        topologyDoc:
          '# topology\n<!-- claims-lint:disable -->\nWe never say end-to-end.\n<!-- claims-lint:enable -->\n',
      }),
    )
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/We never say end-to-end/)   // printed, so it cannot hide
  })

  it('fails on an unclosed opt-out, which would exempt the rest of the file forever', () => {
    const r = run(
      fixture({ topologyDoc: '# topology\n<!-- claims-lint:disable -->\nanything\n' }),
    )
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/is never closed/)
  })

  // ── The checks that were already there, now covered ──────────────────────────────────────
  it('fails on a forbidden claim in package source', () => {
    const r = run(fixture({ packageSource: "export const copy = 'only you can read this'\n" }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/forbidden claim "only you can"/)
  })

  it('fails on the unfilled address placeholder, even inside an exempt block', () => {
    const r = run(
      fixture({
        readme:
          '<!-- claims-lint:disable -->\nAddress: TODO_DEPLOYED_ADDRESS\n<!-- claims-lint:enable -->\n',
      }),
    )
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/unfilled placeholder/)
  })

  it('fails when ACTIVE_NETWORK is not mainnet', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'packages/protocol/src/constants.ts'),
      "export type NetworkName = 'mainnet' | 'sepolia'\n" +
        "export const ACTIVE_NETWORK: NetworkName = 'sepolia'\n",
    )
    const r = run(root)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ACTIVE_NETWORK is "sepolia"/)
  })
})
