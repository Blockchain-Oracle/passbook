//
// Every sentence the linkability meter can say. A leaf that imports nothing, so a surface cannot
// quietly paraphrase one. EVERY LIVE NUMBER IS A PARAMETER, NEVER A LITERAL: the `~50 USDC` in the
// planning documents was a derived measurement, and typing it here would hardcode one.
//

/** The provenance caption. The `·` is U+00B7 and the block number is always rendered. */
export function provenanceCaption(blockNumber: number): string {
  return `Drawn in your browser from on-chain events · as of block ${blockNumber}`
}

/**
 * The canonical verdict, whose second clause SPELLS the count out: a digit repeated twice in two
 * sentences invites comparison against some other digit; a word does not.
 */
export function verdictSentence(candidates: number): string {
  return `Your exit is one of ${candidates} possible sources. ${capitalize(
    spellOut(candidates),
  )} is not enough to hide you.`
}

/** Tier 0: the verdict's first clause alone. States the count and its denominator, judges nothing. */
export function healthySentence(candidates: number): string {
  return `Your exit is one of ${candidates} possible sources.`
}

/** Exactly one candidate, named in words: `verdictSentence(1)` would state being alone as a small number. */
export const ALONE_SENTENCE =
  'Your exit is the only one of its kind right now. There is no crowd to hide in.'

/** Time axis. The window carries the denominator, so the verdict need not. */
export function timeAxisSentence(candidates: number, window: string): string {
  return `${candidates} addresses shielded USDC in ${window}.`
}

/** Amount axis. */
export function amountAxisSentence(largestEver: string): string {
  return `The largest crossing this pool has ever carried is ${largestEver} USDC. A larger exit would be the largest ever made and trivially identifiable.`
}

/** The fingerprint. Authored without a terminal period; reproduced rather than corrected. */
export function fingerprintSentence(approxLargest: string): string {
  return `A crossing above ~${approxLargest} USDC is currently unique — it identifies you by itself`
}

/**
 * Tier 2 headline. Says only what was measured — the amount exceeds every crossing in the read —
 * never that the exit is traceable or linked, which this module has no measurement for.
 */
export const LARGEST_EVER_SENTENCE =
  'This exit would be the largest this pool has ever carried. Size alone would identify it.'

/** The caret delta. `▲` is U+25B2. Only ever rendered for a positive change. */
export function caretDelta(delta: number): string {
  return `▲ +${delta} since you opened this screen.`
}

/** LABELS, not buttons: whether either renders as a control is the caller's to decide by supplying an action. */
export const WAIT_FOR_DEPOSITS = 'Wait for more deposits'
export const SPLIT_THE_AMOUNT = 'Split the amount'
export const EXIT_ANYWAY = 'Exit anyway'

/** The self-link pair. */
export const SELF_LINK_SENTENCE =
  'This is the wallet you funded from. Sending here republishes exactly the link you just paid to break.'
export const SELF_LINK_WAY_OUT = 'Use a fresh address instead'

/** The unmeasurable crowd — one of the app's fixed family of three offline sentences. */
export const INDEXER_UNREACHABLE = 'Our indexer is unreachable'

/** Under the sourced reason: what is missing and what that does not mean. About OUR failure to read, never the user's exposure. */
export const UNMEASURABLE_CONSEQUENCE =
  'The crowd could not be measured, so this screen makes no claim about it.'

// ── The number speller ────────────────────────────────────────────────────────────────────
//
// Total over 0–9999: the clause only renders in the Tier 1 arm, which fires at or below the first
// quartile of the sample, so a four-digit anonymity set never reaches it. Above the range it throws
// rather than returning a digit, because "1000000 is not enough to hide you" is the grammar
// breaking silently.

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

// ── The dot-scatter explainer ─────────────────────────────────────────────────────────────
//
// A scatter of dots with no legend is decoration wearing the costume of information. Two
// sentences because there are two facts: what every dot means, and which one is the reader's.

/** What every dot in the scatter is. */
export const FIELD_DOT_MEANING =
  'Each dot is one deposit that could be the source of this transaction.'

/** Which dot is theirs — and the honest answer is that nobody can tell, which IS the point. */
export const FIELD_DOT_YOURS =
  'Yours is one of them. Nothing on this page, and nothing on chain, says which.'
