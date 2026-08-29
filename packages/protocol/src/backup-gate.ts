//
// The backup ceremony as a state machine, and the predicate that gates registration on it.
//
// Backup gates ONLY registration: it is write-once and sponsored, so an account registered before
// its key is saved is unrecoverable the moment the tab closes. Browsing, receiving and reading are
// never blocked. Passkeys MAY WRAP the key, NEVER DERIVE it — this module ships no derive path.
// Headless: the app renders from `backup-copy.ts` and drives the transitions below.
//

import {
  initialCadence, onVerificationFailed, onVerificationPassed,
  type ShieldedBalancePresence, type VerificationOutcome,
} from './backup-cadence.js'
import { verifyBackupAgainstKey } from './backup-verify.js'
import {
  createBackup, normalizeRecoveryCode, RECOVERY_CODE_PATTERN, type BackupHeader, type CreatedBackup,
} from './backup.js'
import { isStarkPrivateKey } from './keys.js'
import { readAuditorKeyAtBlock } from './pool.js'

// ── Paste-to-confirm ──────────────────────────────────────────────────────────────────────

/**
 * Same code, ignoring case, whitespace and dashes. NEVER THROWS (runs on every keystroke). The
 * expected value must itself look like a code, so a corrupted ceremony cannot accept an empty paste.
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

// ── The header context, live-read ─────────────────────────────────────────────────────────

/** A live-read header context, or the reason there is not one. No file is written without it. */
export type BackupHeaderContext =
  | { ok: true; backupBlock: number; auditorKeyAtBackupBlock: string }
  | { ok: false; reason: string }

/** Generous: two chain reads on a slow connection. A pending promise is not a typed failure. */
export const HEADER_READ_TIMEOUT_MS = 20_000

// The timer is always cleared — an unfired one keeps Node alive for the whole window.
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new Error(`the chain did not answer within ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (handle !== undefined) clearTimeout(handle)
  }
}

/**
 * TYPED FAILURE, never a throw and never a default: an auditor key we could not read is not "the
 * usual one". Validated here, not only in the default reader — `read` is an injection point.
 */
export async function readBackupHeaderContext(
  read: () => Promise<{ blockNumber: number; auditorKey: bigint }> = readAuditorKeyAtBlock,
  timeoutMs: number = HEADER_READ_TIMEOUT_MS,
): Promise<BackupHeaderContext> {
  try {
    const { blockNumber, auditorKey } = await withTimeout(read(), timeoutMs)
    if (typeof auditorKey !== 'bigint' || auditorKey <= 0n) {
      return { ok: false, reason: `the auditor key read as ${String(auditorKey)}, which is not a key` }
    }
    if (!Number.isInteger(blockNumber) || blockNumber < 0) {
      return { ok: false, reason: `the block number read as ${String(blockNumber)}` }
    }
    return { ok: true, backupBlock: blockNumber, auditorKeyAtBackupBlock: `0x${auditorKey.toString(16)}` }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
}

/** Real live values, and `registrationBlock` explicitly null — there is no registration yet. */
export function provisionalHeader(
  context: Extract<BackupHeaderContext, { ok: true }>,
  receiveAddress?: string,
): BackupHeader {
  return {
    ...(receiveAddress !== undefined ? { receiveAddress } : {}),
    backupBlock: context.backupBlock,
    auditorKeyAtBackupBlock: context.auditorKeyAtBackupBlock,
    registrationBlock: null,
  }
}

// ── The ceremony ──────────────────────────────────────────────────────────────────────────

/**
 * Issue the code → paste it back → save the file → the gate opens. `ready` is the only terminal
 * step and CARRIES NEITHER SECRET: it is the state that gets persisted.
 */
export type BackupCeremonyState =
  | { step: 'not-started' }
  | { step: 'code-issued'; backup: CreatedBackup; header: BackupHeader }
  | { step: 'code-confirmed'; backup: CreatedBackup; header: BackupHeader }
  | { step: 'ready'; filename: string; header: BackupHeader }

/** Wraps the key and issues the code. Takes an already-read context so a failed read never reaches here. */
export async function issueBackup(
  privateKey: string,
  context: Extract<BackupHeaderContext, { ok: true }>,
  receiveAddress?: string,
): Promise<Extract<BackupCeremonyState, { step: 'code-issued' }>> {
  // Runtime refusal too: the type is erased and the caller holds a value from an async read.
  if (!context || context.ok !== true) {
    throw new Error(
      'refusing to issue a backup from a failed header context: the chain read did not succeed, ' +
        'so there is no auditor key and no block to record',
    )
  }
  // Checked before a code is generated: a code for a file that will not be written opens nothing.
  if (!isStarkPrivateKey(privateKey)) {
    throw new Error('refusing to issue a backup for something that is not a Stark private key')
  }
  const header = provisionalHeader(context, receiveAddress)
  return { step: 'code-issued', backup: await createBackup(privateKey, header), header }
}

/** A mismatch returns the state UNCHANGED — the user tries again; nothing to reset. */
export function confirmPastedCode(state: BackupCeremonyState, pasted: string): BackupCeremonyState {
  if (state.step !== 'code-issued') return state
  if (!verifyPastedCode(pasted, state.backup.recoveryCode)) return state
  return { step: 'code-confirmed', backup: state.backup, header: state.header }
}

/** Only from `code-confirmed`; earlier is a no-op, not a shortcut. Scrubs both secrets. */
export function markFileSaved(state: BackupCeremonyState): BackupCeremonyState {
  if (state.step !== 'code-confirmed') return state
  return { step: 'ready', filename: state.backup.filename, header: state.header }
}

/** The one place that decides which steps are terminal. */
export function ceremonyIsComplete(state: BackupCeremonyState): boolean {
  return state.step === 'ready'
}

// ── What may be persisted ─────────────────────────────────────────────────────────────────

export type PersistableCeremonyState = Extract<BackupCeremonyState, { step: 'ready' }> | null

/**
 * THE ONLY THING THE SESSION STORE MAY WRITE. Mid-ceremony states hold both halves of the
 * two-secret split; they return `null`, not a husk — after a reload the honest move is to start over.
 */
export function persistableCeremonyState(state: BackupCeremonyState): PersistableCeremonyState {
  return state?.step === 'ready' ? state : null
}

// ── Completing the ceremony ───────────────────────────────────────────────────────────────

export interface CeremonyCompletion {
  state: BackupCeremonyState
  /** The first verification's outcome, or `null` if the ceremony was not at `code-confirmed`. */
  outcome: VerificationOutcome | null
}

/**
 * Saves the file and runs the FIRST verification in the same step — `code-confirmed` is the last
 * moment both secrets are in hand, and `backed-up` is only ever produced by a real decrypt-and-
 * compare. A FAILED CHECK DOES NOT OPEN THE GATE.
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
    ok = false // the verifier is injectable; a check that could not run did not pass
  }
  return ok
    ? { state: markFileSaved(state), outcome: onVerificationPassed(initialCadence(), now, balance) }
    : { state, outcome: onVerificationFailed(initialCadence()) }
}
