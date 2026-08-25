//
// Proves that `apps/web/design/tokens.yaml` is still the VERBATIM frontmatter of the UX design
// authority, byte for byte.
//
// WHY THIS EXISTS AS A SEPARATE, LOCAL-ONLY SCRIPT. The design authority
// (`_bmad-output/planning-artifacts/ux-designs/*/DESIGN.md`) is gitignored: it is a working
// document, not a repository artifact, so CI has never seen it and cannot. "CI enforces the design
// document's frontmatter" was therefore impossible as written. What IS possible is committing a
// verbatim copy as the build's source and checking it against the authority on the machine that has
// both — which is what this does.
//
// The consequence that matters: this is a LOCAL gate and `npm run lint` does not depend on it. Run
// it whenever the design authority changes, and always before ratifying a token change.
//
//   node scripts/check-tokens-verbatim.mjs                     # find the authority and compare
//   node scripts/check-tokens-verbatim.mjs <path/to/DESIGN.md> # compare against a named document
//
// EXIT CODES, and the one that is the point of the file:
//   0  the copy is byte-identical to the authority's frontmatter
//   1  they differ — the copy has drifted, or the authority changed and nobody re-copied it
//   2  the authority is ABSENT, unreadable, ambiguous, or has no frontmatter
//
// Exit 2 is a REFUSAL, not a skip. A checker that silently passes when it cannot find the thing it
// checks against is worse than no checker: it reports "verbatim" on a tree where nothing was
// compared, and that verdict is then trusted. The same failure this repository has already had to
// fix twice elsewhere.
//
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const UX_DESIGNS = join(REPO_ROOT, '_bmad-output/planning-artifacts/ux-designs')
const TOKENS_YAML = join(REPO_ROOT, 'apps/web/design/tokens.yaml')

class AuthorityMissing extends Error {}

/**
 * Locates the design authority.
 *
 * The directory is dated (`ux-stacks-20-2026-08-23`), so it is discovered rather than hardcoded —
 * but finding TWO is an error rather than a "take the newest": two design documents means nobody
 * can say which one the tokens are a copy of, and guessing is how the wrong one becomes authority.
 */
export function findAuthority(root = UX_DESIGNS) {
  if (!existsSync(root)) {
    throw new AuthorityMissing(
      `the UX design authority directory is not present at ${root}. It is gitignored working ` +
        `material, so this is expected on a fresh clone and in CI — but it means nothing was ` +
        `compared, which is a refusal rather than a pass.`,
    )
  }
  const candidates = readdirSync(root)
    .map((name) => join(root, name, 'DESIGN.md'))
    .filter((p) => existsSync(p))
  if (candidates.length === 0) {
    throw new AuthorityMissing(`no DESIGN.md found under ${root}`)
  }
  if (candidates.length > 1) {
    throw new AuthorityMissing(
      `${candidates.length} design documents found under ${root}:\n` +
        candidates.map((c) => `    ${c}`).join('\n') +
        `\n  Which one the tokens are a verbatim copy of is not something this script may guess.`,
    )
  }
  return candidates[0]
}

/** The frontmatter: everything between the opening `---` line and the next one, plus its newline. */
export function frontmatterOf(source, path) {
  const m = /^---\r?\n([\s\S]*?\r?\n)---\r?\n/.exec(source)
  if (!m) {
    throw new AuthorityMissing(
      `${path} has no YAML frontmatter, so there is nothing for tokens.yaml to be a copy OF. The ` +
        `token system's entire source is that block.`,
    )
  }
  return m[1]
}

export function compare({ authorityPath, yamlPath = TOKENS_YAML } = {}) {
  const path = authorityPath ?? findAuthority()
  let source
  try {
    source = readFileSync(path, 'utf8')
  } catch (e) {
    // An unreadable authority is the same verdict as an absent one, and must carry the same
    // reasoning — an ENOENT stack alone reads like a broken script rather than a deliberate refusal.
    throw new AuthorityMissing(`${path} could not be read (${e.code ?? e.message})`)
  }
  const expected = frontmatterOf(source, path)
  const actual = readFileSync(yamlPath, 'utf8')
  if (expected === actual) return { verbatim: true, path, firstDiffLine: null }

  const a = actual.split('\n')
  const b = expected.split('\n')
  let firstDiffLine = null
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      firstDiffLine = i + 1
      break
    }
  }
  return { verbatim: false, path, firstDiffLine, expected, actual }
}

const entrypoint = process.argv[1] ? realpathSync(resolve(process.argv[1])) : null
if (entrypoint && entrypoint === realpathSync(fileURLToPath(import.meta.url))) {
  const named = process.argv[2]
  try {
    const result = compare({ authorityPath: named ? resolve(named) : undefined })
    if (!result.verbatim) {
      console.error(
        `apps/web/design/tokens.yaml is NOT the verbatim frontmatter of ${result.path} ` +
          `(first difference at line ${result.firstDiffLine}).\n` +
          `The design document is the authority and tokens.yaml is its committed copy — so copy ` +
          `the frontmatter across again and run \`npm run render:tokens\`. If the change belongs ` +
          `in the tokens rather than in the design, make it in the design document first.`,
      )
      process.exit(1)
    }
    console.log(`design tokens: tokens.yaml is verbatim from ${result.path}`)
  } catch (e) {
    if (e instanceof AuthorityMissing) {
      console.error(
        `REFUSING to report a verdict: ${e.message}\n` +
          `  Exit 2 rather than 0 on purpose — "the authority is missing" and "the copy is ` +
          `correct" are different answers, and reporting the second when the first is true is how ` +
          `a stale copy gets ratified.`,
      )
      process.exit(2)
    }
    console.error(e.message ?? e)
    process.exit(2)
  }
}
