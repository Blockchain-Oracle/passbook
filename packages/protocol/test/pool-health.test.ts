import { describe, it, expect } from 'vitest'
import {
  classifyPause, classHashMatches, isEntrypointNotFound, screeningPolicyPresent, readPoolHealth,
  getAuditorPublicKey, readAuditorKeyAtBlock, auditorKeyFrom, getPublicKey,
} from '../src/pool.js'
import { NET } from '../src/constants.js'
import { preflightRegistration } from '../src/registration.js'
import { generateIdentity } from '../src/identity.js'
import { beginCeremony, makeCanRegister } from '../src/backup-gate.js'

// Pure classifiers — the paused/upgraded paths can't be forced on the live pool, so they are
// unit-tested deterministically (FR-052 / AD-9, story 1.3).
describe('degraded-mode classifiers', () => {
  it('pauses only on two consecutive positive reads', () => {
    expect(classifyPause(true, true)).toBe(true)
    expect(classifyPause(true, false)).toBe(false)   // transient flip — not paused
    expect(classifyPause(false, true)).toBe(false)
    expect(classifyPause(false, false)).toBe(false)
  })

  it('matches class hashes across leading-zero / casing differences', () => {
    expect(classHashMatches('0x67dddd89', '0x067dddd89')).toBe(true)
    expect(classHashMatches('0x0ABC', '0xabc')).toBe(true)
    expect(classHashMatches('0x1', '0x2')).toBe(false)
  })

  it('turns an auditor-key response into a number, or refuses it', () => {
    // Shared by both readers, so neither can drift from the other's assumptions about the
    // response shape. The empty array is the one that used to be a TypeError from inside what
    // the caller experiences as a chain read — a proxy rewriting an error into a 200, or a
    // node mid-resync, answering `{result: []}`.
    expect(auditorKeyFrom(['0x1eed60b8'])).toBe(0x1eed60b8n)
    expect(auditorKeyFrom(['0x1eed60b8'], 13_779_000)).toBe(0x1eed60b8n)
    expect(() => auditorKeyFrom([])).toThrow(/no value/)
    expect(() => auditorKeyFrom(undefined as never)).toThrow(/no value/)
    // A zero is a read that did not land, at the head and at a pinned block alike.
    expect(() => auditorKeyFrom(['0x0'])).toThrow(/auditor key of 0 at the current head/)
    expect(() => auditorKeyFrom(['0x0'], 13_779_000)).toThrow(/auditor key of 0 at block 13779000/)
  })

  it('classifies a non-numeric response instead of leaking a raw SyntaxError', () => {
    // The realistic source is not a malformed felt: it is a proxy or captive portal rewriting
    // an RPC error into a 200 with an HTML body. `BigInt` throws a bare SyntaxError on that,
    // out of the exact function whose comment promises to classify the response.
    for (const junk of ['<!DOCTYPE html>', 'null', 'not a felt', '0xZZ']) {
      expect(() => auditorKeyFrom([junk]), junk).toThrow(/non-numeric auditor key/)
      expect(() => auditorKeyFrom([junk]), junk).not.toThrow(SyntaxError)
    }
    // The offending value is quoted back so a log says what actually arrived...
    expect(() => auditorKeyFrom(['<!DOCTYPE html>'])).toThrow(/DOCTYPE/)
    // ...but bounded, so a megabyte of HTML does not become the error message.
    try {
      auditorKeyFrom(['x'.repeat(5_000)])
      throw new Error('expected a throw')
    } catch (e) {
      expect((e as Error).message.length).toBeLessThan(200)
    }
    // The empty string is NOT in the list above, and that is not an oversight: `BigInt('')`
    // is `0n`, not a throw, so it lands on the zero guard — which is the right answer for it.
    expect(() => auditorKeyFrom([''])).toThrow(/auditor key of 0/)
  })

  it('recognizes entrypoint-not-found errors distinctly from real failures', () => {
    expect(isEntrypointNotFound(new Error('Entry point EntryPointSelector(0x...) not found'))).toBe(true)
    expect(isEntrypointNotFound(new Error('-32601 method not found'))).toBe(true)
    expect(isEntrypointNotFound(new Error('all RPC hosts failed: ECONNREFUSED'))).toBe(false)
    expect(isEntrypointNotFound(new Error('fetch timed out'))).toBe(false)
  })
})

// Live mainnet canary — cheap and deterministic against today's deployed class (story 1.3).
describe('live pool health (mainnet)', { timeout: 30_000 }, () => {
  it('screening rewrite is NOT yet present on the deployed class', async () => {
    // The block-list model is live; get_open_note_screening_policy must not exist yet.
    expect(await screeningPolicyPresent()).toBe(false)
  })

  it('reads healthy: class hash matches the pinned tag, state ok, live fee > 0', async () => {
    const h = await readPoolHealth()
    // The pool is not paused/upgraded today, so a reachable read is 'ok'.
    // (If the network blips this can be 'unreachable' — acceptable; never 'paused'/'upgraded' spuriously.)
    expect(['ok', 'unreachable']).toContain(h.state)
    if (h.state === 'ok') {
      expect(h.feeWei).toBeGreaterThan(0n)
      expect(h.proofValidityBlocks).toBeGreaterThan(0)
      expect(h.blockNumber).toBeGreaterThan(13_000_000)
    }
  })

  // The auditor key a Recovery File header records (story 1.8 AC4). Sited here with the other
  // live reads rather than beside the crypto, because it is a chain read and nothing else.
  //
  // NO EXPECTED VALUE IS ASSERTED. The key is read live precisely because StarkWare can set a
  // new one (`set_auditor_public_key` is on the same class), and a test pinning today's value
  // would fail on the rotation it exists to tolerate — while also planting exactly the
  // hardcoded key the header rules forbid. What is asserted is the shape and the invariant:
  // a non-zero felt, and the same answer from both readers.
  it('reads the live auditor key: a non-zero felt, pinned to the block it was read at', async () => {
    const { blockNumber, auditorKey } = await readAuditorKeyAtBlock()
    expect(auditorKey).toBeGreaterThan(0n)
    expect(auditorKey).toBeLessThan(2n ** 252n)          // a felt252
    expect(blockNumber).toBeGreaterThan(13_000_000)

    // The head reader agrees with the pinned one. They can legitimately differ across a
    // rotation, which has never been observed — if this ever fails, that is the news.
    expect(await getAuditorPublicKey()).toBe(auditorKey)
  })

  // AC1's live half. The offline, structural half — that nothing CAN consult backup state —
  // is `backup-gates-registration-only.test.ts`, which is deliberately network-free so its
  // red result always means the rule was broken. This one costs a real read, so it lives here
  // with the other live tests rather than making that suite depend on an RPC.
  it('real chain reads still answer while the backup ceremony has not started', async () => {
    expect(makeCanRegister(beginCeremony())()).toBe(false)

    const key = await getPublicKey('0x0000000000000000000000000000000000000000000000000000000000000001')
    expect(typeof key).toBe('bigint')

    const route = await preflightRegistration(
      generateIdentity().privateKey,
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    )
    // Any route but a refusal-because-of-backup, which is not one of the four it can return.
    expect(['unregistered', 'already-registered', 'collision', 'blocked-rpc-unknown'])
      .toContain(route.route)
  })
})
