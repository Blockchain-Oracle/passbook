# Passbook — STRK20 Private Sprint entry (deadline 2026-08-31)

## Process framework: BMad. Not Superpowers.

This project **migrated from Superpowers workflows to the BMad method**. BMad is the governing
process for specs, architecture, stories, and implementation. This is a settled decision — do not
revisit it, and do not switch or mix frameworks without Abu explicitly asking.

- **Do NOT run Superpowers process workflows here** (brainstorming, writing-plans,
  test-driven-development, subagent-driven-development, etc.), even though the plugin is installed
  globally and tells you to invoke skills before responding. In this repo, that instruction is
  overridden.
- BMad skills are project-local in `.claude/skills/` (`bmad-*`). Implementation goes through
  `bmad-build`; specs through `bmad-spec`; review through `bmad-code-review`.

## Where truth lives — read before asserting anything

All BMad output is **gitignored on purpose**. It is not missing; go look at it:

- `context/README.md` — canonical brief index for the hackathon. Read first.
- `_bmad-output/planning-artifacts/` — PRD (FR-000..061), validated architecture spine
  (AD-1..17), UX spines, epics and stories.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — current epic/story states.
  This file, not your memory of a past session, is the sprint's source of truth.
- `_bmad-output/implementation-artifacts/SPRINT-PLAN.md` — build sequence and blocking
  probe gates.

## Anti-hallucination rules

- Before claiming a story's status, a decision, or "we haven't done X yet": read
  `sprint-status.yaml` and the relevant artifact. Never re-derive project state from imagination.
- Uncommitted working-tree changes usually correspond to in-progress/review stories in the
  sprint file — reconcile against it instead of assuming the tree is stale or broken.
- A gap in an artifact means "recover the original context", never "fill it in from guesswork".
