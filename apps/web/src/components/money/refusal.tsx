// The one shape a refusal takes, on every surface that can refuse.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────
//
// "You asked, and it did not happen" used to reach a user three different ways. Shield and unshield
// put it in the review sheet's red row. Swap and send folded it into `blocker`, which renders MUTED
// — so a failed swap looked like a disabled button rather than a refusal. The other nine raised a
// toast, which floats away from the sheet that caused it and leaves the sheet looking untouched.
//
// A user learns the colour of a refusal exactly once. Three colours teach them the app is guessing.
// So a refusal is red, it sits above the button that caused it, and it stays until it is replaced.
import { useCallback, useState } from 'react'
import { ExternalLink } from 'lucide-react'

import { explorerTx } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface Refusal {
  sentence: string
  /** The transaction, when one was submitted. A refusal you cannot look up is hard to report. */
  hash: string | null
}

export interface RefusalHandle {
  refusal: Refusal | null
  /** Say what did not happen. Never expires on its own — only `clear` removes it. */
  refuse: (sentence: string | null | undefined, hash?: string | null) => void
  /** The old reason is no longer about this attempt: call on reopen and on input changes. */
  clear: () => void
}

// A refusal with no sentence is still a refusal. Saying nothing would render an empty red box,
// which reads as a rendering bug rather than an outcome.
const UNSPOKEN = 'It did not go through, and no reason came back.'

/** The last refusal on this surface, held until the surface is used again. */
export function useRefusal(): RefusalHandle {
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const refuse = useCallback(
    (sentence: string | null | undefined, hash: string | null = null) =>
      setRefusal({ sentence: sentence?.trim() || UNSPOKEN, hash }),
    [],
  )
  const clear = useCallback(() => setRefusal(null), [])
  return { refusal, refuse, clear }
}

/** Accepts the plain sentence too, so a caller with nothing to link stays a one-liner. */
export function asRefusal(problem: string | Refusal | null | undefined): Refusal | null {
  if (!problem) return null
  return typeof problem === 'string' ? { sentence: problem, hash: null } : problem
}

/**
 * The red row. `role="alert"` because a refusal that only screen paint announces is not announced.
 */
export function RefusalRow({ refusal, className }: { refusal: Refusal | null; className?: string }) {
  if (!refusal) return null
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-irreversible/40 bg-irreversibleTint px-3 py-2 text-body4 text-irreversible',
        className,
      )}
    >
      <p>{refusal.sentence}</p>
      {refusal.hash ? (
        <a
          href={explorerTx(refusal.hash)}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 underline underline-offset-2"
        >
          View the transaction
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  )
}
