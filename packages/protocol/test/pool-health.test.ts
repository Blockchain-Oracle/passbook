import { describe, it, expect } from 'vitest'
import {
  classifyPause, classHashMatches, isEntrypointNotFound, screeningPolicyPresent, readPoolHealth,
} from '../src/pool.js'
import { NET } from '../src/constants.js'

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
})
