//
// The pipeline stage vocabulary, as one leaf both pipelines and every renderer share (story 6.5).
//
// ── WHY THIS IS A LEAF, AND WHY IT IS NOT IN `send.ts` ────────────────────────────────────
//
// `SendStage` and `RegistrationStage` were declared beside the code that emits them, which was
// right until something had to RENDER them. `send.ts` reaches the privacy SDK and `register.ts`
// reaches the relayer wire, so a component importing either for a five-string union drags a chain
// client into the browser bundle — the exact defect story 6.4 measured at 268 kB for one integer
// (see `token-scale.ts`, split out of `balances.ts` for the same reason).
//
// So the vocabulary moves down here, where it has no imports at all, and `send.ts` / `register.ts`
// re-export their own names from it. NO EXISTING CALLER CHANGED. That is the whole trick: the
// names stay where every reader expects to find them, and the bytes stop travelling with them.
//
// ── WHY REGISTRATION HAS FOUR AND A SEND HAS FIVE ─────────────────────────────────────────
//
// A registration mints no note, so there is nothing to mature. The asymmetry is a protocol fact
// (see `register.ts`'s header), which is why it lives in the TYPE rather than in a component that
// checks `if (isRegistration) skipMature`. A renderer that takes the stage list as data cannot get
// this wrong, because it never knows which pipeline it is drawing.
//

/** The five stages a send passes through, in order. */
export type SendStage = 'build' | 'prove' | 'relay' | 'mature' | 'confirmed'

/** The four a sponsored registration passes through. `mature` is absent on purpose. */
export type RegistrationStage = 'build' | 'prove' | 'relay' | 'confirmed'

/**
 * Every stage ANY of the pipelines can be at. The renderer's input type.
 *
 * It was `SendStage` alone while there were two pipelines and registration's stages were a subset
 * of a send's. Account creation is the third and its rungs are its own words — see
 * `OnboardingStage` below — so the renderer's input is now the union rather than one member of it.
 * `ProgressMachine` is unaffected by design: its own header says it "knows nothing about which
 * pipeline it is drawing", and this is that claim being cashed rather than tested.
 */
export type PipelineStage = SendStage | OnboardingStage

export const SEND_STAGES: readonly SendStage[] = ['build', 'prove', 'relay', 'mature', 'confirmed']

export const REGISTRATION_STAGES: readonly RegistrationStage[] = [
  'build',
  'prove',
  'relay',
  'confirmed',
]

/**
 * The four rungs of ACCOUNT CREATION, which is a different journey from either pipeline above.
 *
 * ── WHY A THIRD LIST AND NOT A REUSE ─────────────────────────────────────────────────────
 *
 * `RegistrationStage` names the four steps of the registration TRANSACTION. Account creation is
 * bigger than that transaction: money has to arrive, an address has to be deployed, and only then
 * is there something to register. Those first two have no member in the send vocabulary — `build`
 * and `prove` say nothing about a faucet — so naming them with it would be a label that lies.
 *
 * ── EACH RUNG IS A REAL CALLBACK, WHICH IS THE WHOLE POINT ───────────────────────────────
 *
 * `drip` resolves when the relayer answers, `deploy` when the account contract lands, `register`
 * spans the registration's own `build`/`prove`/`relay`, and `confirm` is its `confirmed`. Nothing
 * here advances on a timer. The prototype this is ported from animates its ladder on a fixed
 * `[1500,1700,2300,1100]` — that is a mockup's privilege, and copying it would be a progress bar
 * that reports the passage of time as if it were the progress of a transaction.
 */
export type OnboardingStage = 'drip' | 'deploy' | 'register' | 'confirm'

export const ONBOARDING_STAGES: readonly OnboardingStage[] = [
  'drip',
  'deploy',
  'register',
  'confirm',
]

/**
 * The row title per stage — one table, so six surfaces cannot spell `Relay` six ways.
 *
 * Present tense nouns, not verbs in flight: the row title names the STEP and the right-hand slot
 * carries what is happening to it. `Proving — 0:14 elapsed` belongs in the label ladder
 * (`progress.ts`), not here, or the title would change width as the counter ticks and the row
 * would reflow — which §7.7 forbids at 40px.
 */
export const STAGE_TITLES: Readonly<Record<PipelineStage, string>> = {
  build: 'Build',
  prove: 'Prove',
  relay: 'Relay',
  mature: 'Mature',
  confirmed: 'Confirmed',
  // Account creation's four. They live HERE, in the one table, for the reason the table exists —
  // and not beside their notes in `onboarding-copy.ts`, which would have made a second place to
  // spell `Register` and guaranteed the two would eventually disagree.
  drip: 'Drip lands',
  deploy: 'Deploy',
  register: 'Register',
  confirm: 'Confirm',
}

/**
 * Whether WE compute this stage, or whether it is handed to somebody else.
 *
 * THIS PREDICATE IS THE HONESTY RULE, and it is a function rather than a comment so that no call
 * site can decide otherwise. A determinate progress bar is a claim that the remaining work is
 * knowable. That is true while we build a transaction locally and false for every stage below:
 *
 *   - `prove`   runs on StarkWare's hosted prover. Not ours, no progress channel, and the §5 state
 *               table is explicit — "never a determinate fill, never phase names we can't observe".
 *   - `relay`   is the relayer's queue.
 *   - `mature`  is the chain's block cadence, which is counted in blocks, never in percent.
 *
 * NOTE FOR ANYONE RECONCILING THE AUTHORITIES: DESIGN §7.7 writes "determinate while you own the
 * computation (build, prove)" and EXPERIENCE §4.2 writes "(build)" plus "the hosted prover is
 * ALWAYS the indeterminate ring". They contradict each other and EXPERIENCE is the specific one —
 * it names the mechanism and the reason. Do not "fix" this back to include `prove`.
 */
export function ownsComputation(stage: PipelineStage): boolean {
  return stage === 'build'
}
