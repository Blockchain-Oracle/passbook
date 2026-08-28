import { describe, expect, it } from 'vitest'

import {
  buildPayLink,
  parsePayLinkSearch,
  parseRecipientReference,
  resolveRecipientReference,
} from '../src/pay-link.js'

const ADDRESS = '0x1234'
const ENTRIES = [{ name: 'sam-wise', address: ADDRESS, hasAvatar: false }] as const

describe('payment request links', () => {
  it('keeps old address-only links valid', () => {
    expect(parsePayLinkSearch({})).toEqual({ ok: true, value: {} })
    expect(buildPayLink(ADDRESS)).toBe('/pay/0x1234')
  })

  it('round-trips the supported request fields', () => {
    const link = buildPayLink('@sam-wise', { asset: 'USDC', amount: '12.50', note: 'Dinner' })
    expect(link).toBe('/pay/%40sam-wise?asset=USDC&amount=12.50&note=Dinner')
    expect(parsePayLinkSearch({ asset: 'usdc', amount: '12.50', note: ' Dinner ' })).toEqual({
      ok: true,
      value: { asset: 'USDC', amount: '12.50', note: 'Dinner' },
    })
  })

  it('refuses unknown assets and ambiguous amounts instead of dropping them', () => {
    expect(parsePayLinkSearch({ asset: 'ETH' })).toMatchObject({ ok: false })
    for (const amount of ['0', '00.1', '-1', '1e3', '1,000', '.5']) {
      expect(parsePayLinkSearch({ amount })).toMatchObject({ ok: false })
    }
  })

  it('accepts addresses and explicit names, including hyphens', () => {
    expect(parseRecipientReference(ADDRESS)).toMatchObject({ ok: true, value: { kind: 'address' } })
    expect(parseRecipientReference('@SAM-WISE')).toEqual({
      ok: true,
      value: { kind: 'name', name: 'sam-wise', display: '@sam-wise' },
    })
    expect(parseRecipientReference('sam-wise')).toMatchObject({ ok: false })
  })

  it('resolves names locally and refuses names that are not present', () => {
    expect(resolveRecipientReference('@sam-wise', ENTRIES)).toEqual({
      ok: true,
      address: ADDRESS,
      name: 'sam-wise',
    })
    expect(resolveRecipientReference('@nobody', ENTRIES)).toMatchObject({
      ok: false,
      kind: 'unresolved-name',
    })
  })
})
