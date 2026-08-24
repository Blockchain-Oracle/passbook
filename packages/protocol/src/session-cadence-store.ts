//
// The durable backup-cadence store (story 1.11) — the third of the three seams this story
// fills from outside without touching the file that declares it.
//
// `backup-cadence.ts` declares `BackupCadenceStore` and ships `REFUSING_CADENCE_STORE` in its
// place, with a note saying story 1.11 owns the durable implementation. This is it. That file
// is not edited: the interface it declared is implemented here, over a `SessionStore`, and the
// call sites pass this instead of the refusal.
//
// THE CORRUPT-VALUE POLICY IS THE OPPOSITE OF THE RELAYER'S, on purpose, and
// `backup-cadence.ts:244-250` is where the reasoning lives. `relayer/src/sponsorship-store.ts`
// treats an unreadable ledger as a hard startup failure, because a ledger read as empty hands
// out the whole daily budget twice. Here an unreadable cadence file must NEVER stop a user
// from using their account and must never quietly reset them to a clean slate either — it
// reports `unreadable` with a reason, the status collapses to not-backed-up, the nag appears,
// and the user is asked to verify. Same principle, opposite landing: fail toward the cheaper
// mistake.
//

import type { BackupCadenceStore, BackupStatus, CadenceState, StoredCadence } from './backup-cadence.js'
import { SESSION_KEYS, type SessionStore } from './session-store.js'

/** What actually goes in the store. Flat, versioned, and nothing else. */
interface StoredCadenceRecord {
  v: number
  intervalIndex: number
  lastVerifiedAt: number | null
  status: BackupStatus
}

/**
 * The record version this build writes.
 *
 * Present from the first release rather than added later, because the alternative is a stored
 * value with no version at all — and then the first format change has to guess whether an
 * unversioned record is old or corrupt. A record at an unknown version reads as `unreadable`,
 * which is the conservative answer: the user is asked to verify their backup again.
 */
export const CADENCE_RECORD_VERSION = 1

const STATUSES: readonly BackupStatus[] = ['backed-up', 'not-backed-up', 'unknown']

/**
 * Turns stored text into a `StoredCadence`. Exported so the three-case mapping can be tested
 * against hand-written strings without a store in the way.
 *
 * NEVER THROWS and never guesses. Missing is `absent`; anything present that does not read
 * back as a complete record is `unreadable` WITH THE REASON — not silently repaired into a
 * fresh ladder. The repair would look identical to a genuine first run, so a user whose stored
 * cadence got mangled would be told nothing and would silently restart at the shortest
 * interval while their status quietly read as fine.
 */
export function parseStoredCadence(raw: string | null): StoredCadence {
  if (raw === null || raw === '') return { kind: 'absent' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { kind: 'unreadable', reason: `the stored cadence is not JSON: ${String(e)}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'unreadable', reason: `the stored cadence is ${parsed === null ? 'null' : typeof parsed}` }
  }

  const record = parsed as Partial<StoredCadenceRecord>
  if (record.v !== CADENCE_RECORD_VERSION) {
    return {
      kind: 'unreadable',
      reason: `the stored cadence is version ${String(record.v)}, and this build writes ${CADENCE_RECORD_VERSION}`,
    }
  }
  if (typeof record.intervalIndex !== 'number' || !Number.isInteger(record.intervalIndex)) {
    return { kind: 'unreadable', reason: `the stored interval index is ${String(record.intervalIndex)}` }
  }
  const last = record.lastVerifiedAt
  if (last !== null && (typeof last !== 'number' || !Number.isFinite(last))) {
    return { kind: 'unreadable', reason: `the stored last-verified timestamp is ${String(last)}` }
  }
  if (typeof record.status !== 'string' || !STATUSES.includes(record.status)) {
    return { kind: 'unreadable', reason: `the stored backup status is ${String(record.status)}` }
  }

  // The ladder index is NOT clamped here. `intervalDays`, `advanceOnVerified` and
  // `stepBackOnFailure` all clamp at the point of use, and that is where the rule belongs —
  // clamping on the way out of the store as well would mean two places decide what a legal
  // rung is, and they would eventually disagree.
  return {
    kind: 'present',
    state: { intervalIndex: record.intervalIndex, lastVerifiedAt: last ?? null },
    status: record.status,
  }
}

/**
 * The bytes written for a cadence. One function, so the reader and the writer cannot drift.
 *
 * VALIDATES ON THE WAY OUT, mirroring `parseStoredCadence` on the way in, and the asymmetry it
 * fixes is a laundering one. `JSON.stringify` turns `NaN` and `Infinity` into `null` without
 * complaint — so a `lastVerifiedAt` that went wrong in memory (a bad clock read, arithmetic on
 * an undefined, a caller passing through a parsed string) is written as a PERFECTLY VALID
 * record meaning "never verified". The read side cannot catch it, because by then there is
 * nothing wrong to catch: the corruption became a legitimate value at the moment it was
 * serialized, and the account silently restarts its ladder.
 *
 * Throwing rather than repairing, for the reason the module header gives: a failed save is
 * already handled by every caller (`runPeriodicVerification` reports `persisted: false` and
 * keeps the outcome), whereas a quietly repaired one is a wrong record nobody will question.
 */
export function serializeCadence(next: { state: CadenceState; status: BackupStatus }): string {
  const state = next?.state
  if (!state || typeof state !== 'object') {
    throw new Error(`refusing to write a cadence with no ladder: ${String(state)}`)
  }
  if (!Number.isInteger(state.intervalIndex)) {
    throw new Error(`refusing to write a cadence whose interval index is ${String(state.intervalIndex)}`)
  }
  const last = state.lastVerifiedAt
  if (last !== null && (typeof last !== 'number' || !Number.isFinite(last))) {
    // The one that JSON would have laundered into `null`.
    throw new Error(`refusing to write a cadence whose last-verified timestamp is ${String(last)}`)
  }
  if (!STATUSES.includes(next.status)) {
    throw new Error(`refusing to write a cadence whose status is ${String(next.status)}`)
  }
  const record: StoredCadenceRecord = {
    v: CADENCE_RECORD_VERSION,
    intervalIndex: state.intervalIndex,
    lastVerifiedAt: last,
    status: next.status,
  }
  return JSON.stringify(record)
}

/**
 * The real `BackupCadenceStore`, over a `SessionStore`.
 *
 * `load` NEVER THROWS — a store that refuses, a browser that blocked storage, a value somebody
 * edited by hand all come back as `unreadable` with the reason attached. `readBackupCadence`
 * already catches a throwing store, so this is belt and braces; it is here anyway because the
 * three-case union is this interface's whole contract and a load that can throw makes callers
 * handle two error channels for one question.
 *
 * `save` DOES throw when the underlying write fails, and that asymmetry is deliberate. A failed
 * save is not a failed check: `runPeriodicVerification` catches it, keeps the in-memory outcome,
 * and reports `persisted: false` — so the verification the user just performed still counts and
 * the only cost is being asked again sooner. Swallowing the error here would take that reporting
 * away and leave the caller believing a write happened.
 */
export function sessionCadenceStore(store: SessionStore): BackupCadenceStore {
  return {
    load: () => {
      let raw: string | null
      try {
        raw = store.read(SESSION_KEYS.cadence)
      } catch (e) {
        return { kind: 'unreadable', reason: `could not read the stored cadence: ${String(e)}` }
      }
      return parseStoredCadence(raw)
    },
    save: (next) => {
      store.write(SESSION_KEYS.cadence, serializeCadence(next))
    },
  }
}
