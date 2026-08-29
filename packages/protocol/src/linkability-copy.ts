//
// Every sentence the linkability meter can say (story 6.7b).
//
// ── A LEAF THAT IMPORTS NOTHING, FOR THE REASON `disclosure-copy.ts` RECORDS ──────────────
//
// Sentences live apart from the model so a surface cannot quietly paraphrase one, and this file
// imports nothing so it stays loadable under plain Node type stripping the way its siblings are.
//
// ── EVERY LIVE NUMBER IS A PARAMETER, NEVER A LITERAL ─────────────────────────────────────
//
// The planning documents write these sentences with their example values baked in — `one of 12
// possible sources`, `above ~50 USDC`. Those examples are ILLUSTRATIONS OF A TEMPLATE, not the
// copy. `EPICS:709` is explicit that the ~50 is derived ("at current volume a crossing above ~50
// USDC trips the top tier, since largest-ever ≈ 45 USDC"), so typing `50` here would hardcode a
// measurement — the exact thing FR-052 bans. Every one of them is a function argument below.
//
// ── WHAT IS AUTHORED ELSEWHERE AND COPIED BYTE-EXACT, AND WHAT THIS STORY WROTE ───────────
//
// Byte-exact from canon: the verdict (C11:124, EXPERIENCE:115/:174/:797 — four concordant sites),
// the time axis (EXPERIENCE:793), the amount axis (EXPERIENCE:794), the fingerprint (DESIGN:422),
// the caret delta (DESIGN:421), the alternatives (EXPERIENCE:797), the Tier 2 CTA (EXPERIENCE:798),
// the self-link pair (C11:142, EXPERIENCE:743), the offline family (EXPERIENCE:76) and AD-14's
// provenance caption.
//
// NEWLY AUTHORED HERE, and recorded as such in the spec's change log: the Tier 2 headline and the
// alone-in-the-crowd sentence. The Tier 0 headline is not new — it is the canonical verdict's FIRST
// CLAUSE with the second dropped, because the second clause ("is not enough to hide you") is a
// judgement that is false at Tier 0. Reusing the clause keeps one grammar across all three tiers.
//
// ── ON `DESIGN:422` HAVING NO TERMINAL PERIOD ─────────────────────────────────────────────
//
// The fingerprint sentence is authored without one, and it is reproduced that way rather than
// silently corrected. Editing authored privacy copy to taste is how a claim drifts. Flagged for
// Abu in the change log; if he rules it a typo, it changes here and nowhere else.
//

/** AD-14's provenance caption. The `·` is U+00B7 and the block number is always rendered. */
export function provenanceCaption(blockNumber: number): string {
  return `Drawn in your browser from on-chain events · as of block ${blockNumber}`
}

/**
 * The canonical verdict, whose second clause SPELLS the count out.
 *
 * `Your exit is one of 12 possible sources. Twelve is not enough to hide you.`
 *
 * The spelling is not decoration — it is what stops the number reading as a score. A digit repeated
 * twice in two sentences invites comparison against some other digit; a word does not.
 */
export function verdictSentence(candidates: number): string {
  return `Your exit is one of ${candidates} possible sources. ${capitalize(
    spellOut(candidates),
  )} is not enough to hide you.`
}

/**
 * Tier 0: the verdict's first clause alone. States the count and its denominator, judges nothing.
 */
export function healthySentence(candidates: number): string {
  return `Your exit is one of ${candidates} possible sources.`
}

/**
 * Exactly one candidate. NEWLY AUTHORED.
 *
 * `verdictSentence(1)` would read "one of 1 possible sources. One is not enough to hide you." —
 * ungrammatical, and worse, it states being alone as if it were a small number rather than the
 * absence of a crowd. The I/O matrix requires this case be named in words, so it is.
 */
export const ALONE_SENTENCE =
  'Your exit is the only one of its kind right now. There is no crowd to hide in.'

/** Time axis (EXPERIENCE:793). The window carries the denominator, so the verdict need not. */
export function timeAxisSentence(candidates: number, window: string): string {
  return `${candidates} addresses shielded USDC in ${window}.`
}

/** Amount axis (EXPERIENCE:794). */
export function amountAxisSentence(largestEver: string): string {
  return `The largest crossing this pool has ever carried is ${largestEver} USDC. A larger exit would be the largest ever made and trivially identifiable.`
}

/**
 * The fingerprint (DESIGN:422). Em dash is U+2014; the `~` and the figure are both authored, but
 * the FIGURE is interpolated from the live largest-ever read and never typed.
 */
export function fingerprintSentence(approxLargest: string): string {
  return `A crossing above ~${approxLargest} USDC is currently unique — it identifies you by itself`
}

/**
 * Tier 2 headline. NEWLY AUTHORED.
 *
 * Says only what was measured: the amount exceeds every crossing in the read. It does NOT say the
 * exit is traceable, deanonymised, or linked — those are claims about an adversary's success that
 * this module has no measurement for, and AD-6 forbids implying them.
 */
export const LARGEST_EVER_SENTENCE =
  'This exit would be the largest this pool has ever carried. Size alone would identify it.'

/** The caret delta (DESIGN:421). `▲` is U+25B2. Only ever rendered for a positive change. */
export function caretDelta(delta: number): string {
  return `▲ +${delta} since you opened this screen.`
}

/**
 * The two named alternatives (EXPERIENCE:797) and the Tier 2 CTA (EXPERIENCE:798).
 *
 * These are LABELS. The square brackets in the source documents are notation for "this is a
 * control", not characters in the string. Whether either renders as a button is the caller's to
 * decide by supplying an action — `Disclosure.tsx:88`'s rule, copied exactly.
 */
export const WAIT_FOR_DEPOSITS = 'Wait for more deposits'
export const SPLIT_THE_AMOUNT = 'Split the amount'
export const EXIT_ANYWAY = 'Exit anyway'

/** The self-link pair (C11:142, EXPERIENCE:743). */
export const SELF_LINK_SENTENCE =
  'This is the wallet you funded from. Sending here republishes exactly the link you just paid to break.'
export const SELF_LINK_WAY_OUT = 'Use a fresh address instead'

/**
 * The unmeasurable crowd (EXPERIENCE:76), one of a fixed family of three in a fixed order.
 *
 * Sourced rather than authored deliberately: a new sentence here would be a fourth way of saying
 * the same thing, and the offline family is already the app's vocabulary for it.
 */
export const INDEXER_UNREACHABLE = 'Our indexer is unreachable'

/**
 * What the unmeasurable state says UNDERNEATH the sourced reason. NEWLY AUTHORED.
 *
 * Says what is missing and what that does and does not mean. Deliberately not "your exit is
 * unsafe" — we do not know that, we know we could not measure it, and the review stays passable.
 * Every word here is about OUR failure to read, never about the user's exposure.
 */
export const UNMEASURABLE_CONSEQUENCE =
  'The crowd could not be measured, so this screen makes no claim about it.'

//
// ── THE NUMBER SPELLER ────────────────────────────────────────────────────────────────────
//
// Needed by exactly one clause, and total over 0–9999 because a partial speller would need a
// fallback and a fallback would be a second sentence variant nobody authored.
//
// The range is total ENOUGH rather than unbounded: the clause only renders in the Tier 1 arm, which
// fires when the count is at or below the first quartile of the sample. A four-digit anonymity set
// is Tier 0 by construction and never reaches this function. Above the range it throws rather than
// returning a digit, because a sentence reading "1000000 is not enough to hide you" would be the
// grammar breaking silently.
//

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
] as const

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const

function underHundred(n: number): string {
  if (n < 20) return ONES[n]!
  const tens = TENS[Math.floor(n / 10)]!
  const ones = n % 10
  return ones === 0 ? tens : `${tens}-${ONES[ones]!}`
}

/** An integer 0–9999 in words, lowercase. Hyphenated compounds, no `and` — American style. */
export function spellOut(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) {
    throw new Error(
      `spellOut covers whole numbers 0–9999, received ${String(n)}. A count outside that range ` +
        'cannot reach the sentence that uses it, so this is a bug rather than a missing case.',
    )
  }
  if (n < 100) return underHundred(n)
  if (n < 1000) {
    const rest = n % 100
    return rest === 0
      ? `${ONES[Math.floor(n / 100)]!} hundred`
      : `${ONES[Math.floor(n / 100)]!} hundred ${underHundred(rest)}`
  }
  const rest = n % 1000
  const thousands = `${underHundred(Math.floor(n / 1000))} thousand`
  return rest === 0 ? thousands : `${thousands} ${n % 1000 < 100 ? underHundred(rest) : spellOut(rest)}`
}

/** First letter upper, rest untouched — so `twenty-six` becomes `Twenty-six`, not `Twenty-Six`. */
export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1)
}

//
// ── THE DOT-SCATTER EXPLAINER (Wave 4) ────────────────────────────────────────────────────
//
// The note field draws one dot per member of the anonymity set and has, until now, been captioned
// only "N possible sources, including yours". Abu's verdict on it was "nodes I don't even
// understand" — and he was right: a scatter of dots with no legend is decoration wearing the
// costume of information.
//
// So the picture keeps its place, behind a chevron, and earns it with a sentence that says what a
// dot IS. Two sentences, not one, because there are two facts and they are different in kind: what
// every dot means, and which one is the reader's.
//
// NEWLY AUTHORED HERE. It makes no claim the meter was not already making — the count, the
// membership and the provenance are unchanged — it only names what the reader is looking at.
//

/** What every dot in the scatter is. */
export const FIELD_DOT_MEANING =
  'Each dot is one deposit that could be the source of this transaction.'

/** Which dot is theirs — and the honest answer is that nobody can tell, which IS the point. */
export const FIELD_DOT_YOURS =
  'Yours is one of them. Nothing on this page, and nothing on chain, says which.'
