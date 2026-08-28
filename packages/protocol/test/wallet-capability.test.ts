import { describe, it, expect, vi } from 'vitest'
import {
  versionGte, assessByVersion, assessByProbe, resolveFundingCapability,
  MIN_WALLET_API, PUBLIC_FUNDING_NOTICE,
} from '../src/wallet-capability.js'

describe('versionGte', () => {
  it('compares dotted numeric versions', () => {
    expect(versionGte('0.10.3', '0.10.3')).toBe(true)
    expect(versionGte('0.10.4', '0.10.3')).toBe(true)
    expect(versionGte('0.11.0', '0.10.3')).toBe(true)
    expect(versionGte('0.10.2', '0.10.3')).toBe(false)
    expect(versionGte('0.9.9', '0.10.0')).toBe(false)
  })
})

describe('capability gate order (FR-017, story 1.15)', () => {
  it('supported by advertised version — no probe', () => {
    expect(assessByVersion('0.10.3')).toBe('supported')
    expect(assessByVersion('0.11.0-beta.4')).toBe('supported')
  })

  it('too-old advertised version is unsupported — still no probe', () => {
    expect(assessByVersion('0.10.2')).toBe('unsupported')
  })

  it('absent version requires the last-resort probe', () => {
    expect(assessByVersion(null)).toBe('probe-required')
    expect(assessByVersion('')).toBe('probe-required')
  })

  it('probe resolves implemented/not-implemented', () => {
    expect(assessByProbe('implemented')).toBe('supported')
    expect(assessByProbe('not-implemented')).toBe('unsupported')  // Braavos path
  })

  it('does NOT tax a capable wallet — probe never called when a version answers', async () => {
    const probe = vi.fn(async () => 'implemented' as const)
    expect(await resolveFundingCapability('0.10.3', probe)).toBe('supported')
    expect(probe).not.toHaveBeenCalled()
  })

  it('only probes as the last resort, and reflects the result', async () => {
    const probe = vi.fn(async () => 'not-implemented' as const)  // Braavos answers this
    expect(await resolveFundingCapability(null, probe)).toBe('unsupported')
    expect(probe).toHaveBeenCalledOnce()
  })

  it('MIN_WALLET_API is 0.10.3 and the public-funding notice exists', () => {
    expect(MIN_WALLET_API).toBe('0.10.3')
    expect(PUBLIC_FUNDING_NOTICE).toMatch(/funding transfer is public/i)
  })
})
