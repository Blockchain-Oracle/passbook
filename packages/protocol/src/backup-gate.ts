//
// The backup ceremony, as a state machine, and the predicate that gates registration on it
// (FR-013, story 1.8, AC1/AC3).
//
// WHY A GATE EXISTS HERE AND NOWHERE ELSE. Registration is write-once and sponsored: the
// pool records a viewing key and `WriteOnce` enforcement reverts every attempt to change it,
// and somebody else paid for the transaction that did it. A user who registers before their
// key is saved has an account that becomes unrecoverable the moment they close the tab, and
// no amount of support can undo it. So the ceremony must finish first. That is the ONLY
// thing backup gates — browsing, receiving and reading are never blocked by backup state,
// and `test/backup-gates-registration-only.test.ts` asserts it as a dependency fact rather
// than as a promise in a comment.
//
// PASSKEYS MAY WRAP, NEVER DERIVE. A passkey (or any other device-lock secret) may be used
// to encrypt the account key for storage. It must never be used to DERIVE it. It is the same
// orphaning trap as deriving from a wallet signature: WebAuthn assertions are not
// deterministic, a re-registered authenticator produces different material, and the pool
// will not let the resulting key be replaced. This module ships no derive path, and that
// absence is the enforcement — there is no option to set wrongly.
//
// Headless. No paste field, no download anchor, no done screen, no nag placement — epic 6
// renders all of those from `backup-copy.ts` and drives the transitions below.
//

import {
  createBackup, isStarkPrivateKey, normalizeRecoveryCode, RECOVERY_CODE_PATTERN,
  verifyBackupAgainstKey, type BackupHeader, type CreatedBackup,
} from './identity.js'
import {
  initialCadence, onVerificationFailed, onVerificationPassed,
  type ShieldedBalancePresence, type VerificationOutcome,
} from './backup-cadence.js'
import { readAuditorKeyAtBlock } from './pool.js'

// ── Paste-to-confirm (AC3) ────────────────────────────────────────────────────────────────

// ONE canonicalization, shared with the crypto. `normalizeRecoveryCode` and
// `canonicalizeRecoveryCode` live in `identity.ts`, beside `generateRecoveryCode` and
// `RECOVERY_CODE_PATTERN`, and `restoreBackup` feeds the canonical form to PBKDF2. A second
// copy here is exactly how the paste field and the restore screen came to disagree about
// whether an em-dash paste is the same code: the field said yes, and the derivation said no.
export { normalizeRecoveryCode, canonicalizeRecoveryCode } from './identity.js'

/**
 * True when `pasted` is the same code as `expected`, ignoring case, whitespace and dashes.
 *
 * NEVER THROWS — the same contract as `verifyClaimedKey` in `registration.ts`, and for the
 * same reason: this runs on every keystroke of a field a user is typing into, and an
 * exception escaping into that render is a broken screen at the exact moment the product is
 * asking someone to trust it with the only copy of their key. Anything unusable is `false`.
 *
 * The expected code must still look like a Recovery Code. Without that check, a ceremony
 * holding an empty or corrupted expected value would accept an empty paste and open the
 * gate — a mismatch failing closed is the whole point of this function existing.
 */
export function verifyPastedCode(pasted: unknown, expected: unknown): boolean {
  try {
    if (typeof pasted !== 'string' || typeof expected !== 'string') return false
    if (!RECOVERY_CODE_PATTERN.test(expected)) return false
    const a = normalizeRecoveryCode(pasted)
    const b = normalizeRecoveryCode(expected)
    return a.length > 0 && a === b
  } catch {
    return false
  }
}

// ── The header context, live-read (AC4) ───────────────────────────────────────────────────

/** A live-read header context, or the reason there is not one. No file is written without it. */
export type BackupHeaderContext =
  | { ok: true; backupBlock: number; auditorKeyAtBackupBlock: string }
  | { ok: false; reason: string }

/**
 * How long to wait for the chain before the ceremony gives up on the header.
 *
 * A typed failure that never arrives is not a typed failure. An RPC that accepts a connection
 * and then never answers leaves the promise pending forever, and the ceremony sits on a
 * spinner in front of a user who has not saved their key yet — worse than an error, because
 * an error has a retry button. Generous, because two chain reads on a slow connection are
 * genuinely not instant.
 */
export const HEADER_READ_TIMEOUT_MS = 20_000

/**
 * Rejects if `work` has not settled in time. The underlying read is NOT cancelled — nothing
 * here can cancel an in-flight request — so this means "we stopped waiting", and the caller
 * turns that into the same typed failure as any other unusable read.
 *
 * The timer is always cleared: an unfired one keeps the Node event loop alive for the full
 * window after a fast success, the same trap `register.ts`'s `withDeadline` documents.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        handle = setTimeout(
          () => reject(new Error(`the chain did not answer within ${ms}ms`)), ms,
        )
      }),
    ])
  } finally {
    if (handle !== undefined) clearTimeout(handle)
  }
}

/**
 * Reads what the plaintext header needs from the chain. TYPED FAILURE, never a throw and
 * never a default.
 *
 * There is no fallback value for either field. An auditor key we could not read is not "the
 * usual one" — pinning the key to the user's own block is the entire point of recording it,
 * and a header carrying a guess would be a false record of who can decrypt their key. So an
 * unreachable chain stops the ceremony with a reason, and nothing is written.
 */
export async function readBackupHeaderContext(
  read: () => Promise<{ blockNumber: number; auditorKey: bigint }> = readAuditorKeyAtBlock,
  timeoutMs: number = HEADER_READ_TIMEOUT_MS,
): Promise<BackupHeaderContext> {
  try {
    const { blockNumber, auditorKey } = await withTimeout(read(), timeoutMs)
    // Validated HERE, not only inside the default reader. `read` is an injection point, so the
    // guarantees cannot live in the implementation that happens to be the default — a caller
    // passing their own reader (a cache, a test double, a batched multicall) would otherwise
    // silently opt out of the zero-check, and a header claiming registrations escrow to
    // nobody would be written by the path that looked most legitimate.
    if (typeof auditorKey !== 'bigint' || auditorKey <= 0n) {
      return { ok: false, reason: `the auditor key read as ${String(auditorKey)}, which is not a key` }
    }
    if (!Number.isInteger(blockNumber) || blockNumber < 0) {
      return { ok: false, reason: `the block number read as ${String(blockNumber)}` }
    }
    return {
      ok: true,
      backupBlock: blockNumber,
      auditorKeyAtBackupBlock: `0x${auditorKey.toString(16)}`,
    }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
}

/** Builds the provisional header: real live values, and `registrationBlock` honestly null. */
export function provisionalHeader(
  context: Extract<BackupHeaderContext, { ok: true }>,
  receiveAddress?: string,
): BackupHeader {
  return {
    ...(receiveAddress !== undefined ? { receiveAddress } : {}),
    backupBlock: context.backupBlock,
    auditorKeyAtBackupBlock: context.auditorKeyAtBackupBlock,
    // Explicitly null, not omitted. Backup gates registration, so at this moment there is no
    // registration block; `reissueBackupHeader` writes the real one into a second file later.
    registrationBlock: null,
  }
}

// ── The ceremony (AC1/AC3) ────────────────────────────────────────────────────────────────

/**
 * Where the ceremony has got to. Exactly one terminal step, `ready`, and the ordering is the
 * brief's (UX spine W3): issue the code, have it pasted back, save the file, then the gate
 * opens. Saving the file is last because the file is the half that survives a closed tab —
 * a user who confirmed a code they never wrote down and never downloaded the file for has
 * completed nothing at all.
 *
 * Modelled as a discriminated union rather than a boolean pair so that "confirmed the code
 * but has no file" cannot be represented as anything other than what it is: not done.
 */
export type BackupCeremonyState =
  /** Nothing has happened. No key has been wrapped, no code exists. */
  | { step: 'not-started' }
  /** The code and file exist; the code has not been pasted back yet. */
  | { step: 'code-issued'; backup: CreatedBackup; header: BackupHeader }
  /** The code was pasted back and matched. The file has not been saved yet. */
  | { step: 'code-confirmed'; backup: CreatedBackup; header: BackupHeader }
  /**
   * TERMINAL. Code confirmed and file saved — the only state that opens the gate.
   *
   * CARRIES NEITHER SECRET. The Recovery Code and the wrapped file are dropped here, and this
   * is the state most likely to be persisted: it is the one that survives a reload, so story
   * 1.11's session store is going to write it somewhere. A `ready` that still held the code
   * would put the one secret we promised never to see into localStorage — and the file beside
   * it, which is the other half of the two-secret split, so the pair would sit together in a
   * place a script can read. What a surface actually needs afterwards is the filename it
   * saved under and the header it recorded; neither is a secret, and both are here.
   */
  | { step: 'ready'; filename: string; header: BackupHeader }

/** The starting state. A ceremony nobody has begun refuses registration, like every other. */
export function beginCeremony(): BackupCeremonyState {
  return { step: 'not-started' }
}

/**
 * Wraps the key and issues the code, moving to `code-issued`.
 *
 * Takes an already-read header context rather than reading one, so the failure to reach the
 * chain is handled by the caller before any key material is touched — see
 * `readBackupHeaderContext`.
 */
export async function issueBackup(
  privateKey: string,
  context: Extract<BackupHeaderContext, { ok: true }>,
  receiveAddress?: string,
): Promise<Extract<BackupCeremonyState, { step: 'code-issued' }>> {
  // A RUNTIME refusal, not only the parameter type. The type says a failed context cannot get
  // here; the type is erased at run time, and the caller is UI code holding a value that came
  // back from an async read — the single most likely place for an unchecked branch to be
  // passed along. Without this, a failed context reaches `provisionalHeader`, which reads
  // `undefined` for both live fields and writes a file whose header is a fabrication.
  if (!context || context.ok !== true) {
    throw new Error(
      'refusing to issue a backup from a failed header context: the chain read did not succeed, ' +
        'so there is no auditor key and no block to record',
    )
  }
  if (!isStarkPrivateKey(privateKey)) {
    // `createBackup` refuses this too, through the SAME predicate — the shape rule and the
    // `(0, ORDER)` range live once, in `identity.ts`. Checked here as well so the ceremony
    // fails before a Recovery Code is generated: issuing a code for a file that will not be
    // written is how a user ends up saving a code that opens nothing.
    throw new Error('refusing to issue a backup for something that is not a Stark private key')
  }
  const header = provisionalHeader(context, receiveAddress)
  return { step: 'code-issued', backup: await createBackup(privateKey, header), header }
}

/**
 * Records a paste-to-confirm attempt.
 *
 * Returns the state UNCHANGED on a mismatch rather than throwing or moving to an error step.
 * A wrong paste is not a failure of the ceremony, it is the ceremony working — the user tries
 * again, and there is nothing to reset. Every non-terminal state answers `canRegister` false,
 * so an unchanged state is already the safe outcome.
 */
export function confirmPastedCode(
  state: BackupCeremonyState,
  pasted: string,
): BackupCeremonyState {
  if (state.step !== 'code-issued') return state
  if (!verifyPastedCode(pasted, state.backup.recoveryCode)) return state
  return { step: 'code-confirmed', backup: state.backup, header: state.header }
}

/**
 * Records that the Recovery File has been saved, moving to `ready` — the gate opens here.
 *
 * Only reachable from `code-confirmed`. Calling it earlier is a no-op rather than a shortcut:
 * the ordering is a safety property, and a caller that downloads the file before the code is
 * confirmed must not be able to skip the confirmation by reporting the download.
 */
export function markFileSaved(state: BackupCeremonyState): BackupCeremonyState {
  if (state.step !== 'code-confirmed') return state
  // The scrub. `backup` — the Recovery Code and the wrapped file — is deliberately not
  // carried forward; see the `ready` variant's note for why this is the state that matters.
  return { step: 'ready', filename: state.backup.filename, header: state.header }
}

/** The one place that decides which steps are terminal. `ready` and nothing else. */
export function ceremonyIsComplete(state: BackupCeremonyState): boolean {
  return state.step === 'ready'
}

/**
 * Builds the zero-argument predicate story 1.12's `RegisterDeps.canRegister` seam expects.
 *
 * This is the whole integration. `register.ts` is not modified to know about backups — it
 * already declares the seam, already defaults it to refusal, and already turns a throwing
 * gate into a refusal rather than a rejected promise. So the ceremony plugs in from outside,
 * and the frozen contract stays frozen.
 *
 * A SNAPSHOT, deliberately. The predicate answers for the state it was built from, so the
 * caller builds it at submit time from the state it holds then. Closing over a mutable
 * reference instead would make "can this user register" depend on when the closure happened
 * to be read, which is not a question a gate should have two answers to.
 */
export function makeCanRegister(state: BackupCeremonyState): () => boolean {
  const complete = ceremonyIsComplete(state)
  return () => complete
}

// ── What story 1.11 is allowed to persist ─────────────────────────────────────────────────

/** The secret-free projection of a ceremony. `ready` keeps its facts; nothing else survives. */
export type PersistableCeremonyState = Extract<BackupCeremonyState, { step: 'ready' }> | null

/**
 * THE ONLY THING 1.11 MAY WRITE TO DISK. Everything else in a ceremony is a secret.
 *
 * `ready` was scrubbed at construction, so it is already safe. The problem this closes is the
 * other three: `code-issued` and `code-confirmed` hold BOTH halves of the two-secret split —
 * the Recovery Code we promised never to see, and the wrapped file it opens — and a session
 * store that persists "the current ceremony state" so a reload can resume would write the
 * pair into localStorage, where any script on the page can read them. That is not a backup
 * with a gate in front of it; it is the key, in the clear, in the browser.
 *
 * Mid-ceremony states return `null` rather than a stripped husk, because a stripped husk is
 * not resumable and pretending otherwise is the trap: without the code and the file there is
 * nothing to confirm and nothing to save, so a "resumed" `code-issued` would show a paste
 * field for a code that no longer exists. The honest behaviour after a reload mid-ceremony is
 * to start again — the account is not registered yet, so starting again costs nothing.
 */
export function persistableCeremonyState(state: BackupCeremonyState): PersistableCeremonyState {
  return state?.step === 'ready' ? state : null
}

// ── Completing the ceremony (AC5 bridge) ──────────────────────────────────────────────────

/** What completing the ceremony produced: the new state, and the cadence it started. */
export interface CeremonyCompletion {
  state: BackupCeremonyState
  /** The first verification's outcome, or `null` if the ceremony was not at `code-confirmed`. */
  outcome: VerificationOutcome | null
}

/**
 * Saves the file and, in the same step, performs the FIRST periodic verification.
 *
 * WHY THESE ARE ONE OPERATION. Completing the ceremony used to leave the backup status at
 * `unknown`, which collapses to not-backed-up — so a user who had just written down a code,
 * pasted it back and downloaded the file was immediately shown "This account has no backup.
 * Save it." That contradicts the nag's own contract ("gone forever once a backup exists") and
 * it teaches people to ignore the one warning that matters.
 *
 * Nothing else could have fixed it honestly. `backed-up` is only ever produced by a real
 * decrypt-and-compare — a file having been written is not evidence it can be opened — and
 * `code-confirmed` is the last moment both secrets are in hand, because `ready` scrubs them.
 * So the check happens HERE, against the real file and the real code, and the ceremony's
 * completion is a genuine verification rather than an assumption. The ladder starts at 3 days.
 *
 * A FAILED CHECK DOES NOT OPEN THE GATE. If the file we just wrote does not open with the code
 * we just issued, something is badly wrong, and the correct response is to leave the ceremony
 * where it is — registration stays refused — and report a failed outcome.
 */
export async function completeCeremony(
  state: BackupCeremonyState,
  accountKey: string,
  now: number,
  balance: ShieldedBalancePresence = 'unknown',
  verify: typeof verifyBackupAgainstKey = verifyBackupAgainstKey,
): Promise<CeremonyCompletion> {
  if (state?.step !== 'code-confirmed') return { state, outcome: null }

  let ok: boolean
  try {
    ok = (await verify(state.backup.file, state.backup.recoveryCode, accountKey)).ok
  } catch {
    // The verifier promises never to throw, but it is injectable. A check that could not run
    // is a check that did not pass, and the gate stays shut.
    ok = false
  }

  return ok
    ? { state: markFileSaved(state), outcome: onVerificationPassed(initialCadence(), now, balance) }
    : { state, outcome: onVerificationFailed(initialCadence()) }
}
