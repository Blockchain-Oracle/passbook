//
// The proposal being written, and the rules for when it is finished.
//
// A proposal used to be one dialog of eight controls with a single blocker sentence standing in
// front of all of them, so "Ask the question" was the answer to a form you had already half filled
// in. Three steps, each with its own blocker, means the sentence always names something on screen.
//
// AND IT SURVIVES A RELOAD. Everything here is typed by a person — the question especially — and
// losing it to a refresh is the one failure this form can have that costs real work. Kept in
// SESSION storage, per House: it is a draft, not a possession, and it should not outlive the tab.
//
import { parseAmountInput } from '@strk20/protocol/amount'

export const WINDOWS = [
  { label: '1 day', seconds: 86_400 },
  { label: '3 days', seconds: 3 * 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '1 hour — demo', seconds: 3_600 },
] as const

export const MAX_QUESTION_CHARS = 400

export interface ProposeDraft {
  question: string
  /** An index into `WINDOWS`, so a stored draft cannot carry a deadline the UI cannot offer. */
  windowIdx: number
  permanent: boolean
  abstain: boolean
  spend: boolean
  amountRaw: string
  recipient: string
}

export const EMPTY_DRAFT: ProposeDraft = {
  question: '',
  windowIdx: 0,
  permanent: false,
  abstain: false,
  spend: false,
  amountRaw: '',
  recipient: '',
}

export const PROPOSE_STEPS = ['ask', 'rules', 'review'] as const
export type ProposeStep = (typeof PROPOSE_STEPS)[number]

export const STEP_TITLE: Record<ProposeStep, string> = {
  ask: 'The question',
  rules: 'How it is counted',
  review: 'Review',
}

/** A felt address, and not the zero one. The treasury paying `0x0` is a burn nobody meant. */
export function isRecipient(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  try {
    return BigInt(trimmed) > 0n
  } catch {
    return false
  }
}

/**
 * What is still missing on THIS step, or `null`.
 *
 * Per step by design: a blocker naming a field two screens away is a blocker the reader cannot act
 * on, which is how a form starts feeling broken.
 */
export function stepBlocker(step: ProposeStep, draft: ProposeDraft, decimals: number | null): string | null {
  if (step === 'ask') {
    const question = draft.question.trim()
    if (question === '') return 'Ask the question'
    if (question.length > MAX_QUESTION_CHARS) return 'Four hundred characters at most'
    return null
  }
  if (step === 'rules' && draft.spend) {
    const amount = parseAmountInput(draft.amountRaw, decimals)
    if (amount.problem) return amount.problem
    if (amount.wei === null || amount.wei === 0n) return 'How much the treasury pays'
    if (!isRecipient(draft.recipient)) return 'Who the treasury pays — a real address'
  }
  return null
}

/** The first step still holding a blocker, so Review can send you back to the one that is wrong. */
export function firstIncompleteStep(draft: ProposeDraft, decimals: number | null): ProposeStep | null {
  return PROPOSE_STEPS.find((step) => stepBlocker(step, draft, decimals) !== null) ?? null
}

const KEY = (houseId: number) => `strk20:propose-draft:${houseId}`

/** Per House: two drafts in two Houses are two different proposals and must not overwrite each other. */
export function loadDraft(houseId: number): { draft: ProposeDraft; restored: boolean } {
  try {
    const raw = sessionStorage.getItem(KEY(houseId))
    if (!raw) return { draft: EMPTY_DRAFT, restored: false }
    const parsed = JSON.parse(raw) as Partial<ProposeDraft>
    const draft: ProposeDraft = { ...EMPTY_DRAFT, ...parsed }
    // A window index from an older build could point past the list; fall back rather than throw.
    if (!WINDOWS[draft.windowIdx]) draft.windowIdx = 0
    return { draft, restored: JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT) }
  } catch {
    // Storage unavailable or corrupt. The form still works; it just does not remember.
    return { draft: EMPTY_DRAFT, restored: false }
  }
}

export function saveDraft(houseId: number, draft: ProposeDraft): void {
  try {
    sessionStorage.setItem(KEY(houseId), JSON.stringify(draft))
  } catch {
    /* storage unavailable — the flow still works, just without persistence */
  }
}

export function clearDraft(houseId: number): void {
  try {
    sessionStorage.removeItem(KEY(houseId))
  } catch {
    /* ignore */
  }
}
