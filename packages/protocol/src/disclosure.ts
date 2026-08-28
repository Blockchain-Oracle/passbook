//
// The disclosure panel's model (story 6.7, DESIGN §7.5, EXPERIENCE §4.3).
//
// "One `<Disclosure>` component, REQUIRED ON EVERY REVIEW — a surface renders one or explicitly
// asserts none." This is the half of it that is data: which lines a review states, which way each
// one points, how loud the panel is, and whether there is a safer path to offer. The React half is
// `apps/web/src/components/Disclosure.tsx` and it holds the nodes and the callbacks.
//
// ── THE MODEL IS DATA; THE COMPONENT IS REACT ─────────────────────────────────────────────
//
// `option-row.ts:29-36`'s rule, and the reason is mechanical rather than aesthetic:
// `vitest.config.ts:12` collects `packages/*/test/**` only, so a table written in `apps/web/src` is
// a table no runner executes. Nothing here is a React node and nothing here is a callback — the way
// out is a LABEL, and the action that fulfils it is a prop on the component.
//
// ── A GREEN TICK BESIDE A CRITICAL CLAIM IS A LIE ─────────────────────────────────────────
//
// Each line carries a marker: `leaves` (↗, this leaves the private domain) or `stays` (✓, this
// stays private). A `stays` line at `medium` or above is a self-contradiction — it would render a
// reassuring tick next to a sentence the panel is simultaneously colouring as a risk — so the
// union below makes it unspellable, and `assertHonestLine` runs over the whole table at module load
// for the values that arrive from outside the type system.
//
// ── AND TWO CONTEXTS HAVE NO PANEL AT ALL ─────────────────────────────────────────────────
//
// The Markets early exit and the Launch sell have no disclosure prose in any source. They are
// declared `authored: false` carrying the same refusal sentence `visibility-matrix.ts` carries,
// read from that module rather than retyped, so the two never disagree about why.
//

import { maxSeverity, PRIVACY_SEVERITY, severityRank, type PrivacySeverity } from './privacy.js'
import {
  AUDITOR_ESCROW,
  BRIDGE_DESTINATION_GAS,
  BRIDGE_IRREVERSIBLE,
  BRIDGE_WAY_OUT,
  CHAT_AUDITOR_DERIVES,
  DISCLOSURE_HEADLINE,
  GOV_NOT_ANONYMITY,
  GOV_TELLER_PEEK,
  LAUNCH_CROWD,
  MARKETS_DENOMINATIONS,
  NOTES_STAY,
  REGISTRATION_ESCROW_PINNED,
  REGISTRATION_NO_VALUE,
  RELAYER_SEES,
  SELF_SUBMIT_NO_RELAYER,
  SELF_SUBMIT_WAY_OUT,
  SWAP_OBSERVER,
  SWAP_RELAY_QUOTE,
  SWAP_RETURNS_TO_YOU,
} from './disclosure-copy.js'
import { matrixFor, type VisibilityContext } from './visibility-matrix.js'

/** ↗ leaves the private domain · ✓ stays private. DESIGN §7.5 part 1. */
export type DisclosureMarker = 'leaves' | 'stays'

/**
 * One stated consequence.
 *
 * The `stays` arm is NARROWED, and that narrowing is the contradiction rule expressed as a type:
 * there is no way to write a green tick beside a claim the panel colours as a risk, because the
 * severity field on that arm does not admit one.
 */
export type DisclosureLine =
  | { readonly text: string; readonly marker: 'leaves'; readonly severity: PrivacySeverity }
  | { readonly text: string; readonly marker: 'stays'; readonly severity: 'none' | 'low' }

export interface DisclosurePanel {
  readonly authored: true
  readonly context: VisibilityContext
  /**
   * In reading order, and the FIRST ONE IS THE HEADLINE — the line that takes the panel's semantic
   * colour while every other line is forced to `neutral2 body3` (DESIGN §7.5: "coloured claim,
   * neutral explanation"). Written as position rather than as a separate field so a panel cannot be
   * built with two headlines or with none.
   */
  readonly lines: readonly DisclosureLine[]
  /**
   * The safer path, as a label and nothing more.
   *
   * `null` where no safer path exists. The component renders the button ONLY when the caller also
   * supplies the action that fulfils it: a stated recovery wired to a no-op is the overclaim story
   * 6.10 exists to catch, and a label alone cannot become one.
   */
  readonly wayOut: { readonly label: string } | null
}

export interface UnauthoredDisclosure {
  readonly authored: false
  readonly context: VisibilityContext
  readonly because: string
}

export type Disclosure = DisclosurePanel | UnauthoredDisclosure

const leaves = (text: string, severity: PrivacySeverity): DisclosureLine => ({
  text,
  marker: 'leaves',
  severity,
})

const stays = (text: string): DisclosureLine => ({ text, marker: 'stays', severity: 'low' })

/**
 * The refusal sentence, read from the matrix rather than retyped beside it.
 *
 * Throws for an authored context, which makes this the same kind of guard the table it feeds is:
 * the day somebody authors a matrix for one of these two and forgets the panel, this is where the
 * inconsistency stops rather than where it is copied.
 */
function unauthoredReason(context: VisibilityContext): string {
  const matrix = matrixFor(context)
  if (matrix.authored) {
    throw new Error(
      `\`${context}\` has an authored visibility matrix, so declaring its disclosure unauthored ` +
        'would leave the two halves of one review disagreeing about whether it was written.',
    )
  }
  return matrix.because
}

/**
 * EVERY LINE HERE IS A PRIVACY CLAIM, and its severity is a second one — DESIGN §2.3's ladder puts
 * `irreversible` on "this deanonymizes you / links you publicly" and `exposed` on "this reveals",
 * and everything routine at neutral. Three calls worth reading before they are changed:
 *
 *   SELF-SUBMIT IS `high`. It publishes the user's own address as the sender of a pool action —
 *   a public link between a wallet and pool activity that cannot be unpublished, which is the
 *   ladder's own definition of the top colour. The relayed path costs nothing and is the default,
 *   so the panel also offers it as the way out rather than only naming the cost.
 *
 *   SWAP IS `low`, DELIBERATELY. Its amounts are public and that is the loudest thing about it, but
 *   EXPERIENCE §S1.4 rules that the swap CTA is INK and "the only loud element is the disclosure
 *   block". Severity routes to the CTA, so a `medium` here would repaint a button the design
 *   authority pins. The panel is loud by being the only thing on the screen, not by colour.
 *
 *   MARKETS AND LAUNCH ARE `low` even though both carry a conditional identity claim. The
 *   escalation for "you are alone at this size" belongs to the linkability meter, which reads a
 *   LIVE crowd count; a constant cannot know whether the condition holds, and colouring the CTA as
 *   though it always does would spend the warning on every bet ever placed.
 */
const TABLE = {
  'pool-send': {
    authored: true,
    context: 'pool-send',
    lines: [
      leaves(DISCLOSURE_HEADLINE['pool-send'], 'low'),
      stays(NOTES_STAY),
      leaves(RELAYER_SEES, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: null,
  },

  'self-submit': {
    authored: true,
    context: 'self-submit',
    lines: [
      leaves(DISCLOSURE_HEADLINE['self-submit'], 'high'),
      stays(NOTES_STAY),
      leaves(SELF_SUBMIT_NO_RELAYER, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: { label: SELF_SUBMIT_WAY_OUT },
  },

  registration: {
    authored: true,
    context: 'registration',
    lines: [
      leaves(DISCLOSURE_HEADLINE.registration, 'low'),
      leaves(REGISTRATION_ESCROW_PINNED, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
      stays(REGISTRATION_NO_VALUE),
    ],
    wayOut: null,
  },

  'chat-payment': {
    authored: true,
    context: 'chat-payment',
    lines: [
      leaves(DISCLOSURE_HEADLINE['chat-payment'], 'medium'),
      leaves(CHAT_AUDITOR_DERIVES, 'low'),
      stays(NOTES_STAY),
    ],
    wayOut: null,
  },

  swap: {
    authored: true,
    context: 'swap',
    lines: [
      leaves(DISCLOSURE_HEADLINE.swap, 'low'),
      leaves(SWAP_OBSERVER, 'low'),
      leaves(SWAP_RELAY_QUOTE, 'low'),
      stays(SWAP_RETURNS_TO_YOU),
    ],
    wayOut: null,
  },

  'bridge-exit': {
    authored: true,
    context: 'bridge-exit',
    lines: [
      leaves(DISCLOSURE_HEADLINE['bridge-exit'], 'medium'),
      leaves(BRIDGE_IRREVERSIBLE, 'high'),
      leaves(BRIDGE_DESTINATION_GAS, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: { label: BRIDGE_WAY_OUT },
  },

  'markets-bet': {
    authored: true,
    context: 'markets-bet',
    lines: [
      leaves(DISCLOSURE_HEADLINE['markets-bet'], 'low'),
      stays(MARKETS_DENOMINATIONS),
      leaves(RELAYER_SEES, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: null,
  },

  'markets-exit': {
    authored: false,
    context: 'markets-exit',
    because: unauthoredReason('markets-exit'),
  },

  'launch-buy': {
    authored: true,
    context: 'launch-buy',
    lines: [
      leaves(DISCLOSURE_HEADLINE['launch-buy'], 'low'),
      stays(LAUNCH_CROWD),
      leaves(RELAYER_SEES, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: null,
  },

  'launch-sell': {
    authored: false,
    context: 'launch-sell',
    because: unauthoredReason('launch-sell'),
  },

  // ── The Houses (docs/governance.md §15's shipped sentences). The Teller is a NAMED party on
  //    the ballot panel, beside the relayer and the auditor — that placement is the disclosure.
  'gov-ballot': {
    authored: true,
    context: 'gov-ballot',
    lines: [
      leaves(DISCLOSURE_HEADLINE['gov-ballot'], 'low'),
      leaves(GOV_TELLER_PEEK, 'low'),
      leaves(GOV_NOT_ANONYMITY, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: null,
  },

  'gov-join': {
    authored: true,
    context: 'gov-join',
    lines: [
      leaves(DISCLOSURE_HEADLINE['gov-join'], 'low'),
      stays(NOTES_STAY),
      leaves(RELAYER_SEES, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: null,
  },

  'gov-delegate': {
    authored: true,
    context: 'gov-delegate',
    lines: [
      leaves(DISCLOSURE_HEADLINE['gov-delegate'], 'low'),
      stays(NOTES_STAY),
      leaves(RELAYER_SEES, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: null,
  },

  'gov-fund': {
    authored: true,
    context: 'gov-fund',
    lines: [
      leaves(DISCLOSURE_HEADLINE['gov-fund'], 'medium'),
      stays(NOTES_STAY),
      leaves(RELAYER_SEES, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: null,
  },

  'gov-reclaim': {
    authored: true,
    context: 'gov-reclaim',
    lines: [
      leaves(DISCLOSURE_HEADLINE['gov-reclaim'], 'low'),
      stays(NOTES_STAY),
      leaves(RELAYER_SEES, 'low'),
      leaves(AUDITOR_ESCROW, 'low'),
    ],
    wayOut: null,
  },
} as const satisfies Record<VisibilityContext, Disclosure>

/**
 * Whether a line contradicts itself: a green tick on a claim above `low`.
 *
 * Typed loosely on purpose. The union already makes this unspellable in TypeScript, so the only
 * values that can reach it are ones that came from outside the compiler — a future table, a
 * deserialized panel, a test. This is what makes the rule enforced rather than merely declared.
 *
 * IT THROWS ON GARBAGE RATHER THAN RETURNING `false`. A predicate answering "no contradiction" for
 * an input it could not understand is worse than no predicate: it is the answer the caller wanted,
 * arrived at by not looking.
 */
export function contradicts(line: {
  marker: string
  severity: PrivacySeverity
  /** Unused here, and declared so a whole line can be handed over without being taken apart. */
  text?: string
}): boolean {
  // VALIDATED BEFORE THE MARKER IS EVEN LOOKED AT, and the order matters: with the short-circuit
  // the other way round, a `leaves` line carrying a level nobody declared never reached the check
  // at all — and `panelSeverity` would then skip it too, so the panel rendered calm over a claim
  // whose loudness was a typo.
  const rank = severityRank(line.severity)
  return line.marker === 'stays' && rank > PRIVACY_SEVERITY.low
}

export function assertHonestLine(line: { marker: string; severity: PrivacySeverity; text: string }): void {
  if (!contradicts(line)) return
  throw new Error(
    `refusing a "stays private" line at severity \`${line.severity}\`: the ✓ marker and a claim ` +
      `the panel colours as a risk are opposite statements about the same sentence — ${line.text}`,
  )
}

//
// RUN AT MODULE LOAD, over the shipped table, so both rules are asserted rather than commented. If a
// later edit reaches for a cast to get a louder tick past the compiler, the app fails to start
// instead of rendering the contradiction.
//
// THE SECOND RULE IS THE HALVES AGREEING. A panel and a matrix are two views of one review, and
// nothing structural stopped an authored panel sitting over an unauthored matrix — which renders
// four coloured privacy claims directly above "Nobody has written this one down". `unauthoredReason`
// catches the mirror case; this catches the one that is actually easy to reach, by authoring a panel
// for a context whose cells nobody has filled in.
//
for (const entry of Object.values(TABLE) as readonly Disclosure[]) {
  const matrix = matrixFor(entry.context)
  if (entry.authored !== matrix.authored) {
    throw new Error(
      `\`${entry.context}\` has ${entry.authored ? 'an authored panel over an unauthored matrix' : 'an unauthored panel over an authored matrix'}. ` +
        'The two halves of one review are written together or neither is — a panel stating privacy ' +
        'claims above a grid that says nobody wrote them down is the exact overclaim this story ' +
        'refuses.',
    )
  }
  if (!entry.authored) continue
  for (const line of entry.lines) assertHonestLine(line)
}

/**
 * The loudest level the panel states. DESIGN §7.5: "panel severity = max severity of its lines".
 *
 * Delegates to `privacy.ts` rather than comparing here. One implementation of "which of these is
 * worse" is the whole point of a gap-numbered ladder — a second one written inline is where the day
 * a level is inserted goes wrong.
 */
export function panelSeverity(panel: DisclosurePanel): PrivacySeverity {
  return maxSeverity(panel.lines.map((line) => line.severity))
}

/** The panel for one review. Never `undefined` — the `satisfies` above covers all ten contexts. */
export function disclosureFor(context: VisibilityContext): Disclosure {
  return TABLE[context]
}
