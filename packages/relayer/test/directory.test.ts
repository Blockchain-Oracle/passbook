import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ec } from 'starknet'

import { openDirectory, DIRECTORY_CAP } from '../src/directory.js'
import { signClaim, verifyClaim, claimMessageHash } from '../../protocol/src/directory.js'

//
// A REAL keypair, because the directory's whole value is the signature check. A mocked verifier
// would test that we called our own mock.
//
const VIEWING_KEY = 0x1234567890abcdef1234567890abcdef1234567890abcdefn
const PUBLIC_X = BigInt(ec.starkCurve.getStarkKey(`0x${VIEWING_KEY.toString(16)}`))
const ADDRESS = '0x' + 'a1'.repeat(31)
const OTHER_ADDRESS = '0x' + 'b2'.repeat(31)
const OTHER_KEY = 0xfeedfacefeedfacefeedfacefeedfacen
const OTHER_PUBLIC_X = BigInt(ec.starkCurve.getStarkKey(`0x${OTHER_KEY.toString(16)}`))

const KEYS: Record<string, bigint> = { [ADDRESS]: PUBLIC_X, [OTHER_ADDRESS]: OTHER_PUBLIC_X }

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function fresh(cap?: number) {
  const file = join(mkdtempSync(join(tmpdir(), 'passbook-dir-')), 'directory.json')
  const readPublicKey = vi.fn(async (address: string) => KEYS[address] ?? 0n)
  return { file, readPublicKey, directory: openDirectory({ file, readPublicKey, cap }) }
}

function claimBody(name: string, address = ADDRESS, key = VIEWING_KEY, avatar?: string) {
  return { name, address, signature: signClaim(name, address, key), avatar }
}

describe('the claim signature', () => {
  it('round-trips: sign with the viewing key, verify against the x the pool stores', () => {
    const sig = signClaim('sam', ADDRESS, VIEWING_KEY)
    expect(verifyClaim('sam', ADDRESS, sig, PUBLIC_X)).toBe(true)
  })

  it('binds BOTH the name and the address — neither can be swapped under the same signature', () => {
    const sig = signClaim('sam', ADDRESS, VIEWING_KEY)
    expect(verifyClaim('mallory', ADDRESS, sig, PUBLIC_X)).toBe(false)
    expect(verifyClaim('sam', OTHER_ADDRESS, sig, PUBLIC_X)).toBe(false)
  })

  it('a different key does not verify', () => {
    const sig = signClaim('sam', ADDRESS, OTHER_KEY)
    expect(verifyClaim('sam', ADDRESS, sig, PUBLIC_X)).toBe(false)
  })

  it('the message hash is deterministic — both sides compute the same bytes', () => {
    expect(claimMessageHash('sam', ADDRESS)).toBe(claimMessageHash('sam', ADDRESS))
    expect(claimMessageHash('sam', ADDRESS)).not.toBe(claimMessageHash('pam', ADDRESS))
  })
})

describe('the directory', () => {
  it('a valid claim lands and lists, lean', async () => {
    const { directory } = fresh()
    expect(await directory.claim(claimBody('sam'))).toEqual({ ok: true })
    expect(directory.list()).toEqual([{ name: 'sam', address: ADDRESS, hasAvatar: false }])
  })

  it('names are normalized before everything — SAM and sam are one name', async () => {
    const { directory } = fresh()
    // The signature must cover the NORMALIZED name; a client signs what the server checks.
    expect(await directory.claim({ name: '  SAM ', address: ADDRESS, signature: signClaim('sam', ADDRESS, VIEWING_KEY) })).toEqual({ ok: true })
    expect(directory.list()[0]!.name).toBe('sam')
  })

  it('accepts hyphens as well as underscores in a directory name', async () => {
    const { directory } = fresh()
    expect(await directory.claim(claimBody('sam-wise'))).toEqual({ ok: true })
    expect(directory.list()[0]!.name).toBe('sam-wise')
  })

  it('refuses a malformed name, address, signature, and avatar — each with its own sentence', async () => {
    const { directory } = fresh()
    expect(await directory.claim({ ...claimBody('sam'), name: 'x' })).toMatchObject({ status: 400 })
    expect(await directory.claim({ ...claimBody('sam'), name: 'Da sh' })).toMatchObject({ status: 400 })
    expect(await directory.claim({ ...claimBody('sam'), address: 'not-hex' })).toMatchObject({ status: 400 })
    expect(await directory.claim({ ...claimBody('sam'), signature: { r: 'zz', s: '0x1' } })).toMatchObject({ status: 400 })
    expect(await directory.claim(claimBody('sam', ADDRESS, VIEWING_KEY, 'data:text/html;base64,PGI+'))).toMatchObject({ status: 400 })
  })

  it('refuses an unregistered address (403) and a chain outage differently (502)', async () => {
    const { directory } = fresh()
    const unregistered = '0x' + 'c3'.repeat(31)
    expect(await directory.claim(claimBody('sam', unregistered, VIEWING_KEY))).toMatchObject({
      status: 403,
      error: expect.stringContaining('not registered'),
    })
    const outage = openDirectory({
      file: join(mkdtempSync(join(tmpdir(), 'passbook-dir-')), 'd.json'),
      readPublicKey: async () => {
        throw new Error('rpc down')
      },
    })
    expect(await outage.claim(claimBody('sam'))).toMatchObject({ status: 502 })
  })

  it('refuses a forged signature', async () => {
    const { directory } = fresh()
    expect(await directory.claim(claimBody('sam', ADDRESS, OTHER_KEY))).toMatchObject({ status: 403 })
  })

  it('first come, first served — and a re-claim by the SAME address renames, freeing the old name', async () => {
    const { directory } = fresh()
    await directory.claim(claimBody('sam'))
    expect(await directory.claim(claimBody('sam', OTHER_ADDRESS, OTHER_KEY))).toMatchObject({ status: 409 })
    expect(await directory.claim(claimBody('samuel'))).toEqual({ ok: true })
    // 'sam' is free again; one record per address.
    expect(await directory.claim(claimBody('sam', OTHER_ADDRESS, OTHER_KEY))).toEqual({ ok: true })
    expect(directory.list().map((e) => e.name).sort()).toEqual(['sam', 'samuel'])
  })

  it('carries an avatar, keeps it across a rename, serves it by address only', async () => {
    const { directory } = fresh()
    await directory.claim(claimBody('sam', ADDRESS, VIEWING_KEY, PIXEL))
    expect(directory.list()[0]!.hasAvatar).toBe(true)
    expect(directory.avatar(ADDRESS)).toBe(PIXEL)
    await directory.claim(claimBody('samuel')) // rename without re-sending the image
    expect(directory.avatar(ADDRESS)).toBe(PIXEL)
    expect(directory.avatar(OTHER_ADDRESS)).toBe(null)
    expect(directory.avatar('garbage')).toBe(null)
  })

  it('fills loudly at the cap — new addresses refused, existing ones still update', async () => {
    const { directory } = fresh(1)
    await directory.claim(claimBody('sam'))
    expect(await directory.claim(claimBody('pam', OTHER_ADDRESS, OTHER_KEY))).toMatchObject({ status: 503 })
    expect(await directory.claim(claimBody('samuel'))).toEqual({ ok: true })
  })

  it('survives a restart byte-for-byte', async () => {
    const { file, readPublicKey, directory } = fresh()
    await directory.claim(claimBody('sam', ADDRESS, VIEWING_KEY, PIXEL))
    const reopened = openDirectory({ file, readPublicKey })
    expect(reopened.list()).toEqual([{ name: 'sam', address: ADDRESS, hasAvatar: true }])
    expect(reopened.avatar(ADDRESS)).toBe(PIXEL)
  })

  it('a corrupt ledger is a hard startup failure, never a silent reset', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'passbook-dir-')), 'directory.json')
    writeFileSync(file, '{ not json')
    expect(() => openDirectory({ file, readPublicKey: async () => 0n })).toThrow()
    writeFileSync(file, JSON.stringify({ v: 99 }))
    expect(() => openDirectory({ file, readPublicKey: async () => 0n })).toThrow(/refusing to start/)
  })

  it('two same-name claims across the async gap cannot both win', async () => {
    // The key read yields; the availability check must run after it. Stall both reads on one
    // gate, release together, and exactly one claim may land.
    let release: () => void
    const gate = new Promise<void>((r) => (release = r))
    const file = join(mkdtempSync(join(tmpdir(), 'passbook-dir-')), 'd.json')
    const directory = openDirectory({
      file,
      readPublicKey: async (address: string) => {
        await gate
        return KEYS[address] ?? 0n
      },
    })
    const race = Promise.all([
      directory.claim(claimBody('sam')),
      directory.claim(claimBody('sam', OTHER_ADDRESS, OTHER_KEY)),
    ])
    release!()
    const outcomes = await race
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1)
    expect(JSON.parse(readFileSync(file, 'utf8')).records).toHaveLength(1)
  })

  it('exports the production cap it promises', () => {
    expect(DIRECTORY_CAP).toBe(5_000)
  })
})
