//
// The pool's registration fee, read live.
//
// ── WHY THIS HOOK EXISTS AT ALL ───────────────────────────────────────────────────────────
//
// `context/11-product-experience.md` opens with a rule that governs the whole product: no STRK
// amount, no user count, no duration and no fee ever appears as a hardcoded string. Fees come from
// `get_fee_amount()` at render.
//
// That is not pedantry. The fee is mutable on-chain with a zero upgrade delay — it was documented
// at 4 STRK and measured at 6 — so a literal in the onboarding copy is a number that becomes wrong
// without anybody editing it, on the one screen where a stranger is deciding whether to trust the
// app about money.
//
// ── AND WHY `null` IS A RENDERABLE ANSWER ─────────────────────────────────────────────────
//
// A failed read returns `null`, and the caller renders the sentence WITHOUT a number rather than
// guessing one. "We are paying it" is true whether or not the RPC answered; inventing the amount to
// keep the sentence tidy would be exactly the invented measurement the rule bans.
//
import { useEffect, useState } from 'react'

/** Formatted for display, or `null` when the chain could not be asked. */
export function usePoolFee(): string | null {
  const [fee, setFee] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    // DYNAMIC, and the build gate is what taught me it had to be. `pool.ts` is loaded lazily
    // everywhere else in the app; one static import here would have pulled it into the eager chunk
    // and quietly undone that for every surface — the gate reported it as an INEFFECTIVE_DYNAMIC_IMPORT
    // rather than letting it ship.
    import('@strk20/protocol/pool')
      .then(({ readPoolConstants }) => readPoolConstants())
      .then((constants) => {
        if (!live) return
        // Two decimals: the fee is a whole number of STRK today and a fraction is possible, and
        // rendering `6` where the chain says `6.5` would understate what somebody is paying.
        const whole = constants.feeWei / 10n ** 18n
        const hundredths = (constants.feeWei % 10n ** 18n) / 10n ** 16n
        setFee(hundredths === 0n ? `${whole}` : `${whole}.${hundredths.toString().padStart(2, '0')}`)
      })
      .catch(() => {
        // Left null. See the header: the sentence renders without a number rather than with a
        // guess at one.
        if (live) setFee(null)
      })
    return () => {
      live = false
    }
  }, [])

  return fee
}
