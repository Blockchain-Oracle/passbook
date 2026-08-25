import { describe, it, expect } from 'vitest'
import type { RpcProvider } from 'starknet'
import { ContractDiscoveryProvider } from '@starkware-libs/starknet-privacy-sdk/testing'
import { withFallback } from '../src/rpc.js'
import { discoverWallet, poolContractFor } from '../src/discovery.js'
import { balancesFrom } from '../src/balances.js'
import { generateIdentity } from '../src/identity.js'
import { packedNoteValue, poolEventSelector, readPoolEvents, decodePoolEvent } from '../src/pool-events.js'

//
// THE PROBE GATE (story 1.9). Everything else in this story is built on one claim: that the
// SDK's indexer-free `ContractDiscoveryProvider` reaches the live mainnet pool, walks it with
// nothing but view calls, and decodes what it finds correctly. This file is where that claim
// is checked against the deployed contract rather than against its documentation.
//
// Sited here with the other live reads, following `pool-health.test.ts`: these cost real RPC
// round trips, so they do not belong in the offline suites whose red result must always mean a
// rule was broken. Every call below is free — views only, nothing signed, nothing submitted.
//
// ── WHAT THIS PROBE CAN AND CANNOT REACH, STATED RATHER THAN GLOSSED ──────────────────────
//
// The probe as specified wanted a walk over "the dev identity's real notes". THERE IS NO SUCH
// IDENTITY, and that is a fact about the repository rather than a gap in the walk: the one
// registration banked on mainnet (`evidence/sponsored-registration.json`) was made by a
// throwaway key that was deliberately burned, that address holds zero incoming channels, and
// no send has ever been banked. Manufacturing a note means paying a pool fee plus gas on
// mainnet, which is a spend nobody authorised for a test.
//
// So the positive half is proven in the two places it can be, and the seam between them is
// named rather than papered over:
//
//   1. VALUE DECODE, live, against real mainnet notes. Open notes carry a plaintext amount in
//      pool storage, and `OpenNoteDeposited` publishes what was put into them — so the amount
//      this code reads out of `get_note` is checkable against an independent public record for
//      real notes belonging to real strangers. That is the `packedNoteValue` decode and the
//      open-note discriminator, verified on live data.
//   2. CHANNEL AND NOTE DECRYPTION, against the SDK's own `MockPoolContract` with real SDK
//      crypto, in `discovery-roundtrip.test.ts`. Same provider, same hashes, same walk; only
//      the transport differs, and the transport is what (1) and the walks below exercise.
//
// What remains unproven anywhere is decrypting a real ENCRYPTED mainnet note, which needs a
// viewing key belonging to somebody. That is recorded as the residual risk it is, and it is
// NOT a reason to fall back to a hosted indexer: `NET.discovery` stays unused.
//

const MAINNET = { timeout: 120_000 }

/** An address nobody has registered. Used as the empty-walk control throughout. */
const UNREGISTERED = '0x0000000000000000000000000000000000000000000000000000000000000001'

/**
 * Accepts an `unreachable` result ONLY when it was the network, and fails on anything else.
 *
 * Live tests have to tolerate a blip or they go red on a bad afternoon. The trap is that
 * `discoverWallet` classifies EVERY throw as `unreachable`, so a genuine defect — a bad cast,
 * a proxy invariant, an SDK signature change — arrives wearing the same clothes as a dropped
 * connection, and a bare `if (unreachable) return` turns the whole suite into a no-op that
 * reports green. That is not hypothetical: it is exactly what hid the rate-limiter proxy
 * failure that `poolContractFor` now documents.
 *
 * So the reason string is classified. A `TypeError`, a `ReferenceError`, a proxy invariant or
 * an "is not a function" is a bug in this repository and fails the test; a timeout, a refused
 * connection or an exhausted host list is the network and skips the assertions below it.
 */
function isNetworkFailure(reason: string): boolean {
  return !DEFECT_SIGNATURES.some((signature) => signature.test(reason))
}

/**
 * Failure text that means "this build is broken", not "the network wobbled".
 *
 * Every JS error class that a wrong cast, a moved SDK signature or a bad conversion produces.
 * `RangeError` and `SyntaxError` are on the list because `BigInt` throws them — `BigInt(1.5)`
 * and `BigInt('nope')` respectively — and those are exactly the failures the felt guards in
 * `discovery.ts` and `pool-events.ts` exist to classify. Leaving them off would let the bug
 * class this helper was written for go on hiding behind a tolerated `unreachable`.
 */
const DEFECT_SIGNATURES = [
  /TypeError/i,
  /ReferenceError/i,
  /RangeError/i,
  /SyntaxError/i,
  /is not a function/i,
  /is not iterable/i,
  /proxy/i,
  /undefined is not/i,
  /cannot read/i,
  /cannot convert/i,
  /not a felt/i,
  /the SDK returned/i,
]

/**
 * Runs a live read against the pool THROUGH `withFallback`, exactly as production does.
 *
 * Not a convenience. Pinning `NET.rpc[0]` in a test is a quiet decision to exercise a different
 * code path from the one that ships: `discoverWallet` and `readPoolEvents` both retry the whole
 * attempt on the second host, and a test that skips that is both less faithful and reliably
 * flaky — a single `fetch failed` from one public host turns the suite red for a reason that
 * has nothing to do with the code. Reproduced on the third consecutive run before this existed.
 *
 * The callback may return a bare value or a promise, because `PoolContractInterface` widens
 * every return to `T | Promise<T>` so that a synchronous mock can satisfy it.
 */
function onPool<T>(
  fn: (pool: ReturnType<typeof poolContractFor>, provider: RpcProvider) => T | Promise<T>,
): Promise<T> {
  return withFallback(async (provider) => fn(poolContractFor(provider), provider))
}

describe('the indexer-free discovery walk reaches mainnet (probe gate)', MAINNET, () => {
  it('constructs over a plain RPC provider — no indexer, no hosted service', async () => {
    const key = await onPool(async (pool) => {
      // The SDK's provider takes our pool interface directly. Nothing in this construction
      // names a discovery host, which is the property the whole story rests on.
      const discovery = new ContractDiscoveryProvider(pool)
      expect(discovery).toBeInstanceOf(ContractDiscoveryProvider)
      // And the pool answers a real view through it.
      return pool.get_public_key(UNREGISTERED)
    })
    expect(BigInt(key)).toBe(0n)
  })

  it('walks an unregistered address to a COMPLETED empty book, never an error', async () => {
    // A fresh key, so this is a real derivation rather than a constant, and an address the
    // pool has never seen. The walk has to finish and say "absent" — the one state only a
    // completed walk may report.
    const { privateKey } = generateIdentity()
    const started = Date.now()
    const result = await discoverWallet(UNREGISTERED, privateKey)
    const elapsedMs = Date.now() - started

    if (result.state === 'unreachable') {
      // A network blip is acceptable and must classify as unknown — never as an empty book.
      expect(isNetworkFailure(result.reason), result.reason).toBe(true)
      expect(result.presence).toBe('unknown')
      return
    }

    expect(result.state).toBe('walked')
    expect(result.notes).toHaveLength(0)
    expect(result.presence).toBe('absent')
    expect(result.registered).toBe(false)
    expect(result.blockNumber).toBeGreaterThan(13_000_000)
    expect(result.registry.incoming).toHaveLength(0)
    expect(result.registry.outgoingTotal).toBe(0)

    // The balance model must distinguish "never registered" from "registered and empty".
    const balance = balancesFrom(result)
    expect(balance.book).toBe('not-registered')
    expect(balance.tokens).toHaveLength(0)
    expect(balance.blockNumber).toBe(result.blockNumber)

    // Banked as a measurement, not asserted as a bound: an empty walk is a couple of view
    // calls and finishes in well under a second, and a regression that made it slow would be
    // a regression in the walk rather than in the network.
    expect(elapsedMs).toBeLessThan(60_000)
  })

  it('the banked registration is registered, and holds nothing — both facts, separately', async () => {
    // `evidence/sponsored-registration.json`. Its key was burned on purpose, so this asserts
    // exactly what can be asserted without one: the pool holds a viewing key for it.
    const banked = '0x2bf7264ae68256b1bd46ddce77efb16589780ae05fdb976c7e56ff20f563533'
    const { publicKey, channels } = await onPool(async (pool) => ({
      publicKey: BigInt(await pool.get_public_key(banked)),
      channels: Number(await pool.get_num_of_channels(banked)),
    }))

    expect(publicKey).toBeGreaterThan(0n)
    // Nobody has ever opened a channel to it, which is why it cannot be the note-bearing
    // identity the probe wanted. Recorded so the reason survives.
    expect(channels).toBe(0)
  })
})

describe('real mainnet notes decode correctly (the positive half that is reachable)', MAINNET, () => {
  it('open notes read back the exact amount and token they were funded with', async () => {
    const head = await withFallback((p) => p.getBlockNumber())

    // Real open notes belonging to real strangers. `OpenNoteDeposited` publishes the depositor,
    // the token and the amount, so the sum of a note's deposits is an INDEPENDENT public record
    // of what should be sitting in its packed value.
    const page = await readPoolEvents({
      fromBlock: 13_000_000,
      toBlock: head,
      names: ['OpenNoteDeposited'],
      maxPages: 2,
    })
    expect(page.events.length).toBeGreaterThan(0)

    const depositedByNote = new Map<string, { token: bigint; total: bigint }>()
    for (const raw of page.events) {
      const decoded = decodePoolEvent(raw)
      if (decoded?.kind !== 'open-note-deposited') continue
      const key = decoded.noteId.toString()
      const prior = depositedByNote.get(key) ?? { token: decoded.token, total: 0n }
      prior.total += decoded.amount
      depositedByNote.set(key, prior)
    }
    expect(depositedByNote.size).toBeGreaterThan(0)

    let checked = 0
    let matched = 0
    for (const [noteId, funded] of depositedByNote) {
      if (checked >= 8) break
      checked += 1
      const onchain = await onPool((pool) => pool.get_note(`0x${BigInt(noteId).toString(16)}`))
      const decoded = packedNoteValue(BigInt(onchain.packed_value))

      // A note that has since been spent reads back zero, which the decoder reports as absent
      // rather than as an amount of zero. That is a pass for the decoder and simply not a
      // sample for this assertion.
      if (decoded.absent) continue

      expect(decoded.open, `note ${noteId} should be an open note`).toBe(true)
      expect(decoded.salt).toBe(1n)
      expect(decoded.amount, `note ${noteId} amount`).toBe(funded.total)
      expect(BigInt(onchain.token), `note ${noteId} token`).toBe(funded.token)
      matched += 1
    }

    // At least one live note must have been checked, or this test passed by finding nothing.
    expect(matched).toBeGreaterThan(0)
  })

  it('an encrypted note never yields a plaintext amount — null, never a fabricated zero', async () => {
    const head = await withFallback((p) => p.getBlockNumber())
    const page = await readPoolEvents({
      fromBlock: 13_000_000,
      toBlock: head,
      names: ['EncNoteCreated'],
      maxPages: 1,
    })
    expect(page.events.length).toBeGreaterThan(0)

    let encrypted = 0
    for (const raw of page.events) {
      const decoded = decodePoolEvent(raw)
      if (decoded?.kind !== 'note-created') continue
      const packed = packedNoteValue(decoded.packedValue)
      if (packed.open) continue
      encrypted += 1
      // The whole "never a fabricated 0" rule, on live ciphertext: an encrypted note's amount
      // is not readable without its channel key, and the model says so rather than guessing.
      expect(packed.amount).toBeNull()
      expect(packed.salt).toBeGreaterThan(1n)
    }
    expect(encrypted).toBeGreaterThan(0)
  })
})

describe('the walk refuses to hand a real account to a key that is not its own', MAINNET, () => {
  it('a stranger\'s address plus our key completes, and finds nothing', async () => {
    const head = await withFallback((p) => p.getBlockNumber())

    // Find a genuinely registered mainnet account that has real incoming channels, so the walk
    // below reaches real channel ciphertext rather than an empty slot. Discovered at run time
    // rather than pinned: an address hardcoded here would rot the first time that account
    // changed, and the property under test is about any real account, not one particular one.
    const registrations = await readPoolEvents({
      fromBlock: 13_000_000,
      toBlock: head,
      names: ['ViewingKeySet'],
      maxPages: 1,
    })
    let busy: string | undefined
    let channelCount = 0
    for (const raw of registrations.events) {
      const decoded = decodePoolEvent(raw)
      if (decoded?.kind !== 'registration') continue
      const address = `0x${decoded.user.toString(16)}`
      const count = Number(await onPool((pool) => pool.get_num_of_channels(address)))
      if (count > 0) {
        busy = address
        channelCount = count
        break
      }
    }
    expect(busy, 'expected at least one registered mainnet account with an incoming channel').toBeDefined()
    expect(channelCount).toBeGreaterThan(0)

    // Their channel storage really is populated — so the walk below is decrypting something.
    const info = await onPool((pool) => pool.get_channel_info(busy!, 0))
    expect(BigInt(info.enc_channel_key)).not.toBe(0n)

    // Now walk their address with a key that is ours. The channel decrypts to garbage, the
    // derived subchannel id addresses a slot that does not exist, and the scan terminates —
    // so a wrong key produces an empty book rather than somebody else's money or a hang.
    const { privateKey } = generateIdentity()
    const result = await discoverWallet(busy!, privateKey)
    if (result.state === 'unreachable') {
      expect(isNetworkFailure(result.reason), result.reason).toBe(true)
      expect(result.presence).toBe('unknown')
      return
    }
    expect(result.notes).toHaveLength(0)
    expect(result.presence).toBe('absent')
    // Registered, and holding nothing WE can see — the two facts stay separate.
    expect(result.registered).toBe(true)
    expect(balancesFrom(result).book).toBe('no-activity')
  })
})

describe('the bounded event read is bounded on real data (AD-14)', MAINNET, () => {
  it('paginates a real range under its cap and reports whether it finished', async () => {
    const head = await withFallback((p) => p.getBlockNumber())

    const page = await readPoolEvents({ fromBlock: head - 50_000, toBlock: head, maxPages: 3 })
    expect(page.fromBlock).toBe(head - 50_000)
    expect(page.toBlock).toBe(head)
    expect(page.pagesRead).toBeGreaterThan(0)
    expect(page.pagesRead).toBeLessThanOrEqual(3)
    // Either it exhausted the range, or it stopped at the cap AND said so with a resume token.
    expect(page.complete === (page.continuation === null)).toBe(true)

    for (const event of page.events) {
      expect(event.blockNumber).toBeGreaterThanOrEqual(page.fromBlock)
      expect(event.blockNumber).toBeLessThanOrEqual(page.toBlock)
      // Every event came back under one of the seven selectors we asked for.
      expect(decodePoolEvent(event)).not.toBeNull()
    }
  })

  it('every event this pool emits in a live range decodes to a known selector', async () => {
    const head = await withFallback((p) => p.getBlockNumber())
    const page = await readPoolEvents({ fromBlock: 13_000_000, toBlock: head, maxPages: 2 })

    const seen = new Set<string>()
    for (const event of page.events) {
      const decoded = decodePoolEvent(event)
      expect(decoded).not.toBeNull()
      seen.add(decoded!.kind)
      // The selector we filtered on is the selector the decoder dispatched on.
      expect(event.keys[0]).toBeDefined()
    }
    // A live range over this pool carries more than one kind of row. If this ever collapses to
    // one, the filter has silently stopped matching rather than the pool having gone quiet.
    expect(seen.size).toBeGreaterThan(1)
    expect(poolEventSelector('Deposit')).toMatch(/^0x[0-9a-f]+$/)
  })
})

describe('the blip-tolerance helper itself', () => {
  // A helper that could only return true or throw was a tautology: `expect(...).toBe(true)`
  // asserted nothing, and its narrow regex missed the BigInt error classes that the felt
  // guards throw — re-silencing the exact bug class it was written to catch. Both branches
  // are tested directly here, because this is the thing standing between a broken build and
  // a green live suite.
  it('accepts genuine network failures', () => {
    for (const reason of [
      'all RPC hosts failed: fetch failed',
      'all RPC hosts failed: ECONNREFUSED',
      'The operation was aborted due to timeout',
      'RpcError: 429 Too Many Requests',
      'socket hang up',
    ]) {
      expect(isNetworkFailure(reason), reason).toBe(true)
    }
  })

  it('rejects every defect signature, including the BigInt error classes', () => {
    for (const reason of [
      "TypeError: 'get' on proxy: property 'get_outgoing_channel_info' is a data property",
      'ReferenceError: poolContractFor is not defined',
      'RangeError: The number 1.5 cannot be converted to a BigInt because it is not an integer',
      'SyntaxError: Cannot convert nope to a BigInt',
      'pool.get_note is not a function',
      'Cannot read properties of undefined',
      'not a felt: "<!DOCTYPE html>"',
      'the SDK returned a string for note id, which is not a felt',
    ]) {
      expect(isNetworkFailure(reason), reason).toBe(false)
    }
  })
})
