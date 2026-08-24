//
// The durable invite-intent store (story 1.14) — the client-held money intent, and the fourth
// value this app persists.
//
// WHAT AN INTENT IS, AND WHY IT IS THE ONLY ARTEFACT. When a sender attaches money to an invite,
// nothing moves. There is no escrow and no relayer-held balance, because `open_channel` asserts
// strictly sequential channel indices (`INDEX_NOT_SEQUENTIAL`, FR-060): a relayer opening
// channels for users would be a global serialization point where one stuck release blocks
// everyone, and the address on chain would be the relayer's rather than the sender's — a
// provenance lie in the one record that is public. So the sender's app remembers what the sender
// meant, and when the invitee registers the sender settles it with an ordinary `sendShielded`.
// Take-back is free in the strongest sense: `revokeInviteIntent` touches no network at all,
// because there is nothing to undo.
//
// WHY THIS PASSES THE MUST-NEVER LIST IN `session.ts`, argued here because `amount` looks at a
// glance like something on it. The forbidden class is what the app LEARNED about a user's money:
// note plaintext, decrypted amounts, discovery results, indexer responses, channel contents — a
// cache of a balance sitting in localStorage. This record is the opposite: it is what the sender
// TYPED. A recipient they chose, a token they picked, an amount they entered, a code the relayer
// gave them, and a state this app set. Nothing here is decrypted, discovered, or derivable into
// a balance, and losing it reveals nothing about the pool. It is a note-to-self about money that
// has not moved.
//
// THE CORRUPT-VALUE POLICY IS THE CADENCE STORE'S, NOT THE RELAYER'S. An unreadable intent list
// must never stop a user from using their account and must never silently reset them to a clean
// slate — it reports `unreadable` with the reason, and epic 6 can tell the sender their intents
// could not be read rather than pretending they never existed. A quietly emptied list is a
// take-back nobody chose.
//

import type { InviteIntentState } from './invite.js'
import { SESSION_KEYS, type SessionStore } from './session-store.js'

/**
 * One invite intent. Sender-chosen metadata and nothing else.
 *
 * `amountWei` IS A DECIMAL STRING, not a bigint. `JSON.stringify` throws on a bigint outright,
 * so a bigint here would turn every save into a runtime error — and the obvious fix, a `Number`,
 * silently loses precision above 2^53 on a value denominated in wei. The string is exact and
 * survives the round trip.
 *
 * `recipient` is nullable because Door B has no address to record. Door A starts from a pasted
 * address, so the sender knows exactly who they invited; a Door B link goes to a stranger whose
 * account does not exist yet, and inventing a placeholder would make the watcher check the chain
 * for an address nobody has.
 */
export interface InviteIntent {
  code: string
  state: InviteIntentState
  createdAt: number
  updatedAt: number
  /** When the code stops being claimable, as the relayer reported it. `null` when unknown. */
  expiresAt: number | null
  recipient: string | null
  /** The token the sender chose to attach, or `null` when the invite carries no money. */
  token: string | null
  /** Wei, as an exact decimal string. `null` when the invite carries no money. */
  amountWei: string | null
}

/**
 * The record version this build writes.
 *
 * Present from the first release rather than added later, for the reason `CADENCE_RECORD_VERSION`
 * gives: without one, the first format change has to guess whether an unversioned record is old
 * or corrupt. An unknown version reads as `unreadable`, which is the conservative answer.
 */
export const INVITE_INTENTS_RECORD_VERSION = 1

interface StoredInviteIntentsRecord {
  v: number
  intents: InviteIntent[]
}

const STATES: readonly InviteIntentState[] = [
  'not-opened',
  'opened-not-registered',
  'ready-to-settle',
  'settled',
  'expired',
  'revoked',
]

/** The three-case answer a load gives. Never a throw, never a silent empty list. */
export type StoredInviteIntents =
  | { kind: 'absent' }
  | { kind: 'present'; intents: InviteIntent[] }
  | { kind: 'unreadable'; reason: string }

/** An exact non-negative wei amount, as written. Rejects `1e3`, `0x10`, `' 5 '` and `1.5`. */
const WEI_SHAPE = /^\d+$/

function readIntent(value: unknown, index: number): InviteIntent | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `intent ${index} is ${value === null ? 'null' : typeof value}`
  }
  const r = value as Partial<InviteIntent>
  if (typeof r.code !== 'string' || r.code === '') return `intent ${index} has no code`
  if (typeof r.state !== 'string' || !STATES.includes(r.state)) {
    return `intent ${index} has a state of ${String(r.state)}`
  }
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (typeof r[field] !== 'number' || !Number.isFinite(r[field])) {
      return `intent ${index} has a ${field} of ${String(r[field])}`
    }
  }
  if (r.expiresAt !== null && (typeof r.expiresAt !== 'number' || !Number.isFinite(r.expiresAt))) {
    return `intent ${index} has an expiresAt of ${String(r.expiresAt)}`
  }
  for (const field of ['recipient', 'token'] as const) {
    if (r[field] !== null && typeof r[field] !== 'string') {
      return `intent ${index} has a ${field} of ${String(r[field])}`
    }
  }
  // CHECKED FOR SHAPE, not merely for type. An `amountWei` of `"lots"` would survive a typeof
  // check and reach whatever builds the settlement send as a `BigInt()` that throws — at the
  // moment the sender presses the button, which is the worst place to discover it.
  if (r.amountWei !== null && (typeof r.amountWei !== 'string' || !WEI_SHAPE.test(r.amountWei))) {
    return `intent ${index} has an amountWei of ${String(r.amountWei)}`
  }
  // An amount without a token is not a sendable intent: there is nothing to send. Caught on the
  // way in rather than at settlement time.
  if ((r.amountWei === null) !== (r.token === null)) {
    return `intent ${index} has ${r.amountWei === null ? 'a token with no amount' : 'an amount with no token'}`
  }
  return {
    code: r.code,
    state: r.state,
    createdAt: r.createdAt as number,
    updatedAt: r.updatedAt as number,
    expiresAt: r.expiresAt as number | null,
    recipient: (r.recipient ?? null) as string | null,
    token: (r.token ?? null) as string | null,
    amountWei: (r.amountWei ?? null) as string | null,
  }
}

/**
 * Turns stored text into a `StoredInviteIntents`. Exported so the mapping can be tested against
 * hand-written strings without a store in the way.
 *
 * NEVER THROWS and never guesses. Missing is `absent`; anything present that does not read back
 * as a complete record is `unreadable` WITH THE REASON — not silently repaired into an empty
 * list. The repair would look exactly like a sender who never made an invite, so somebody whose
 * stored intents got mangled would be told nothing while their attached money quietly stopped
 * being owed.
 */
export function parseStoredInviteIntents(raw: string | null): StoredInviteIntents {
  if (raw === null || raw === '') return { kind: 'absent' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { kind: 'unreadable', reason: `the stored invite intents are not JSON: ${String(e)}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      kind: 'unreadable',
      reason: `the stored invite intents are ${parsed === null ? 'null' : typeof parsed}`,
    }
  }
  const record = parsed as Partial<StoredInviteIntentsRecord>
  if (record.v !== INVITE_INTENTS_RECORD_VERSION) {
    return {
      kind: 'unreadable',
      reason: `the stored invite intents are version ${String(record.v)}, and this build writes ${INVITE_INTENTS_RECORD_VERSION}`,
    }
  }
  if (!Array.isArray(record.intents)) {
    return { kind: 'unreadable', reason: `the stored intents list is ${String(record.intents)}` }
  }
  const intents: InviteIntent[] = []
  for (const [i, value] of record.intents.entries()) {
    const read = readIntent(value, i)
    // ONE BAD ENTRY FAILS THE WHOLE LIST rather than being skipped. Dropping it would be a
    // silent take-back of exactly the intent whose record went wrong, and the sender would have
    // no way to know which one vanished.
    if (typeof read === 'string') return { kind: 'unreadable', reason: read }
    intents.push(read)
  }
  return { kind: 'present', intents }
}

/**
 * The bytes written for an intents list. One function, so the reader and the writer cannot drift.
 *
 * VALIDATES ON THE WAY OUT, mirroring the parse on the way in, and the asymmetry it fixes is the
 * laundering one `serializeCadence` documents: `JSON.stringify` turns `NaN` and `Infinity` into
 * `null` without complaint, so a timestamp that went wrong in memory is written as a perfectly
 * valid record. The read side cannot catch it, because by then there is nothing wrong to catch.
 *
 * Throwing rather than repairing, because a failed save is already something a caller can report
 * and act on, whereas a quietly repaired one is a wrong record nobody will question.
 */
export function serializeInviteIntents(intents: readonly InviteIntent[]): string {
  if (!Array.isArray(intents)) {
    throw new Error(`refusing to write invite intents that are not a list: ${String(intents)}`)
  }
  intents.forEach((intent, i) => {
    const read = readIntent(intent, i)
    if (typeof read === 'string') throw new Error(`refusing to write invite intents: ${read}`)
  })
  // Duplicate codes would make "the first match wins" decide which intent a settlement belongs
  // to, and which is first is an artefact of insertion order.
  const seen = new Set<string>()
  for (const intent of intents) {
    if (seen.has(intent.code)) {
      throw new Error(`refusing to write two invite intents for code ${JSON.stringify(intent.code)}`)
    }
    seen.add(intent.code)
  }
  const record: StoredInviteIntentsRecord = {
    v: INVITE_INTENTS_RECORD_VERSION,
    intents: [...intents],
  }
  return JSON.stringify(record)
}

/** The seam epic 6 wires. Synchronous, like everything else over a `SessionStore`. */
export interface InviteIntentStore {
  load(): StoredInviteIntents
  save(intents: readonly InviteIntent[]): void
}

/**
 * The real store, over a `SessionStore`.
 *
 * `load` NEVER THROWS — a store that refuses, a browser that blocked storage, or a value edited
 * by hand all come back as `unreadable` with the reason attached. `save` DOES throw when the
 * write fails, and the asymmetry is the cadence store's and deliberate: a caller that believed a
 * save happened when it did not is a sender who thinks their invite is recorded.
 */
export function sessionInviteIntentStore(store: SessionStore): InviteIntentStore {
  return {
    load: () => {
      let raw: string | null
      try {
        raw = store.read(SESSION_KEYS.inviteIntents)
      } catch (e) {
        return { kind: 'unreadable', reason: `could not read the stored invite intents: ${String(e)}` }
      }
      return parseStoredInviteIntents(raw)
    },
    save: (intents) => {
      store.write(SESSION_KEYS.inviteIntents, serializeInviteIntents(intents))
    },
  }
}

// ── Mutations. All pure over a list; the store persists the result. ────────────────────────

/** Adds an intent, or replaces the one already recorded under the same code. Pure. */
export function withInviteIntent(
  intents: readonly InviteIntent[],
  intent: InviteIntent,
): InviteIntent[] {
  const without = intents.filter((i) => i.code !== intent.code)
  return [...without, intent]
}

/** Moves one intent to `state`, stamping `updatedAt`. Pure; unknown codes are left alone. */
export function withInviteIntentState(
  intents: readonly InviteIntent[],
  code: string,
  state: InviteIntentState,
  now: number,
): InviteIntent[] {
  return intents.map((i) => (i.code === code ? { ...i, state, updatedAt: now } : i))
}

/**
 * The states a take-back may be applied from.
 *
 * `settled` IS NOT ON THIS LIST, and that exclusion is the point. Once the sender's own
 * `sendShielded` has landed, the money HAS moved — revoking then would render `taken back.
 * Nothing had moved.` over a real on-chain transfer, which is the one sentence in this flow that
 * would be a lie about somebody's money. `expired` and `revoked` are excluded too: there is
 * nothing left to take back, and re-stamping either would move a timestamp for no reason.
 */
const REVOCABLE: readonly InviteIntentState[] = [
  'not-opened',
  'opened-not-registered',
  'ready-to-settle',
]

/**
 * What a take-back attempt did. Four answers, because they need four different sentences.
 *
 * `unreadable` exists so "we could not read your intents" cannot be mistaken for "you had
 * nothing to take back". Collapsing them would tell a sender whose storage went wrong that their
 * attached money was never recorded — and they would stop expecting to owe it.
 *
 * `no-such-intent` and `not-revocable` are split for the same reason one rung down: "there is no
 * such invite" is a dead end, while "this one has already settled" is a fact about money that HAS
 * moved and is the one case where a take-back must be refused rather than merely declined.
 */
export type RevokeResult =
  | { kind: 'revoked'; intents: InviteIntent[] }
  /** There is no intent under that code — nothing was ever recorded, or it was pruned. */
  | { kind: 'no-such-intent'; reason: string }
  /** The intent exists and its state forbids a take-back. `state` is why, for the copy. */
  | { kind: 'not-revocable'; state: InviteIntentState; reason: string }
  | { kind: 'unreadable'; reason: string }

/**
 * Take-back: marks the sender's intent revoked, locally, and persists it.
 *
 * ZERO NETWORK CALLS, AND THAT IS A PROPERTY OF THE DESIGN RATHER THAN OF THIS FUNCTION'S
 * RESTRAINT. There is no escrow to release, no channel to close and no transaction to cancel,
 * because attaching money to an invite never moved any — so there is literally nothing to tell
 * anyone. The function takes a store and nothing else; it has no seam through which a request
 * could be made, which is what makes `taking it back is free` a claim the code can back.
 *
 * WHAT IT TAKES BACK IS THE MONEY, NOT THE INVITE. The code is not revoked, cannot be revoked
 * from here, and is not meant to be: it lives in the relayer's ledger, it may already be burned,
 * and the registration it pays for is a gift that stands. An invitee who claimed a revoked
 * intent's code still gets their sponsored account — they simply do not get the amount the
 * sender had attached. That asymmetry is deliberate. Clawing back a stranger's paid-for account
 * because the sender changed their mind about a transfer would be a far worse promise to break
 * than the one this function keeps, and the sponsorship was never the sender's money anyway.
 *
 * MARKED, NOT DELETED. The row becomes `taken back. Nothing had moved.` rather than vanishing:
 * a sender who revokes an invite should see that they did, and a disappearing row is
 * indistinguishable from a bug that ate it.
 */
export function revokeInviteIntent(
  store: InviteIntentStore,
  code: string,
  now: number = Date.now(),
): RevokeResult {
  const loaded = store.load()
  // An unreadable list is NOT overwritten with a fresh one holding a single revoked intent.
  // That would be a repair that destroys exactly what could not be read.
  if (loaded.kind === 'unreadable') return { kind: 'unreadable', reason: loaded.reason }
  if (loaded.kind === 'absent') {
    return { kind: 'no-such-intent', reason: 'there are no invite intents stored on this device' }
  }
  const intent = loaded.intents.find((i) => i.code === code)
  if (!intent) {
    return { kind: 'no-such-intent', reason: `no invite intent is stored for ${JSON.stringify(code)}` }
  }
  if (!REVOCABLE.includes(intent.state)) {
    return {
      kind: 'not-revocable',
      state: intent.state,
      reason:
        intent.state === 'settled'
          ? `the invite ${code} has already settled: that money has moved, so there is nothing to take back`
          : `the invite ${code} is ${intent.state}, so there is nothing to take back`,
    }
  }
  const intents = withInviteIntentState(loaded.intents, code, 'revoked', now)
  store.save(intents)
  return { kind: 'revoked', intents }
}
