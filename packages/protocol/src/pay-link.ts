//
// Payment-request links, as data rather than route folklore.
//
// A request is deliberately small: who, which of the two product assets, an optional exact
// decimal, and an optional human note. It is not a transaction and the note is not written on
// chain. Keeping the parser here means Receive, the branded pay page and Send all accept and
// refuse the same bytes instead of each maintaining a slightly different query-string policy.
//
import { maybeAddress, toFeltHex } from './address.js'
import {
  DIRECTORY_NAME_PATTERN,
  normalizeDirectoryName,
  type DirectoryEntry,
} from './directory-name.js'

export const PAY_ASSETS = ['STRK', 'USDC'] as const
export type PayAsset = (typeof PAY_ASSETS)[number]

export const PAY_NOTE_MAX_CHARS = 280

export interface PayLinkSearch {
  readonly asset?: PayAsset
  /** Canonical unsigned decimal text. Token decimals are enforced by the Send amount parser. */
  readonly amount?: string
  /** Human context only. It is never treated as an on-chain memo. */
  readonly note?: string
}

export type PayLinkSearchResult =
  | { readonly ok: true; readonly value: PayLinkSearch }
  | { readonly ok: false; readonly because: string }

export type RecipientReference =
  | { readonly kind: 'address'; readonly address: string }
  | { readonly kind: 'name'; readonly name: string; readonly display: `@${string}` }

export type RecipientReferenceResult =
  | { readonly ok: true; readonly value: RecipientReference }
  | { readonly ok: false; readonly because: string }

export type ResolvedRecipient =
  | { readonly ok: true; readonly address: string; readonly name: string | null }
  | { readonly ok: false; readonly kind: 'invalid' | 'unresolved-name'; readonly because: string }

const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

/** Parse query values without silently dropping a request the sender intended. */
export function parsePayLinkSearch(search: Record<string, unknown>): PayLinkSearchResult {
  let asset: PayAsset | undefined
  if (search.asset !== undefined && search.asset !== '') {
    if (typeof search.asset !== 'string') {
      return { ok: false, because: 'This request names an invalid asset.' }
    }
    const candidate = search.asset.toUpperCase()
    if (candidate !== 'STRK' && candidate !== 'USDC') {
      return { ok: false, because: `Passbook payment links support STRK or USDC, not ${search.asset}.` }
    }
    asset = candidate
  }

  let amount: string | undefined
  if (search.amount !== undefined && search.amount !== '') {
    if (typeof search.amount !== 'string' || !DECIMAL.test(search.amount) || /^0(?:0|[0-9])/.test(search.amount)) {
      return { ok: false, because: 'The requested amount is not a valid positive decimal.' }
    }
    if (/^0(?:\.0+)?$/.test(search.amount)) {
      return { ok: false, because: 'A payment request amount must be greater than zero.' }
    }
    amount = search.amount
  }

  let note: string | undefined
  if (search.note !== undefined && search.note !== '') {
    if (typeof search.note !== 'string') {
      return { ok: false, because: 'The payment note is not text.' }
    }
    const candidate = search.note.trim()
    if (candidate.length > PAY_NOTE_MAX_CHARS) {
      return { ok: false, because: `A payment note can be at most ${PAY_NOTE_MAX_CHARS} characters.` }
    }
    if (candidate !== '') note = candidate
  }

  return {
    ok: true,
    value: {
      ...(asset ? { asset } : {}),
      ...(amount ? { amount } : {}),
      ...(note ? { note } : {}),
    },
  }
}

/** An address or an explicit `@name`; bare names are refused so an address typo cannot become one. */
export function parseRecipientReference(raw: string): RecipientReferenceResult {
  const candidate = raw.trim()
  const address = maybeAddress(candidate)
  if (candidate !== '' && address !== null) {
    return { ok: true, value: { kind: 'address', address: toFeltHex(address) } }
  }
  if (!candidate.startsWith('@')) {
    return { ok: false, because: 'Use a Starknet address or a name beginning with @.' }
  }
  const name = normalizeDirectoryName(candidate.slice(1))
  if (!DIRECTORY_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      because: 'That name must be 3 to 20 lower-case letters, numbers, underscores or hyphens.',
    }
  }
  return { ok: true, value: { kind: 'name', name, display: `@${name}` } }
}

/** Resolve locally against the public directory list. No search query leaves the browser. */
export function resolveRecipientReference(
  raw: string,
  entries: readonly DirectoryEntry[],
): ResolvedRecipient {
  const parsed = parseRecipientReference(raw)
  if (!parsed.ok) return { ok: false, kind: 'invalid', because: parsed.because }
  if (parsed.value.kind === 'address') {
    return { ok: true, address: parsed.value.address, name: null }
  }
  const name = parsed.value.name
  const entry = entries.find((candidate) => candidate.name === name)
  if (!entry) {
    return {
      ok: false,
      kind: 'unresolved-name',
      because: `Nobody in the directory has claimed @${name}.`,
    }
  }
  const address = maybeAddress(entry.address)
  if (address === null) {
    return { ok: false, kind: 'invalid', because: `@${entry.name} points to an invalid address.` }
  }
  return { ok: true, address: toFeltHex(address), name: entry.name }
}

/** A route-relative link, safe to prefix with the current origin for copying or a QR code. */
export function buildPayLink(recipient: string, search: PayLinkSearch = {}): string {
  const parsedRecipient = parseRecipientReference(recipient)
  if (!parsedRecipient.ok) throw new Error(parsedRecipient.because)
  const display =
    parsedRecipient.value.kind === 'address'
      ? parsedRecipient.value.address
      : parsedRecipient.value.display
  const query = new URLSearchParams()
  if (search.asset) query.set('asset', search.asset)
  if (search.amount) query.set('amount', search.amount)
  if (search.note) query.set('note', search.note)
  const suffix = query.toString()
  return `/pay/${encodeURIComponent(display)}${suffix === '' ? '' : `?${suffix}`}`
}
