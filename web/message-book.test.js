//
// The browser port of the MessageBook rules must not drift from the module the rules
// were actually established in. This file imports BOTH and runs them against the same
// inputs, so a change made to one and not the other fails here rather than on-chain.
//
// It also covers `checkInvokeCalldata`, which has no counterpart in the TypeScript
// module: that one is the browser's last gate before the wallet is asked to spend, and
// each of its rules corresponds to a revert that the pool's own `compile_actions` was
// verified NOT to catch.
//
import { describe, expect, it } from 'vitest'

import * as ts from '../packages/protocol/src/message-book.ts'
import {
  FELT_PRIME,
  MODE_APPEND,
  MODE_SEAL,
  buildInvokeCalldata,
  checkInvokeCalldata,
  packUtf8ToFelts,
  predictMessageBookRevert,
  toFelt,
} from './message-book.js'

// Spread across the interesting shapes: empty, one felt, exactly 31 bytes (one full
// chunk), 32 bytes (a chunk boundary), multibyte UTF-8, and a long body.
const TEXTS = [
  '',
  'a',
  'strk20 messagebook: gate transaction 1 of 3',
  'x'.repeat(31),
  'x'.repeat(32),
  'x'.repeat(93),
  'seal — éèê and 中文',
]

describe('the browser port agrees with packages/protocol/src/message-book.ts', () => {
  it('exports the same mode constants and field prime', () => {
    expect(MODE_APPEND).toBe(ts.MODE_APPEND)
    expect(MODE_SEAL).toBe(ts.MODE_SEAL)
    expect(FELT_PRIME).toBe(ts.FELT_PRIME)
  })

  it('packs identical felts for every text', () => {
    for (const text of TEXTS) {
      expect(packUtf8ToFelts(text), `packUtf8ToFelts(${JSON.stringify(text)})`).toEqual(
        ts.packUtf8ToFelts(text),
      )
    }
  })

  it('builds identical calldata', () => {
    for (const text of TEXTS.filter((t) => t !== '')) {
      const payload = ts.packUtf8ToFelts(text)
      expect(buildInvokeCalldata(MODE_APPEND, 0x67617465n, payload)).toEqual(
        ts.buildInvokeCalldata(ts.MODE_APPEND, 0x67617465n, payload),
      )
    }
  })

  it('predicts the same revert for every mode and payload length', () => {
    for (const mode of [0n, 1n, 2n, 3n, 255n]) {
      for (const length of [0, 1, 2, 5]) {
        const payload = Array.from({ length }, (_, i) => BigInt(i + 1))
        expect(
          predictMessageBookRevert(mode, payload),
          `mode ${mode}, ${length} felts`,
        ).toBe(ts.predictMessageBookRevert(mode, payload))
      }
    }
  })

  // `toFelt` is module-private in the TypeScript source, so it cannot be compared
  // directly. It is compared through `buildInvokeCalldata` above, which is the only
  // caller either module has; this pins the port's own behaviour, including the `0x`
  // pass-through that means a hex string is NOT normalised on the way through.
  it('formats felts the way the TypeScript source does', () => {
    expect(toFelt(0n)).toBe('0x0')
    expect(toFelt(255n)).toBe('0xff')
    expect(toFelt(0x67617465n)).toBe('0x67617465')
    expect(toFelt(12345)).toBe('0x3039')
    expect(toFelt('99')).toBe('0x63')
    expect(toFelt('0xdeadBEEF')).toBe('0xdeadBEEF')
  })
})

describe('buildInvokeCalldata', () => {
  it('writes the length prefix the pool will parse the payload with', () => {
    const payload = packUtf8ToFelts('hello')
    const calldata = buildInvokeCalldata(MODE_APPEND, 0x67617465n, payload)
    expect(calldata[0]).toBe('0x1')
    expect(calldata[1]).toBe('0x67617465')
    expect(BigInt(calldata[2])).toBe(BigInt(payload.length))
    expect(calldata.length).toBe(3 + payload.length)
  })
})

describe('checkInvokeCalldata', () => {
  const rules = (calldata) => checkInvokeCalldata(calldata).map((f) => f.rule)
  const good = buildInvokeCalldata(MODE_APPEND, 0x67617465n, packUtf8ToFelts('hello'))

  it('passes a well-formed MODE_APPEND call', () => {
    expect(checkInvokeCalldata(good)).toEqual([])
  })

  it('passes a well-formed MODE_SEAL call carrying exactly one felt', () => {
    expect(checkInvokeCalldata(buildInvokeCalldata(MODE_SEAL, 1n, [0xabcn]))).toEqual([])
  })

  it('catches an empty payload — the pool does not', () => {
    expect(rules(['0x1', '0x67617465', '0x0'])).toEqual(['EMPTY_PAYLOAD'])
  })

  it('catches an unknown mode — the pool does not', () => {
    expect(rules(['0x3', '0x67617465', '0x1', '0x41'])).toEqual(['UNKNOWN_MODE'])
  })

  it('catches MODE_SEAL with more than one felt', () => {
    expect(rules(['0x2', '0x67617465', '0x2', '0x41', '0x42'])).toEqual(['SEAL_NEEDS_ONE_FELT'])
  })

  it('catches a length prefix that overstates the payload — the pool does not', () => {
    expect(rules(['0x1', '0x67617465', '0x9', '0x41'])).toEqual(['LENGTH_PREFIX_MISMATCH'])
  })

  it('catches a length prefix that understates the payload', () => {
    expect(rules(['0x1', '0x67617465', '0x1', '0x41', '0x42'])).toEqual(['LENGTH_PREFIX_MISMATCH'])
  })

  it('reports a mismatched prefix and a bad mode together rather than stopping at the first', () => {
    expect(rules(['0x7', '0x67617465', '0x4', '0x41'])).toEqual([
      'LENGTH_PREFIX_MISMATCH',
      'UNKNOWN_MODE',
    ])
  })

  it('rejects an entry that is not a felt at all', () => {
    expect(rules(['0x1', '0x67617465', '0x1', 'not-a-number'])).toEqual(['NOT_A_FELT'])
  })

  it('rejects an entry at or above the field prime', () => {
    expect(rules(['0x1', '0x67617465', '0x1', `0x${FELT_PRIME.toString(16)}`])).toEqual([
      'NOT_A_FELT',
    ])
  })

  it('rejects calldata too short to be a privacy_invoke call', () => {
    expect(rules(['0x1', '0x67617465'])).toEqual(['MALFORMED_CALLDATA'])
    expect(rules([])).toEqual(['MALFORMED_CALLDATA'])
    expect(rules(null)).toEqual(['MALFORMED_CALLDATA'])
  })

  it('does not throw on any of the malformed inputs above', () => {
    for (const bad of [null, undefined, [], ['x'], ['0x1', '0x2', 'nope']]) {
      expect(() => checkInvokeCalldata(bad)).not.toThrow()
    }
  })
})
