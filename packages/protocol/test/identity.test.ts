import { describe, it, expect } from 'vitest'
import { webcrypto as crypto } from 'node:crypto'
import { ec } from 'starknet'
import {
  generateIdentity, createBackup, restoreBackup, deriveIdentityPublicKey,
  deriveViewingKey, canonicalizeViewingKey, assertViewingKey, MAX_VIEWING_KEY,
  generateRecoveryCode, RECOVERY_CODE_PATTERN, BackupRestoreError, backupFilename,
  readBackupHeader, reissueBackupHeader, BACKUP_ENVELOPE_VERSION, MAX_KDF_ITERATIONS,
  verifyBackupAgainstKey, MAX_CIPHERTEXT_BYTES, canonicalizeRecoveryCode,
  normalizeRecoveryCode, isStarkPrivateKey, type BackupHeader,
} from '../src/identity.js'
import {
  BACKUP_VERIFICATION_FAILED, MALFORMED_BACKUP_FILE, UNSUPPORTED_BACKUP_VERSION,
  WRONG_RECOVERY_CODE,
} from '../src/backup-copy.js'

const ORDER = ec.starkCurve.CURVE.n
const POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const SN_MAIN = '0x534e5f4d41494e'

// Deliberately fake values. The real auditor key and block are LIVE READS in src (see
// pool.ts `readAuditorKeyAtBlock`); a plausible-looking real one sitting in a fixture is how
// a hardcoded key eventually gets copied into source.
const TEST_HEADER: BackupHeader = {
  receiveAddress: '0x04f2000000000000000000000000000000000000000000000000000000009c1a',
  backupBlock: 13_779_000,
  auditorKeyAtBackupBlock: '0x0a0d17026e51e57',
  registrationBlock: null,
}

// The D33/AD-4 boundary tests — none existed before; the fold's illegal-input handling is
// exactly the fund-loss class the deep-recon (V4) flagged, so it is tested directly.
describe('viewing-key canonicalization (AD-4)', () => {
  it('accepts a normal lower-half scalar unchanged', () => {
    expect(canonicalizeViewingKey(1n)).toBe(1n)
    expect(canonicalizeViewingKey(MAX_VIEWING_KEY - 1n)).toBe(MAX_VIEWING_KEY - 1n)
  })

  it('folds an upper-half scalar down to its lower-half twin', () => {
    expect(canonicalizeViewingKey(ORDER - 1n)).toBe(1n)
    expect(canonicalizeViewingKey(MAX_VIEWING_KEY + 2n)).toBe(MAX_VIEWING_KEY - 1n)
  })

  it('THROWS on the three residues with no legal representative, never silently remaps', () => {
    // The old `?: 1n` remap returned an out-of-range key on MAX and MAX+1 — the bug.
    expect(() => canonicalizeViewingKey(0n)).toThrow(/out of range/)
    expect(() => canonicalizeViewingKey(MAX_VIEWING_KEY)).toThrow(/out of range/)
    expect(() => canonicalizeViewingKey(MAX_VIEWING_KEY + 1n)).toThrow(/out of range/)
  })

  it('every value it returns passes the strict pool bound', () => {
    for (const r of [1n, 2n, MAX_VIEWING_KEY - 1n, MAX_VIEWING_KEY + 2n, ORDER - 1n]) {
      expect(() => assertViewingKey(canonicalizeViewingKey(r))).not.toThrow()
    }
  })

  it('assertViewingKey enforces [1, MAX) strictly — MAX itself is illegal (SDK admits it; we do not)', () => {
    expect(() => assertViewingKey(0n)).toThrow()
    expect(() => assertViewingKey(MAX_VIEWING_KEY)).toThrow()
    expect(() => assertViewingKey(1n)).not.toThrow()
    expect(() => assertViewingKey(MAX_VIEWING_KEY - 1n)).not.toThrow()
  })
})

describe('deriveViewingKey (AD-4 / D33)', () => {
  it('is deterministic for the same account key, chain, and pool', () => {
    const { privateKey } = generateIdentity()
    expect(deriveViewingKey(privateKey, SN_MAIN, POOL))
      .toBe(deriveViewingKey(privateKey, SN_MAIN, POOL))
  })

  it('is bound to the pool and the chain — a different pool or chain yields a different key', () => {
    const { privateKey } = generateIdentity()
    const base = deriveViewingKey(privateKey, SN_MAIN, POOL)
    expect(deriveViewingKey(privateKey, SN_MAIN, '0x01')).not.toBe(base)      // other pool
    expect(deriveViewingKey(privateKey, '0x534e5f5345504f4c4941', POOL)).not.toBe(base) // sepolia
  })

  it('a different account key yields a different viewing key', () => {
    expect(deriveViewingKey(generateIdentity().privateKey, SN_MAIN, POOL))
      .not.toBe(deriveViewingKey(generateIdentity().privateKey, SN_MAIN, POOL))
  })

  it('always returns a strictly legal key across many random account keys (never throws)', () => {
    for (let i = 0; i < 200; i++) {
      const k = deriveViewingKey(generateIdentity().privateKey, SN_MAIN, POOL)
      expect(() => assertViewingKey(k)).not.toThrow()
    }
  })
})

describe('identity', () => {
  it('generates a distinct keypair each time', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    expect(a.privateKey).not.toBe(b.privateKey)
    expect(a.publicKey).toBe(deriveIdentityPublicKey(a.privateKey))
  })

  it('round-trips a backup with its recovery code', async () => {
    const { privateKey } = generateIdentity()
    const { file, recoveryCode } = await createBackup(privateKey, TEST_HEADER)
    expect(await restoreBackup(file, recoveryCode)).toBe(privateKey)
  })

  it('generates the recovery code itself — it is never user-chosen', async () => {
    const { recoveryCode } = await createBackup(generateIdentity().privateKey, TEST_HEADER)
    expect(recoveryCode).toMatch(RECOVERY_CODE_PATTERN)
  })

  it('rejects the wrong recovery code rather than returning garbage', async () => {
    const { file } = await createBackup(generateIdentity().privateKey, TEST_HEADER)
    await expect(restoreBackup(file, 'AAAAAA-BBBBBB-CCCCCC-DDDDDD')).rejects.toThrow(/recovery code/i)
  })

  it('leaks no plaintext key material into the backup file', async () => {
    const { privateKey } = generateIdentity()
    const { file } = await createBackup(privateKey, TEST_HEADER)
    expect(file).not.toContain(privateKey.replace(/^0x/, ''))
  })

  it('restores a backup written at a different iteration count than the current default', async () => {
    // Builds an envelope by hand at a deliberately non-default iteration count, to prove
    // restoreBackup honours env.iterations rather than closing over the module's current
    // KDF_ITERATIONS floor. If it ever regresses to the module constant, raising that
    // floor in the future would silently break every backup ever written — this must
    // never happen, so the test constructs a mismatch on purpose and expects success.
    const { privateKey } = generateIdentity()
    const recoveryCode = 'ABCDEF-GHJKLM-NPQRST-UVWXYZ'
    const iterations = 1_000
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(recoveryCode), 'PBKDF2', false, ['deriveKey'],
    )
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
    )
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKey),
      ),
    )
    const file = JSON.stringify({
      v: 1,
      kdf: 'PBKDF2-SHA256',
      iterations,
      salt: Buffer.from(salt).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      ct: Buffer.from(ct).toString('base64'),
    })
    expect(await restoreBackup(file, recoveryCode)).toBe(privateKey)
  })

  it('reports a malformed backup file distinctly from a wrong recovery code', async () => {
    await expect(restoreBackup('not json at all', 'AAAAAA-BBBBBB-CCCCCC-DDDDDD'))
      .rejects.toThrow(/malformed|invalid/i)
  })
})

// ── The Recovery Code (AC2): format and the modulo-bias fix ───────────────────────────────
describe('the Recovery Code (AC2)', () => {
  it('is four groups of six from the 34-character alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRecoveryCode()
      expect(code).toMatch(RECOVERY_CODE_PATTERN)
      expect(code).toHaveLength(27)                      // 24 characters + 3 dashes
      expect(code.split('-').every((g) => g.length === 6)).toBe(true)
    }
  })

  it('never emits I or O — they are the characters the alphabet excludes as misreadable', () => {
    const drawn = Array.from({ length: 500 }, generateRecoveryCode).join('')
    expect(drawn).not.toMatch(/[IO]/)
  })

  it('the exported pattern is the rule the generator actually follows', () => {
    // One rule, shared. A pattern that admits characters the generator never emits would let
    // a typo through the paste field; one that rejects characters it does emit would reject a
    // correct code. Both directions are asserted rather than assumed.
    expect(RECOVERY_CODE_PATTERN.test(generateRecoveryCode())).toBe(true)
    expect(RECOVERY_CODE_PATTERN.test('ABCD-EFGH-JKLM-NPQR')).toBe(false)   // the old 4×4 shape
    expect(RECOVERY_CODE_PATTERN.test('ABCDEI-GHJKLM-NPQRST-UVWXYZ')).toBe(false)  // contains I
    expect(RECOVERY_CODE_PATTERN.test('ABCDEO-GHJKLM-NPQRST-UVWXYZ')).toBe(false)  // contains O
    expect(RECOVERY_CODE_PATTERN.test('abcdef-ghjklm-npqrst-uvwxyz')).toBe(false)  // lower case
  })

  it('is rejection-sampled, not modulo-reduced — the alphabet is drawn uniformly', () => {
    // The bug this replaces: `byte % 34` over a uniform byte. 256 = 7×34 + 18, so the FIRST
    // 18 letters of the alphabet came up 8 times per 256 draws and the remaining 16 came up
    // 7 — about 14% more often. This test is a distribution check, so it is written to fail
    // on that specific skew and not on ordinary randomness: with ~48k samples the biased
    // generator separates the two halves by ~14%, while a uniform one keeps them within a
    // couple of percent. The 6% threshold sits well clear of both.
    const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    const counts = new Map<string, number>(Array.from(ALPHABET, (c) => [c, 0]))
    const samples = 2_000
    for (let i = 0; i < samples; i++) {
      for (const ch of generateRecoveryCode().replace(/-/g, '')) {
        counts.set(ch, counts.get(ch)! + 1)
      }
    }
    const total = samples * 24
    // Every character must appear; a rejection loop that discarded too much would starve some.
    for (const c of ALPHABET) expect(counts.get(c)!).toBeGreaterThan(0)

    const favoured = ALPHABET.slice(0, 18)      // the residues the old `% 34` over-sampled
    const rest = ALPHABET.slice(18)
    const rateOf = (chars: string) =>
      [...chars].reduce((n, c) => n + counts.get(c)!, 0) / chars.length / total
    const skew = rateOf(favoured) / rateOf(rest)
    expect(skew).toBeGreaterThan(0.94)
    expect(skew).toBeLessThan(1.06)
  })
})

// ── The Recovery File header (AC4) ────────────────────────────────────────────────────────
describe('the Recovery File header (AC4)', () => {
  it('writes the header in PLAINTEXT and the key in none of it', async () => {
    const { privateKey } = generateIdentity()
    const { file } = await createBackup(privateKey, TEST_HEADER)
    const env = JSON.parse(file)
    expect(env.v).toBe(BACKUP_ENVELOPE_VERSION)
    expect(env.header).toEqual(TEST_HEADER)
    // Readable without the code — that is the point of a plaintext header.
    expect(readBackupHeader(file)).toEqual(TEST_HEADER)
    // And still no key material anywhere in the bytes, header or not.
    expect(file).not.toContain(privateKey.replace(/^0x/, ''))
  })

  it('carries registrationBlock: null explicitly — never a placeholder or the backup block', async () => {
    const { file } = await createBackup(generateIdentity().privateKey, TEST_HEADER)
    const header = readBackupHeader(file)!
    // The field is PRESENT and null. Absent would be indistinguishable from an old file, and
    // 0 or the backup block would be the field holding a different thing than its label says.
    expect('registrationBlock' in header).toBe(true)
    expect(header.registrationBlock).toBeNull()
    expect(header.backupBlock).toBe(TEST_HEADER.backupBlock)
  })

  it('names the file by its backup block and nothing secret', async () => {
    const { filename, recoveryCode } = await createBackup(generateIdentity().privateKey, TEST_HEADER)
    expect(filename).toBe('passbook-recovery-block-13779000.json')
    expect(filename).toBe(backupFilename(TEST_HEADER))
    expect(filename).not.toContain(TEST_HEADER.auditorKeyAtBackupBlock)
    expect(filename).not.toContain(recoveryCode)
    expect(filename).not.toContain(String(TEST_HEADER.receiveAddress))
  })

  it('marks a re-issued file in its name, so a same-block pair is still distinguishable', () => {
    // The name is not unique and does not try to be, but the one collision the product can
    // actually produce — re-issuing inside the registration's own block — is broken here.
    const reissued = { ...TEST_HEADER, registrationBlock: 13_779_000 }
    expect(backupFilename(reissued)).toBe('passbook-recovery-block-13779000-reissued.json')
    expect(backupFilename(reissued)).not.toBe(backupFilename(TEST_HEADER))
  })

  it('refuses to write a header that would produce a nonsense file', async () => {
    // `passbook-recovery-block-NaN.json`, and a header stating a block that never existed.
    const bad = [
      { ...TEST_HEADER, backupBlock: NaN },
      { ...TEST_HEADER, backupBlock: 1.5 },
      { ...TEST_HEADER, backupBlock: -1 },
      { ...TEST_HEADER, backupBlock: '13779000' as never },
      { ...TEST_HEADER, auditorKeyAtBackupBlock: 'not a felt' },
      { ...TEST_HEADER, auditorKeyAtBackupBlock: '' },
      { ...TEST_HEADER, auditorKeyAtBackupBlock: `0x${'f'.repeat(64)}` },   // above the prime
      { ...TEST_HEADER, registrationBlock: 1.5 },
      { ...TEST_HEADER, registrationBlock: -3 },
      { ...TEST_HEADER, receiveAddress: 42 as never },
      { ...TEST_HEADER, receiveAddress: 'not-an-address' },
      // Nested values cannot be canonicalized by a top-level sort, so the reordered-header
      // guarantee would silently stop holding for them. Refused at write instead.
      { ...TEST_HEADER, extra: { nested: true } } as never,
      { ...TEST_HEADER, extra: [1, 2] } as never,
    ]
    for (const header of bad) {
      await expect(
        createBackup(generateIdentity().privateKey, header),
        JSON.stringify(header.backupBlock),
      ).rejects.toThrow(/refusing/)
    }
  })

  it('refuses to wrap something that is not a Stark private key', async () => {
    for (const key of ['', 'not a key', '0x', 'deadbeef', null, undefined, 42]) {
      await expect(createBackup(key as never, TEST_HEADER)).rejects.toThrow(/refusing/)
    }
  })

  it('re-issues with the real registration block, and the OLD FILE STILL OPENS', async () => {
    const { privateKey } = generateIdentity()
    const first = await createBackup(privateKey, TEST_HEADER)

    const reissued = reissueBackupHeader(TEST_HEADER, {
      backupBlock: 13_780_500,
      auditorKeyAtBackupBlock: '0x0a0d17026e51e57',
      registrationBlock: 13_780_499,
    })
    const second = await createBackup(privateKey, reissued)

    expect(readBackupHeader(second.file)!.registrationBlock).toBe(13_780_499)
    expect(readBackupHeader(second.file)!.backupBlock).toBe(13_780_500)
    expect(readBackupHeader(second.file)!.receiveAddress).toBe(TEST_HEADER.receiveAddress)

    // The non-revocation property, as an executable fact rather than a copy promise: a
    // re-issue creates a SECOND file and cannot invalidate the first. Both open the same key,
    // each with its own code, and the codes are not interchangeable.
    expect(await restoreBackup(first.file, first.recoveryCode)).toBe(privateKey)
    expect(await restoreBackup(second.file, second.recoveryCode)).toBe(privateKey)
    expect(first.recoveryCode).not.toBe(second.recoveryCode)
    await expect(restoreBackup(first.file, second.recoveryCode)).rejects.toThrow(WRONG_RECOVERY_CODE)
  })

  it('never throws out of readBackupHeader, whatever it is handed', () => {
    for (const junk of ['', 'not json', 'null', '[]', '{}', '{"header":3}', '{"header":null}']) {
      expect(readBackupHeader(junk)).toBeNull()
    }
  })

  it('validates every header field rather than probing for presence', async () => {
    // A header is the part of the file an attacker hands over in whatever shape they like, and
    // callers read these values into sentences stated as facts. A malformed one must read as
    // NO header rather than flow through to a screen.
    const { file } = await createBackup(generateIdentity().privateKey, TEST_HEADER)
    const env = JSON.parse(file)
    const bad: Record<string, unknown> = {
      'backupBlock is a string': { ...TEST_HEADER, backupBlock: '13779000' },
      'backupBlock is fractional': { ...TEST_HEADER, backupBlock: 1.5 },
      'backupBlock is negative': { ...TEST_HEADER, backupBlock: -1 },
      'auditor key is not a string': { ...TEST_HEADER, auditorKeyAtBackupBlock: 12345 },
      'auditor key is not hex': { ...TEST_HEADER, auditorKeyAtBackupBlock: 'not-a-felt' },
      'auditor key lacks 0x': { ...TEST_HEADER, auditorKeyAtBackupBlock: 'a0d17012' },
      'auditor key is over 64 nibbles': { ...TEST_HEADER, auditorKeyAtBackupBlock: `0x${'a'.repeat(65)}` },
      // Right LENGTH, still not a felt — a length-only check passes a value the chain could
      // never have returned, and the header would state it as the auditor's key.
      'auditor key is above the field prime': { ...TEST_HEADER, auditorKeyAtBackupBlock: `0x${'f'.repeat(64)}` },
      'receiveAddress is not a felt': { ...TEST_HEADER, receiveAddress: 'not-an-address' },
      'receiveAddress is above the field prime': { ...TEST_HEADER, receiveAddress: `0x${'f'.repeat(64)}` },
      'registrationBlock is a string': { ...TEST_HEADER, registrationBlock: '1' },
      'registrationBlock is fractional': { ...TEST_HEADER, registrationBlock: 2.5 },
      'receiveAddress is a number': { ...TEST_HEADER, receiveAddress: 42 },
      'header is an array': [],
    }
    for (const [what, header] of Object.entries(bad)) {
      expect(readBackupHeader(JSON.stringify({ ...env, header })), what).toBeNull()
    }
    // registrationBlock: null is legal and must survive the same validation.
    expect(readBackupHeader(JSON.stringify({ ...env, header: TEST_HEADER }))).toEqual(TEST_HEADER)
  })
})

// ── Header authentication (B1): the header is sealed with the key ─────────────────────────
//
// The property: a Recovery File's plaintext header cannot be edited after it is written. It
// is bound to the ciphertext as AES-GCM additional data, so tampering breaks decryption
// rather than producing a key alongside a header that lies about it. Without this, swapping
// in another file's header — a different auditor key, a different registration block, a
// different receive address — decrypted cleanly and was believed.
describe('the header is authenticated, not merely present (AC4)', () => {
  async function tamper(mutate: (header: Record<string, unknown>) => unknown) {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    const env = JSON.parse(made.file)
    return {
      privateKey,
      made,
      tampered: JSON.stringify({ ...env, header: mutate({ ...env.header }) }),
    }
  }

  it('writes v:2 and seals the header with the ciphertext', async () => {
    const { file } = await createBackup(generateIdentity().privateKey, TEST_HEADER)
    expect(JSON.parse(file).v).toBe(2)
    expect(BACKUP_ENVELOPE_VERSION).toBe(2)
  })

  it('a swapped auditor key breaks decryption instead of being believed', async () => {
    const { made, tampered } = await tamper((h) => ({ ...h, auditorKeyAtBackupBlock: '0xdeadbeef' }))
    // Readable — additional data is authenticated, not encrypted — but not USABLE.
    expect(readBackupHeader(tampered)!.auditorKeyAtBackupBlock).toBe('0xdeadbeef')
    await expect(restoreBackup(tampered, made.recoveryCode)).rejects.toThrow(WRONG_RECOVERY_CODE)
  })

  it('every other edited field breaks it too', async () => {
    const edits: Record<string, (h: Record<string, unknown>) => unknown> = {
      'backup block moved': (h) => ({ ...h, backupBlock: 1 }),
      'registration block invented': (h) => ({ ...h, registrationBlock: 99 }),
      'receive address swapped': (h) => ({ ...h, receiveAddress: '0xdead' }),
      'a field added': (h) => ({ ...h, extra: 'smuggled' }),
      'a field removed': ({ receiveAddress, ...rest }) => rest,
      'the header deleted entirely': () => undefined,
      'the header replaced with null': () => null,
    }
    for (const [what, mutate] of Object.entries(edits)) {
      const { made, tampered } = await tamper(mutate)
      await expect(restoreBackup(tampered, made.recoveryCode), what).rejects.toThrow(WRONG_RECOVERY_CODE)
    }
  })

  it('a REORDERED header still opens — it says the same thing', async () => {
    // Canonicalization sorts the keys, so re-serialising a parsed header reproduces the sealed
    // bytes. Without it, any reader that rebuilt the JSON in a different key order would
    // reject perfectly good files.
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    const env = JSON.parse(made.file)
    const reordered = Object.fromEntries(Object.entries(env.header).reverse())
    expect(Object.keys(reordered)).not.toEqual(Object.keys(env.header))
    const rebuilt = JSON.stringify({ ...env, header: reordered })
    expect(await restoreBackup(rebuilt, made.recoveryCode)).toBe(privateKey)
  })

  it('a downgrade to v:1 does not strip the binding, it just fails', async () => {
    // Rewriting `v` to 1 makes the reader omit the additional data the ciphertext was sealed
    // with, so authentication fails. The legacy path is not an escape hatch.
    const { made, tampered } = await tamper((h) => ({ ...h, auditorKeyAtBackupBlock: '0xdeadbeef' }))
    const downgraded = JSON.stringify({ ...JSON.parse(tampered), v: 1 })
    await expect(restoreBackup(downgraded, made.recoveryCode)).rejects.toThrow(WRONG_RECOVERY_CODE)
  })

  it('still reads a genuine v:1 file, which was written without any binding', async () => {
    // Dual-version reading, per the spec's "bump to v:2 accepting both". Built by hand at v:1
    // because this build no longer writes one.
    const { privateKey } = generateIdentity()
    const recoveryCode = 'ABCDEF-GHJKLM-NPQRST-UVWXYZ'
    const iterations = 1_000
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(recoveryCode), 'PBKDF2', false, ['deriveKey'],
    )
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
    )
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKey)),
    )
    const legacy = JSON.stringify({
      v: 1, kdf: 'PBKDF2-SHA256', iterations,
      salt: Buffer.from(salt).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      ct: Buffer.from(ct).toString('base64'),
    })
    expect(await restoreBackup(legacy, recoveryCode)).toBe(privateKey)
    expect(readBackupHeader(legacy)).toBeNull()
  })
})

// ── The restore error taxonomy (AC2) ──────────────────────────────────────────────────────
//
// The property under test, stated once: ONLY a structurally sound envelope that fails to
// decrypt is allowed to say anything about the recovery code. Everything else blames the
// file. Before this, every failure after `JSON.parse` returned the wrong-code sentence.
describe('restore error taxonomy (AC2)', () => {
  const CODE = 'ABCDEF-GHJKLM-NPQRST-UVWXYZ'

  /** A real headered envelope, parsed, ready to be damaged one field at a time. */
  async function envelope() {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    return { privateKey, made, env: JSON.parse(made.file) as Record<string, unknown> }
  }

  async function failureOf(file: string, code: string): Promise<BackupRestoreError> {
    try {
      await restoreBackup(file, code)
    } catch (e) {
      expect(e).toBeInstanceOf(BackupRestoreError)
      return e as BackupRestoreError
    }
    throw new Error('restoreBackup resolved when it was expected to fail')
  }

  it('classifies text that is not JSON', async () => {
    const f = await failureOf('not json at all', CODE)
    expect(f.kind).toBe('not-json')
    expect(f.message).toBe(MALFORMED_BACKUP_FILE)
  })

  it('classifies valid JSON that is not an envelope — including the four bytes `null`', async () => {
    // `JSON.parse('null')` succeeds and returns null. The previous version read `.v` straight
    // off it and threw a bare TypeError out of the module — neither sentence, no branch.
    for (const notAnEnvelope of ['null', '[]', '"a string"', '42', '{}']) {
      const f = await failureOf(notAnEnvelope, CODE)
      expect(f.kind).toBe('not-an-envelope')
      expect(f.message).toBe(MALFORMED_BACKUP_FILE)
    }
  })

  it('a version claim is a NUMBER — an object without one is not a newer envelope', async () => {
    // The distinction is user-facing: "newer than this build, do not delete it" must not be
    // said about a JSON file that was never a Recovery File in the first place.
    for (const v of [undefined, '1', null, true]) {
      const f = await failureOf(JSON.stringify({ v, salt: 'AA' }), CODE)
      expect(f.kind).toBe('not-an-envelope')
      expect(f.message).toBe(MALFORMED_BACKUP_FILE)
    }
  })

  it('classifies an unsupported version, and does not call it corrupt', async () => {
    const { env } = await envelope()
    // A version from the future. 1 and 2 are both read (see SUPPORTED_BACKUP_VERSIONS).
    const f = await failureOf(JSON.stringify({ ...env, v: 3 }), CODE)
    expect(f.kind).toBe('unsupported-version')
    expect(f.message).toBe(UNSUPPORTED_BACKUP_VERSION)
    // Telling a user their only copy is malformed invites them to delete it.
    expect(f.message).not.toBe(MALFORMED_BACKUP_FILE)
    expect(f.message).not.toBe(WRONG_RECOVERY_CODE)
  })

  it('classifies a genuinely wrong code, and ONLY that, as a wrong code', async () => {
    const { made } = await envelope()
    const f = await failureOf(made.file, 'ZZZZZZ-ZZZZZZ-ZZZZZZ-ZZZZZZ')
    expect(f.kind).toBe('undecryptable')
    expect(f.message).toBe(WRONG_RECOVERY_CODE)
    expect(f.message).toBe('That file and recovery code do not open this key.')
  })

  it('NEVER blames the code for a damaged file, even with the right code in hand', async () => {
    const { made, env } = await envelope()
    const damaged: Record<string, string> = {
      'truncated file': made.file.slice(0, Math.floor(made.file.length / 2)),
      'salt is not base64': JSON.stringify({ ...env, salt: 'not base64!!' }),
      'iv is not base64': JSON.stringify({ ...env, iv: '@@@@' }),
      'ct is not base64': JSON.stringify({ ...env, ct: 'not base64!!' }),
      'salt is the wrong length': JSON.stringify({ ...env, salt: 'AAAA' }),
      'iv is the wrong length': JSON.stringify({ ...env, iv: 'AAAA' }),
      'ct is too short to be a GCM output': JSON.stringify({ ...env, ct: 'AAAAAAAA' }),
      'salt is missing': JSON.stringify({ ...env, salt: undefined }),
      'iterations is absent': JSON.stringify({ ...env, iterations: undefined }),
      'iterations is a string': JSON.stringify({ ...env, iterations: '600000' }),
      'iterations is zero': JSON.stringify({ ...env, iterations: 0 }),
      'iterations is fractional': JSON.stringify({ ...env, iterations: 1.5 }),
    }
    for (const [what, file] of Object.entries(damaged)) {
      // The RIGHT code is passed every time — so any wrong-code sentence here is a false
      // accusation against a code that would have worked.
      const f = await failureOf(file, made.recoveryCode)
      expect(f.kind, what).not.toBe('undecryptable')
      expect(f.message, what).not.toBe(WRONG_RECOVERY_CODE)
      expect(f.message, what).toBe(MALFORMED_BACKUP_FILE)
    }
  })

  it('a mid-ciphertext truncation is caught by structure, not blamed on the code', async () => {
    const { made, env } = await envelope()
    // A ciphertext cut down to its first few base64 characters decodes to fewer bytes than an
    // AES-GCM tag, so it cannot be a wrapped key at all and is refused on structure.
    const cut = JSON.stringify({ ...env, ct: String(env.ct).slice(0, 8) })
    const f = await failureOf(cut, made.recoveryCode)
    expect(f.kind).toBe('not-an-envelope')
    expect(f.message).toBe(MALFORMED_BACKUP_FILE)
  })

  it('carries a debuggable detail without putting it in front of the user', async () => {
    const { made, env } = await envelope()
    const f = await failureOf(JSON.stringify({ ...env, iv: 'AAAA' }), made.recoveryCode)
    expect(f.detail).toMatch(/iv/)
    expect(f.message).not.toContain('iv')     // the detail is for logs, not for a screen
  })

  it('ships both sentences byte-exact', () => {
    expect(WRONG_RECOVERY_CODE).toBe('That file and recovery code do not open this key.')
    expect(MALFORMED_BACKUP_FILE).toBe('That backup file is malformed or truncated.')
  })

  it('refuses an iteration count above the cap instead of hanging the tab', async () => {
    // `iterations` is attacker-chosen. Unbounded it is a denial of service with no error to
    // show: the tab stops responding inside PBKDF2 and the file merely looks "slow".
    //
    // Asserted STRUCTURALLY — the kind and the detail — rather than by wall-clock. A timing
    // assertion here would be flake bait on a loaded CI box, and it would be testing the
    // machine rather than the code: the refusal is synchronous validation that happens before
    // any derivation, and the detail naming the cap is what proves that.
    const { made, env } = await envelope()
    const f = await failureOf(JSON.stringify({ ...env, iterations: 2_000_000_000 }), made.recoveryCode)
    expect(f.kind).toBe('not-an-envelope')
    expect(f.message).toBe(MALFORMED_BACKUP_FILE)
    expect(f.detail).toMatch(/above the \d+ cap/)
    expect(f.detail).toContain('2000000000')
  })

  it('accepts an iteration count at the cap, without running it', async () => {
    // The boundary is asserted at the VALIDATION layer: a count of exactly MAX_KDF_ITERATIONS
    // gets past `iterations` and fails on something later, proving the cap is inclusive.
    // Deriving at 10,000,000 rounds for real would add seconds to every suite run to prove a
    // comparison operator, so the envelope is made unusable one field further on and the kind
    // tells us which check it reached.
    const { made, env } = await envelope()
    const atCap = await failureOf(
      JSON.stringify({ ...env, iterations: MAX_KDF_ITERATIONS, ct: 'AAAAAAAA' }),
      made.recoveryCode,
    )
    expect(atCap.detail).not.toMatch(/cap/)      // it got past the iteration bound
    expect(atCap.detail).toMatch(/ct is/)        // and failed on the field after it

    // One over is refused, so the boundary is exactly where it says it is.
    const overCap = await failureOf(
      JSON.stringify({ ...env, iterations: MAX_KDF_ITERATIONS + 1, ct: 'AAAAAAAA' }),
      made.recoveryCode,
    )
    expect(overCap.detail).toMatch(/above the \d+ cap/)
  })

  it('caps the ciphertext length — the same denial of service, one field over', async () => {
    const { made, env } = await envelope()
    // Refused on the ENCODED length, before `atob` allocates anything.
    const huge = 'A'.repeat(MAX_CIPHERTEXT_BYTES * 4)
    const f = await failureOf(JSON.stringify({ ...env, ct: huge }), made.recoveryCode)
    expect(f.kind).toBe('not-an-envelope')
    expect(f.message).toBe(MALFORMED_BACKUP_FILE)
    expect(f.detail).toMatch(/base64 characters, above the \d+-byte cap/)
  })

  it('rejects a version that is a number but not a version', async () => {
    // NaN, 0, -1 and 1.5 are all `typeof 'number'`, and telling their owner the file was
    // "written by a newer version of this app, do not delete it" is a claim about a file that
    // never declared a version at all.
    const { env } = await envelope()
    for (const v of [0, -1, 1.5, NaN]) {
      const f = await failureOf(JSON.stringify({ ...env, v }), CODE)
      expect(f.kind, String(v)).toBe('not-an-envelope')
      expect(f.message, String(v)).toBe(MALFORMED_BACKUP_FILE)
    }
  })

  it('classifies an absent or empty code instead of leaking a raw WebCrypto error', async () => {
    // Not a wrong code — a caller that has not collected one. It used to reach `importKey`
    // and come back as an untyped exception from the one function whose job is classifying.
    const { made } = await envelope()
    for (const code of ['', '   ', '---', null, undefined, 42]) {
      const f = await failureOf(made.file, code as never)
      expect(f, String(code)).toBeInstanceOf(BackupRestoreError)
      expect(f.kind, String(code)).toBe('undecryptable')
      expect(f.message, String(code)).toBe(WRONG_RECOVERY_CODE)
      expect(f.detail, String(code)).toMatch(/no recovery code/)
    }
  })

  it('the undecryptable branch carries a debuggable detail', async () => {
    // The hardest branch to debug and the one that used to arrive with empty logs: GCM
    // authentication reports nothing about why, so "it says my code is wrong" was
    // indistinguishable from a tampered header or a code that never canonicalized.
    const { made } = await envelope()
    const f = await failureOf(made.file, 'ZZZZZZ-ZZZZZZ-ZZZZZZ-ZZZZZZ')
    expect(f.kind).toBe('undecryptable')
    expect(f.detail).toMatch(/AES-GCM authentication failed/)
    expect(f.detail).toMatch(/header bound/)
    expect(f.detail).toMatch(/27 characters/)        // 24 alphabet characters plus 3 dashes
    expect(f.detail).not.toMatch(/NOT a well-formed/) // this code WAS well formed, just wrong
    // And none of it reaches the user.
    expect(f.message).toBe(WRONG_RECOVERY_CODE)

    // A code whose shape never canonicalized says so — the case that is otherwise
    // indistinguishable from a wrong code in a bug report.
    const malformed = await failureOf(made.file, 'ABC')
    expect(malformed.detail).toMatch(/NOT a well-formed recovery code/)
  })

  it('reads the kdf field and refuses one it does not implement', async () => {
    // Feeding a file that names another KDF to PBKDF2 and then blaming the code is a false
    // accusation: the code was right and the derivation was never going to match.
    const { made, env } = await envelope()
    for (const kdf of ['scrypt', 'PBKDF2-SHA512', 'argon2id', 1]) {
      const f = await failureOf(JSON.stringify({ ...env, kdf }), made.recoveryCode)
      expect(f.kind, String(kdf)).toBe('unsupported-version')
      expect(f.message, String(kdf)).not.toBe(WRONG_RECOVERY_CODE)
      expect(f.detail, String(kdf)).toMatch(/kdf/)
    }
  })
})

// ── Paste tolerance reaches the CRYPTO, not just the confirm field (C1) ───────────────────
//
// The gap this closes: all the dash/case/invisible tolerance lived in the gate's
// paste-to-confirm, and `restoreBackup` fed the pasted string into PBKDF2 verbatim. So on the
// restore screen — a new device, months later, a code copied out of a password manager — a
// lowercase or em-dash paste derived a different key, the file did not open, and the product
// said "That file and recovery code do not open this key." about a code that was correct.
describe('restore accepts the code in the shapes a paste actually arrives in (C1)', () => {
  async function opensWith(paste: string): Promise<boolean> {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    const mangle = (code: string) => paste.replace('CODE', code)
    return (await restoreBackup(made.file, mangle(made.recoveryCode))) === privateKey
  }

  it('opens with a lowercase paste', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    expect(await restoreBackup(made.file, made.recoveryCode.toLowerCase())).toBe(privateKey)
  })

  it('opens with the dashes stripped, spaced, or newline-wrapped', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    for (const variant of [
      made.recoveryCode.replace(/-/g, ''),
      made.recoveryCode.replace(/-/g, ' '),
      made.recoveryCode.replace(/-/g, '\n'),
      `  ${made.recoveryCode}  `,
      `\t${made.recoveryCode}\n`,
    ]) {
      expect(await restoreBackup(made.file, variant), JSON.stringify(variant)).toBe(privateKey)
    }
  })

  it('opens with the em-dash an email client substituted', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    for (const dash of ['—', '–', '‐', '−', '－']) {
      expect(await restoreBackup(made.file, made.recoveryCode.replace(/-/g, dash)), dash)
        .toBe(privateKey)
    }
  })

  it('opens despite invisible characters dragged in by a styled copy', async () => {
    expect(await opensWith('﻿CODE​')).toBe(true)
  })

  it('opens with a fullwidth IME paste — NFKC folds the letters, not just the dash', async () => {
    // The fullwidth dash already folded through the dash family; the fullwidth LETTERS did
    // not, so a code typed on a CJK keyboard still failed before `.normalize('NFKC')`.
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    const fullwidth = made.recoveryCode.replace(/[0-9A-Z]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) + 0xfee0),
    )
    expect(fullwidth).not.toBe(made.recoveryCode)
    expect(await restoreBackup(made.file, fullwidth)).toBe(privateKey)
  })

  it('still refuses a genuinely wrong code — tolerance is not laxity', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    await expect(restoreBackup(made.file, 'zzzzzz zzzzzz zzzzzz zzzzzz'))
      .rejects.toThrow(WRONG_RECOVERY_CODE)
    // One character off, in a tolerated shape, is still wrong.
    const offByOne = made.recoveryCode.replace(/.$/, (c) => (c === 'Z' ? 'Y' : 'Z'))
    await expect(restoreBackup(made.file, offByOne.toLowerCase()))
      .rejects.toThrow(WRONG_RECOVERY_CODE)
  })

  it('canonicalization is idempotent and matches what the generator emits', () => {
    const code = generateRecoveryCode()
    expect(canonicalizeRecoveryCode(code)).toBe(code)
    expect(canonicalizeRecoveryCode(canonicalizeRecoveryCode(code))).toBe(code)
    expect(canonicalizeRecoveryCode(code.toLowerCase().replace(/-/g, ''))).toBe(code)
    expect(canonicalizeRecoveryCode(code)).toMatch(RECOVERY_CODE_PATTERN)
  })

  it('leaves a code that is not 24 characters ungrouped rather than inventing a shape', () => {
    // It was never going to open anything; grouping it would only disguise that.
    expect(canonicalizeRecoveryCode('ABC')).toBe('ABC')
    expect(canonicalizeRecoveryCode('')).toBe('')
    expect(canonicalizeRecoveryCode('a-b-c')).toBe('ABC')
  })

  it('the gate and the crypto share ONE canonicalization', async () => {
    // Not two copies that agree today. The gate re-exports identity's, so a change to the
    // tolerance cannot land on the confirm field and miss the restore screen.
    const gate = await import('../src/backup-gate.js')
    expect(gate.canonicalizeRecoveryCode).toBe(canonicalizeRecoveryCode)
    expect(gate.normalizeRecoveryCode).toBe(normalizeRecoveryCode)
  })
})

// ── Periodic verification against the live identity (AC5, B15) ────────────────────────────
describe('verifyBackupAgainstKey (AC5)', () => {
  it('passes only when the file opens AND holds this account’s key', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    expect(await verifyBackupAgainstKey(made.file, made.recoveryCode, privateKey)).toEqual({ ok: true })
  })

  it('FAILS a backup of a different identity, even with the right code', async () => {
    // The half a decrypt-success check cannot see, and the reason this function exists. After
    // a sweep to a new key the old Recovery File opens perfectly and protects nothing the
    // user now owns; marking that "verified" is the quiet version of having no backup.
    const old = generateIdentity().privateKey
    const current = generateIdentity().privateKey
    const made = await createBackup(old, TEST_HEADER)

    // Decryption alone would say this is fine.
    expect(await restoreBackup(made.file, made.recoveryCode)).toBe(old)
    // The composed check does not.
    const result = await verifyBackupAgainstKey(made.file, made.recoveryCode, current)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('different-key')
    expect(!result.ok && result.message).toBe(BACKUP_VERIFICATION_FAILED)
  })

  it('fails a wrong code, and reports it as the decryption failure it is', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    const result = await verifyBackupAgainstKey(made.file, 'ZZZZZZ-ZZZZZZ-ZZZZZZ-ZZZZZZ', privateKey)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('undecryptable')
    expect(!result.ok && result.message).toBe(BACKUP_VERIFICATION_FAILED)
  })

  it('carries the file-damage classification through rather than flattening it', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    const result = await verifyBackupAgainstKey('not json', made.recoveryCode, privateKey)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe('not-json')
  })

  it('compares keys numerically — casing and leading zeros are the same key', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    const padded = `0x${privateKey.replace(/^0x/, '').padStart(64, '0').toUpperCase()}`
    expect(BigInt(padded)).toBe(BigInt(privateKey))
    expect(await verifyBackupAgainstKey(made.file, made.recoveryCode, padded)).toEqual({ ok: true })
  })

  it('never throws, whatever it is handed', async () => {
    for (const args of [
      ['', '', ''],
      ['not json', 'ZZZZZZ-ZZZZZZ-ZZZZZZ-ZZZZZZ', 'not a key'],
      ['{}', '', '0x1'],
    ] as const) {
      const result = await verifyBackupAgainstKey(args[0], args[1], args[2])
      expect(result.ok).toBe(false)
    }
  })

  it('carries a PER-KIND message, not one catch-all (C16)', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    const env = JSON.parse(made.file)

    const cases: Array<[string, string, string]> = [
      // An intact file from a newer build must NOT be told "Make a new one now" — it opens
      // fine somewhere newer, and replacing it invites deleting the only copy of a key that
      // cannot be reissued.
      [JSON.stringify({ ...env, v: 3 }), 'unsupported-version', UNSUPPORTED_BACKUP_VERSION],
      ['not json', 'not-json', MALFORMED_BACKUP_FILE],
      ['null', 'not-an-envelope', MALFORMED_BACKUP_FILE],
    ]
    for (const [file, reason, message] of cases) {
      const result = await verifyBackupAgainstKey(file, made.recoveryCode, privateKey)
      expect(result.ok, reason).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.reason).toBe(reason)
      expect(result.message).toBe(message)
      expect(result.message).not.toBe(BACKUP_VERIFICATION_FAILED)
    }

    // Only the two that really mean "not a working backup of this account" keep that line.
    const wrongCode = await verifyBackupAgainstKey(made.file, 'ZZZZZZ-ZZZZZZ-ZZZZZZ-ZZZZZZ', privateKey)
    expect(!wrongCode.ok && wrongCode.message).toBe(BACKUP_VERIFICATION_FAILED)
    const otherKey = await verifyBackupAgainstKey(made.file, made.recoveryCode, generateIdentity().privateKey)
    expect(!otherKey.ok && otherKey.message).toBe(BACKUP_VERIFICATION_FAILED)
  })

  it('tolerates the same pasted shapes the restore screen does', async () => {
    const { privateKey } = generateIdentity()
    const made = await createBackup(privateKey, TEST_HEADER)
    expect(await verifyBackupAgainstKey(made.file, made.recoveryCode.toLowerCase(), privateKey))
      .toEqual({ ok: true })
  })
})

// ── One rule for what a Stark private key is (C4) ─────────────────────────────────────────
describe('isStarkPrivateKey — the shared key rule', () => {
  it('accepts a generated key and rejects the shapes that are not one', () => {
    expect(isStarkPrivateKey(generateIdentity().privateKey)).toBe(true)
    for (const bad of [
      '0x0',                                   // right shape, not a key
      '0x',
      'deadbeef',                              // no 0x
      '',
      'nope',
      null, undefined, 42, {},
      `0x${'f'.repeat(64)}`,                   // right shape, above the curve order
    ]) {
      expect(isStarkPrivateKey(bad), String(bad)).toBe(false)
    }
  })

  it('is the SAME rule registration.ts enforces — not a second copy', async () => {
    const { isRegisterableKey } = await import('../src/registration.js')
    for (const k of [generateIdentity().privateKey, '0x0', 'nope', `0x${'f'.repeat(64)}`]) {
      expect(isRegisterableKey(k), k).toBe(isStarkPrivateKey(k))
    }
  })

  it('is what createBackup and issueBackup both refuse on', async () => {
    const gate = await import('../src/backup-gate.js')
    const context = { ok: true as const, backupBlock: 1, auditorKeyAtBackupBlock: '0x1' }
    for (const bad of ['0x0', `0x${'f'.repeat(64)}`, 'deadbeef']) {
      await expect(createBackup(bad, TEST_HEADER), bad).rejects.toThrow(/refusing/)
      await expect(gate.issueBackup(bad, context), bad).rejects.toThrow(/refusing/)
    }
  })
})
