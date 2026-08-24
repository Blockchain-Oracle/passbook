import { describe, it, expect } from 'vitest'
import {
  beginCeremony, issueBackup, confirmPastedCode, markFileSaved, ceremonyIsComplete,
  makeCanRegister, verifyPastedCode, normalizeRecoveryCode, readBackupHeaderContext,
  provisionalHeader, persistableCeremonyState, completeCeremony, type BackupCeremonyState,
} from '../src/backup-gate.js'
import {
  intervalDays, isCheckDue, readsAsBackedUp, shouldNagForBackup, backupNagCopy,
} from '../src/backup-cadence.js'
import { generateIdentity, restoreBackup, RECOVERY_CODE_PATTERN } from '../src/identity.js'
import { registerSponsored } from '../src/register.js'

const CONTEXT = { ok: true as const, backupBlock: 13_779_000, auditorKeyAtBackupBlock: '0xa0d17012' }
const VALID_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const T0 = Date.UTC(2026, 7, 24, 12, 0, 0)

/** Runs the ceremony to whichever step is asked for. */
async function ceremonyAt(
  step: BackupCeremonyState['step'],
  privateKey = generateIdentity().privateKey,
): Promise<BackupCeremonyState> {
  if (step === 'not-started') return beginCeremony()
  const issued = await issueBackup(privateKey, CONTEXT)
  if (step === 'code-issued') return issued
  const confirmed = confirmPastedCode(issued, issued.backup.recoveryCode)
  if (step === 'code-confirmed') return confirmed
  return markFileSaved(confirmed)
}

describe('paste-to-confirm (AC3)', () => {
  it('accepts the code back in whatever shape a password manager hands it over', async () => {
    const issued = await ceremonyAt('code-issued')
    const code = (issued as Extract<BackupCeremonyState, { step: 'code-issued' }>).backup.recoveryCode
    const variants = [
      code,
      code.toLowerCase(),
      `  ${code}  `,
      code.replace(/-/g, ''),
      code.replace(/-/g, ' '),
      code.replace(/-/g, '\n'),
      `${code.slice(0, 10)}\t${code.slice(10)}`,
    ]
    for (const v of variants) expect(verifyPastedCode(v, code), v).toBe(true)
  })

  it('does NOT map O to 0 or I to 1 — those characters are excluded, not substituted', () => {
    // Mapping them would be inventing a correction. The generator never emits either, so a
    // paste containing one is a different string, and a different string is a mismatch.
    const code = 'ABCDEF-GHJKLM-NPQRST-UVWXYZ'
    expect(verifyPastedCode(code.replace('0', 'O'), code)).toBe(true)   // no 0 in it — unchanged
    expect(verifyPastedCode('ABCDEI-GHJKLM-NPQRST-UVWXYZ', code)).toBe(false)
  })

  it('rejects a mismatch, and never throws on anything it is handed', () => {
    const code = 'ABCDEF-GHJKLM-NPQRST-UVWXYZ'
    const rubbish = [
      '', '   ', '-', 'ABCDEF', 'ZZZZZZ-ZZZZZZ-ZZZZZZ-ZZZZZZ',
      null, undefined, 42, {}, [], Symbol('x'), () => {},
    ]
    for (const r of rubbish) {
      expect(() => verifyPastedCode(r as never, code)).not.toThrow()
      expect(verifyPastedCode(r as never, code)).toBe(false)
    }
  })

  it('refuses to confirm against an expected value that is not a Recovery Code', () => {
    // Without this a ceremony holding an empty or corrupted expected code would accept an
    // empty paste and open the gate — the failure mode this function exists to prevent.
    for (const expected of ['', '   ', 'nonsense', null, undefined]) {
      expect(verifyPastedCode('', expected as never)).toBe(false)
      expect(verifyPastedCode('anything', expected as never)).toBe(false)
    }
  })

  it('normalization is idempotent and case-folding', () => {
    expect(normalizeRecoveryCode(' abc-def ')).toBe('ABCDEF')
    expect(normalizeRecoveryCode(normalizeRecoveryCode(' abc-def '))).toBe('ABCDEF')
  })

  it('accepts the dashes a rich-text editor substitutes for the one we printed', async () => {
    // This function exists for pasted text, and pasted text has been through Word, Notes,
    // Slack, Gmail or a PDF — every one of which rewrites `-` as an en or em dash. Rejecting
    // those rejects a CORRECT code for a reason the user cannot see on their screen.
    const issued = await ceremonyAt('code-issued')
    const code = (issued as Extract<BackupCeremonyState, { step: 'code-issued' }>).backup.recoveryCode
    const dashes: Record<string, string> = {
      'hyphen-minus': '-',
      'armenian hyphen': '֊',
      'hebrew maqaf': '־',
      'canadian syllabics hyphen': '᐀',
      'mongolian todo soft hyphen': '᠆',
      hyphen: '‐',
      'non-breaking hyphen': '‑',
      'figure dash': '‒',
      'en dash': '–',
      'em dash': '—',
      'horizontal bar': '―',
      'hyphen bullet': '⁃',
      'minus sign': '−',
      'two-em dash': '⸺',
      'three-em dash': '⸻',
      'small em dash': '﹘',
      'small hyphen-minus': '﹣',
      'fullwidth hyphen-minus': '－',
    }
    for (const [name, dash] of Object.entries(dashes)) {
      expect(verifyPastedCode(code.replace(/-/g, dash), code), name).toBe(true)
    }
  })

  it('ignores the invisible characters a copy out of a styled page drags along', async () => {
    const issued = await ceremonyAt('code-issued')
    const code = (issued as Extract<BackupCeremonyState, { step: 'code-issued' }>).backup.recoveryCode
    const invisibles: Record<string, string> = {
      'zero-width space': '​',
      'zero-width non-joiner': '‌',
      'zero-width joiner': '‍',
      'left-to-right mark': '‎',
      'right-to-left mark': '‏',
      'word joiner': '⁠',
      'byte-order mark': '﻿',
      'soft hyphen': '­',
    }
    for (const [name, ch] of Object.entries(invisibles)) {
      // Sprinkled through the code, and wrapped around it, as a real paste would be.
      expect(verifyPastedCode(`${ch}${code.split('').join(ch)}${ch}`, code), name).toBe(true)
    }
  })
})

describe('the ceremony state machine (AC1/AC3)', () => {
  it('issues a real backup whose code matches the shared pattern', async () => {
    const { privateKey } = generateIdentity()
    const issued = await issueBackup(privateKey, CONTEXT)
    expect(issued.step).toBe('code-issued')
    expect(issued.backup.recoveryCode).toMatch(RECOVERY_CODE_PATTERN)
    expect(issued.header.registrationBlock).toBeNull()
    expect(issued.header.backupBlock).toBe(CONTEXT.backupBlock)
    // The file it issued is a real backup of the real key, not a placeholder.
    expect(await restoreBackup(issued.backup.file, issued.backup.recoveryCode)).toBe(privateKey)
  })

  it('walks issue → confirm → save → ready', async () => {
    const issued = await ceremonyAt('code-issued')
    expect(issued.step).toBe('code-issued')
    const confirmed = confirmPastedCode(issued, (issued as never as { backup: { recoveryCode: string } }).backup.recoveryCode)
    expect(confirmed.step).toBe('code-confirmed')
    expect(markFileSaved(confirmed).step).toBe('ready')
  })

  it('a wrong paste leaves the state untouched — it is not an error step', async () => {
    const issued = await ceremonyAt('code-issued')
    const after = confirmPastedCode(issued, 'ZZZZZZ-ZZZZZZ-ZZZZZZ-ZZZZZZ')
    expect(after).toBe(issued)                 // same object: nothing was reset, nothing lost
    expect(ceremonyIsComplete(after)).toBe(false)
  })

  it('saving the file cannot skip the confirmation', async () => {
    // The ordering is a safety property. A surface that downloads the file first must not be
    // able to reach `ready` by reporting the download.
    const issued = await ceremonyAt('code-issued')
    expect(markFileSaved(issued).step).toBe('code-issued')
    expect(markFileSaved(beginCeremony()).step).toBe('not-started')
    expect(ceremonyIsComplete(markFileSaved(issued))).toBe(false)
  })

  it('a second confirmation of an already-confirmed ceremony changes nothing', async () => {
    const confirmed = await ceremonyAt('code-confirmed')
    expect(confirmPastedCode(confirmed, 'anything at all')).toBe(confirmed)
    expect(confirmPastedCode(confirmed, '')).toBe(confirmed)
  })

  it('`ready` is the only terminal step', async () => {
    for (const step of ['not-started', 'code-issued', 'code-confirmed'] as const) {
      expect(ceremonyIsComplete(await ceremonyAt(step)), step).toBe(false)
    }
    expect(ceremonyIsComplete(await ceremonyAt('ready'))).toBe(true)
  })

  it('the terminal state carries NEITHER secret — this is the one that gets persisted', async () => {
    // `ready` is the state that survives a reload, so story 1.11's session store is going to
    // write it somewhere. Holding the Recovery Code there would put the one secret we promise
    // never to see into localStorage, with the wrapped file — the other half of the split —
    // beside it. Both halves in one readable place is not a backup, it is a key.
    const confirmed = (await ceremonyAt('code-confirmed')) as
      Extract<BackupCeremonyState, { step: 'code-confirmed' }>
    const secrets = confirmed.backup

    const ready = markFileSaved(confirmed)
    expect(ready.step).toBe('ready')

    const serialized = JSON.stringify(ready)
    expect(serialized).not.toContain(secrets.recoveryCode)
    expect(serialized).not.toContain(secrets.file)
    expect('backup' in ready).toBe(false)

    // And it still carries what a surface legitimately needs afterwards.
    expect(ready.step === 'ready' && ready.filename).toBe(secrets.filename)
    expect(ready.step === 'ready' && ready.header).toEqual(confirmed.header)
  })

  it('no ciphertext survives into the terminal state either', async () => {
    const confirmed = await ceremonyAt('code-confirmed')
    const secrets = (confirmed as Extract<BackupCeremonyState, { step: 'code-confirmed' }>).backup
    const ct = JSON.parse(secrets.file).ct as string
    expect(JSON.stringify(markFileSaved(confirmed))).not.toContain(ct)
  })
})

describe('what story 1.11 may persist (C20)', () => {
  it('NO projection ever contains the code or the file, in any state', async () => {
    // The mid-ceremony states hold BOTH halves of the two-secret split. A session store that
    // persisted "the current ceremony" so a reload could resume would write the pair into
    // localStorage, where any script on the page reads them.
    for (const step of ['not-started', 'code-issued', 'code-confirmed', 'ready'] as const) {
      const state = await ceremonyAt(step)
      const projection = JSON.stringify(persistableCeremonyState(state))
      const secrets = (state as { backup?: { recoveryCode: string; file: string } }).backup
      if (secrets) {
        expect(projection, step).not.toContain(secrets.recoveryCode)
        expect(projection, step).not.toContain(secrets.file)
        expect(projection, step).not.toContain(JSON.parse(secrets.file).ct)
      }
    }
  })

  it('mid-ceremony persists as null — a stripped husk would not be resumable', async () => {
    // Without the code and the file there is nothing to confirm and nothing to save, so a
    // "resumed" code-issued would show a paste field for a code that no longer exists.
    for (const step of ['not-started', 'code-issued', 'code-confirmed'] as const) {
      expect(persistableCeremonyState(await ceremonyAt(step)), step).toBeNull()
    }
  })

  it('the terminal state persists whole, because it was already scrubbed', async () => {
    const ready = await ceremonyAt('ready')
    const projection = persistableCeremonyState(ready)
    expect(projection).not.toBeNull()
    expect(projection!.step).toBe('ready')
    expect(projection!.filename).toMatch(/^passbook-recovery-block-/)
    expect(projection!.header).toEqual((ready as { header: unknown }).header)
  })

  it('survives a JSON round trip unchanged — that is what persisting means', async () => {
    const projection = persistableCeremonyState(await ceremonyAt('ready'))
    expect(JSON.parse(JSON.stringify(projection))).toEqual(projection)
  })
})

describe('completing the ceremony IS the first verification (C2)', () => {
  it('produces a backed-up status and starts the ladder at 3 days', async () => {
    // Before this, finishing the ceremony left the status `unknown`, which collapses to
    // not-backed-up — so a user who had just written down a code, pasted it back and saved
    // the file was immediately shown "This account has no backup. Save it."
    const privateKey = generateIdentity().privateKey
    const confirmed = await ceremonyAt('code-confirmed', privateKey)

    const { state, outcome } = await completeCeremony(confirmed, privateKey, T0)
    expect(state.step).toBe('ready')
    expect(makeCanRegister(state)()).toBe(true)
    expect(outcome).not.toBeNull()
    expect(outcome!.status).toBe('backed-up')
    expect(readsAsBackedUp(outcome!.status)).toBe(true)
    expect(intervalDays(outcome!.cadence)).toBe(3)
    expect(outcome!.cadence.lastVerifiedAt).toBe(T0)
    expect(isCheckDue(outcome!.cadence, T0)).toBe(false)
  })

  it('the nag is gone the moment the ceremony completes', async () => {
    // The contract `backup-copy` states in as many words: "gone forever once a backup exists".
    const privateKey = generateIdentity().privateKey
    const confirmed = await ceremonyAt('code-confirmed', privateKey)
    const { outcome } = await completeCeremony(confirmed, privateKey, T0)
    expect(shouldNagForBackup(outcome!.status, 'present')).toBe(false)
    expect(backupNagCopy(outcome!.status, 'present')).toBeNull()
  })

  it('it is a REAL verification — the file is decrypted and the key compared', async () => {
    // Not an assumption that a file having been written means it can be opened. Handing it
    // the wrong account key fails, which could not happen if it were merely asserting success.
    const confirmed = await ceremonyAt('code-confirmed')
    const { state, outcome } = await completeCeremony(confirmed, generateIdentity().privateKey, T0)
    expect(outcome!.status).toBe('not-backed-up')
    expect(state.step).toBe('code-confirmed')          // the gate did NOT open
    expect(makeCanRegister(state)()).toBe(false)
  })

  it('a verifier that throws leaves the gate shut', async () => {
    const privateKey = generateIdentity().privateKey
    const confirmed = await ceremonyAt('code-confirmed', privateKey)
    const { state, outcome } = await completeCeremony(
      confirmed, privateKey, T0, 'unknown',
      async () => { throw new Error('WebCrypto unavailable') },
    )
    expect(state.step).toBe('code-confirmed')
    expect(makeCanRegister(state)()).toBe(false)
    expect(outcome!.status).toBe('not-backed-up')
  })

  it('does nothing from a state that is not code-confirmed', async () => {
    for (const step of ['not-started', 'code-issued', 'ready'] as const) {
      const state = await ceremonyAt(step)
      const result = await completeCeremony(state, generateIdentity().privateKey, T0)
      expect(result.state, step).toBe(state)
      expect(result.outcome, step).toBeNull()
    }
  })

  it('advances the ladder immediately when the session already holds a balance', async () => {
    const privateKey = generateIdentity().privateKey
    const confirmed = await ceremonyAt('code-confirmed', privateKey)
    const { outcome } = await completeCeremony(confirmed, privateKey, T0, 'present')
    expect(intervalDays(outcome!.cadence)).toBe(7)
  })
})

describe('makeCanRegister — the 1.12 seam (AC1/AC3)', () => {
  it('EVERY non-terminal state answers false, exhaustively', async () => {
    // GENUINELY exhaustive: the table is keyed by the union, so adding a step to
    // BackupCeremonyState without deciding its answer here is a COMPILE error. The previous
    // version of this assertion compared a hardcoded array against its own hardcoded length,
    // which passes no matter what the type does.
    const opensTheGate = {
      'not-started': false,
      'code-issued': false,
      'code-confirmed': false,
      ready: true,
    } satisfies Record<BackupCeremonyState['step'], boolean>

    for (const [step, expected] of Object.entries(opensTheGate)) {
      const predicate = makeCanRegister(await ceremonyAt(step as BackupCeremonyState['step']))
      expect(await predicate(), step).toBe(expected)
    }
    // And exactly one of them is a yes.
    expect(Object.values(opensTheGate).filter(Boolean)).toHaveLength(1)
  })

  it('the terminal state answers true', async () => {
    expect(await makeCanRegister(await ceremonyAt('ready'))()).toBe(true)
  })

  it('takes no arguments and never throws — 1.12 calls it blind', async () => {
    for (const step of ['not-started', 'code-issued', 'code-confirmed', 'ready'] as const) {
      const predicate = makeCanRegister(await ceremonyAt(step))
      expect(predicate).toHaveLength(0)
      expect(() => predicate()).not.toThrow()
    }
  })

  it('actually refuses a real registration, without register.ts knowing what a backup is', async () => {
    // The integration proof: the predicate goes in through the EXISTING `canRegister` seam,
    // and the pipeline stops before the pre-flight reads anything from the chain.
    let preflightCalled = false
    const result = await registerSponsored(
      { accountKey: generateIdentity().privateKey, account: { address: '0x1', signer: {} as never } },
      {
        canRegister: makeCanRegister(await ceremonyAt('code-confirmed')),
        preflight: async () => { preflightCalled = true; return { route: 'unregistered' } },
      },
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.kind).toBe('backup-not-confirmed')
    expect(result.stages).toEqual([])          // nothing was built, proved, or relayed
    expect(preflightCalled).toBe(false)        // refused before the chain was even read
  })
})

describe('the live header context (AC4)', () => {
  it('builds a provisional header from a successful read', async () => {
    const context = await readBackupHeaderContext(async () => ({
      blockNumber: 13_779_000,
      auditorKey: 0xa0d17012n,
    }))
    expect(context.ok).toBe(true)
    if (!context.ok) throw new Error('unreachable')
    expect(context.auditorKeyAtBackupBlock).toBe('0xa0d17012')
    expect(provisionalHeader(context, '0xabc')).toEqual({
      receiveAddress: '0xabc',
      backupBlock: 13_779_000,
      auditorKeyAtBackupBlock: '0xa0d17012',
      registrationBlock: null,
    })
  })

  it('omits receiveAddress rather than writing undefined when the ceremony has no address', async () => {
    const context = await readBackupHeaderContext(async () => ({ blockNumber: 1, auditorKey: 2n }))
    if (!context.ok) throw new Error('unreachable')
    expect('receiveAddress' in provisionalHeader(context)).toBe(false)
  })

  it('returns a typed failure on an unreachable chain — never a default and never a throw', async () => {
    const context = await readBackupHeaderContext(async () => {
      throw new Error('all RPC hosts failed: ECONNREFUSED')
    })
    expect(context.ok).toBe(false)
    if (context.ok) throw new Error('unreachable')
    expect(context.reason).toMatch(/ECONNREFUSED/)
  })

  it('REFUSES AT RUNTIME when handed a failed context, not merely at compile time', async () => {
    // The matrix row: header context unfetchable → typed failure, NO FILE. The type says a
    // failed context cannot get here; types are erased at run time, and the caller is UI code
    // holding a value that came back from an async read — the likeliest place for an
    // unchecked branch to be passed along. So the refusal is a real throw, and this test
    // genuinely invokes it (`as never`) rather than asserting that a function exists.
    const context = await readBackupHeaderContext(async () => { throw new Error('offline') })
    expect(context.ok).toBe(false)
    await expect(issueBackup(VALID_KEY, context as never)).rejects.toThrow(/refusing to issue/)

    // And nothing shaped like a context gets through either.
    for (const bad of [undefined, null, {}, { ok: false, reason: 'x' }, { ok: 'yes' }]) {
      await expect(issueBackup(VALID_KEY, bad as never), JSON.stringify(bad) ?? 'undefined')
        .rejects.toThrow(/refusing to issue/)
    }
  })

  it('refuses to issue for something that is not a Stark private key', async () => {
    // Checked before a Recovery Code is generated: issuing a code for a file that will not be
    // written is how a user ends up saving a code that opens nothing.
    for (const key of ['', 'not a key', '0x', 'deadbeef', null, undefined, 42]) {
      await expect(issueBackup(key as never, CONTEXT)).rejects.toThrow(/refusing to issue/)
    }
  })

  it('gives up on a hung chain instead of leaving the ceremony on a spinner', async () => {
    // A typed failure that never arrives is not a typed failure. An RPC that accepts the
    // connection and then never answers left this promise pending forever, in front of a user
    // who has not saved their key yet — worse than an error, because an error has a retry.
    const started = Date.now()
    const context = await readBackupHeaderContext(() => new Promise(() => {}), 25)
    expect(context.ok).toBe(false)
    if (context.ok) throw new Error('unreachable')
    expect(context.reason).toMatch(/did not answer within 25ms/)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('a read that answers in time is unaffected by the timeout', async () => {
    const context = await readBackupHeaderContext(
      async () => ({ blockNumber: 7, auditorKey: 9n }),
      10_000,
    )
    expect(context.ok).toBe(true)
  })

  it('rejects an injected reader that returns a zero key or a nonsense block', async () => {
    // The guard lives in readBackupHeaderContext, not only in the default reader — otherwise a
    // caller passing their own reader (a cache, a batched multicall, a test double) silently
    // opts out of it, and the most legitimate-looking path is the one that writes a header
    // claiming registrations escrow to nobody.
    const bad = [
      { blockNumber: 1, auditorKey: 0n },
      { blockNumber: -1, auditorKey: 5n },
      { blockNumber: 1.5, auditorKey: 5n },
      { blockNumber: NaN, auditorKey: 5n },
      { blockNumber: 1, auditorKey: -1n },
      { blockNumber: 1, auditorKey: 5 as never },
      { blockNumber: '1' as never, auditorKey: 5n },
    ]
    for (const reading of bad) {
      const context = await readBackupHeaderContext(async () => reading)
      expect(context.ok, JSON.stringify(String(reading.auditorKey))).toBe(false)
    }
  })
})
