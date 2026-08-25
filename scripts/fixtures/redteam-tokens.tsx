//
// RED-TEAM FIXTURE — every line here must FAIL `scripts/lint-tokens.mjs`.
//
// This file is not an example of anything. It is the adversary: each numbered line below was
// executed against the real Tailwind 4.3.3 compiler under the FULL 21-namespace theme wipe and
// confirmed to compile and paint. It also passes all three of the naive gates that get proposed
// instead of an allowlist — it contains no hex in a class, no "ms" substring, and it builds green.
// If the lint ever passes this file, the lint has stopped working; `lint-tokens.test.mjs` asserts
// every line is reported, and asserts that removing one line removes exactly its finding.
//
// WHY IT LIVES IN scripts/fixtures/ AND NOT UNDER apps/web. The framework's scan root is the
// nearest package.json to the stylesheet, i.e. `apps/web`. A fixture full of banned classes placed
// inside it would be scanned like any component and every one of these utilities would be compiled
// into the stylesheet the app actually ships.
//
// This file is never imported, never built and never typechecked as part of the app.
//
export function RedTeam() {
  return (
    <div>
      {/* H1 · arbitrary values — three bypass syntaxes, none of which the theme can close */}
      <span className="bg-[#f00]" />
      <span className="bg-[oklch(0.7_0.2_20)]" />
      <span className="bg-[light-dark(white,black)]" />
      <span className="bg-(--smuggled)" />
      <span className="[background-color:rebeccapurple]" />
      <span className="rounded-[13px]" />
      <span className="ease-[cubic-bezier(0.1,0.2,0.3,0.4)]" />
      <span className="shadow-[0_0_0_1px_#0f0]" />

      {/* H2 · bare-value motion — immune to every wipe; seconds dodge an `ms` regex entirely */}
      <span className="duration-300" />
      <span className="delay-150" />
      <span className="hover:duration-700" />
      <span className="duration-[0.35s]" />
      <span className="[transition-duration:0.42s]" />

      {/* H3 · bare-value utilities with no bracket, no hex, no unit — what a deny-pattern misses */}
      <span className="opacity-45" />
      <span className="rotate-33" />
      <span className="scale-125" />
      <span className="border-2" />
      <span className="ring-2" />
      <span className="decoration-2" />
      <span className="underline-offset-4" />
      <span className="brightness-125" />
      <span className="z-50" />
      <span className="w-1/2" />
      <span className="from-10%" />
      <span className="rounded-full" />

      {/* H4 · the opacity modifier: 101 off-sheet colours per token, one of them chosen at runtime */}
      <span className="bg-ground/50" />
      <span className="text-neutral1/[var(--o)]" />

      {/* H5 · the hardcoded hairline that survives both spacing options */}
      <span className="p-px" />
      <span className="m-px" />

      {/* H9 · silent no-ops under whole-value shadow indirection — these compile and do NOTHING */}
      <span className="shadow-short/50" />
      <span className="shadow-medium shadow-accent1" />

      {/* The spacing trap: `p-4` is the ecosystem's strongest prior and means nothing here */}
      <span className="p-4" />

      {/* An arbitrary VARIANT — a breakpoint written as a value rather than as a name */}
      <span className="min-[500px]:p-s4" />

      {/* H8 · a raw hex that never touches a class attribute at all */}
      <span style={{ color: '#8C2F1E' }} />
      <svg viewBox="0 0 10 10">
        <circle cx="5" cy="5" r="4" fill="#A32318" />
      </svg>

      {/* A variants map — the class strings live in a plain object, not in an attribute */}
      <span className={VARIANTS.danger} />

      {/*
        A WRAPPED class list, which is how any real component writes one. Two things here that a
        single-line fixture can never exercise: each class must be reported at the line it is
        actually written on (not at the line the attribute opens), and `opacity-30` appears TWICE on
        two different lines and must be reported TWICE — a dedupe keyed on the attribute's line
        collapses them into one and silently drops the second.
      */}
      <span
        className="bg-ground
          opacity-30
          rotate-12
          opacity-30 tracking-tight"
      />

      {/* Prose with an apostrophe, immediately above a comment. Not a finding — but an unpaired
          quote used to swallow the rest of the file, so what follows it stops being scanned. */}
      <p>Don't send what you can't undo</p>
    </div>
  )
}

const VARIANTS = {
  danger: 'text-[#ff0000] duration-500',
}
