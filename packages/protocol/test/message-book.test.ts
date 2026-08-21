import { describe, it, expect } from 'vitest'
import {
  MODE_APPEND,
  MODE_SEAL,
  CLIENT_ACTION,
  buildGateActionList,
  buildInvokeCalldata,
  encodeClientActions,
  packUtf8ToFelts,
  predictMessageBookRevert,
  FELT_PRIME,
} from '../src/message-book.js'

describe('predictMessageBookRevert', () => {
  // These three are the contract's only caller-triggerable panics. The pool does NOT
  // catch any of them — verified on mainnet — so this function is the only guard.
  it('catches EMPTY_PAYLOAD before it costs a fee', () => {
    expect(predictMessageBookRevert(MODE_APPEND, [])).toBe('EMPTY_PAYLOAD')
  })

  it('catches SEAL_NEEDS_ONE_FELT when a seal carries more than one felt', () => {
    expect(predictMessageBookRevert(MODE_SEAL, [1n, 2n])).toBe('SEAL_NEEDS_ONE_FELT')
    expect(predictMessageBookRevert(MODE_SEAL, [1n])).toBeNull()
  })

  it('catches UNKNOWN_MODE for anything that is not 1 or 2', () => {
    expect(predictMessageBookRevert(3n, [1n])).toBe('UNKNOWN_MODE')
    expect(predictMessageBookRevert(0n, [1n])).toBe('UNKNOWN_MODE')
  })

  it('reports EMPTY_PAYLOAD ahead of UNKNOWN_MODE, matching the contract order', () => {
    // The contract asserts on the payload before it branches on the mode, so an empty
    // payload with a bad mode panics EMPTY_PAYLOAD. Getting this backwards would print
    // a misleading diagnosis.
    expect(predictMessageBookRevert(99n, [])).toBe('EMPTY_PAYLOAD')
  })

  it('passes a well-formed append', () => {
    expect(predictMessageBookRevert(MODE_APPEND, [1n, 2n, 3n])).toBeNull()
  })
})

describe('buildInvokeCalldata', () => {
  it('emits [mode, tag, payload_len, ...payload]', () => {
    expect(buildInvokeCalldata(MODE_APPEND, 7n, [0x2an])).toEqual(['0x1', '0x7', '0x1', '0x2a'])
  })

  it('keeps the length prefix consistent for a multi-felt payload', () => {
    const cd = buildInvokeCalldata(MODE_APPEND, 1n, [1n, 2n, 3n, 4n])
    expect(BigInt(cd[2]!)).toBe(4n)
    expect(cd.length).toBe(7)
  })

  it('emits a zero prefix and nothing after it for an empty payload', () => {
    // Legal to construct, illegal to send — predictMessageBookRevert is what refuses it.
    expect(buildInvokeCalldata(MODE_APPEND, 1n, [])).toEqual(['0x1', '0x1', '0x0'])
  })
})

describe('encodeClientActions', () => {
  it('serialises the exact span mainnet accepted', () => {
    // Byte-for-byte the calldata that compile_actions accepted on SN_MAIN, returning
    // four server actions with our invoke calldata echoed back unchanged.
    const encoded = encodeClientActions([
      { type: 'SetViewingKey', random: 0x99n },
      { type: 'InvokeExternal', contractAddress: '0xabc', calldata: ['0x1', '0x7', '0x1', '0x2a'] },
    ])
    expect(encoded).toEqual([
      '0x2', // span length
      '0x0', // ClientAction::SetViewingKey
      '0x99',
      '0x8', // ClientAction::InvokeExternal
      '0xabc',
      '0x4', // calldata length
      '0x1',
      '0x7',
      '0x1',
      '0x2a',
    ])
  })

  it('pins the variant indices to the deployed ABI order', () => {
    expect(CLIENT_ACTION.SetViewingKey).toBe(0)
    expect(CLIENT_ACTION.InvokeExternal).toBe(8)
  })
})

describe('buildGateActionList', () => {
  it('puts SetViewingKey first — the pool rejects the other order', () => {
    // [InvokeExternal, SetViewingKey] is ACTIONS_OUT_OF_ORDER on mainnet.
    const actions = buildGateActionList({
      messageBookAddress: '0xabc',
      mode: MODE_APPEND,
      tag: 1n,
      payload: [0x2an],
      viewingKeyRandom: 0x99n,
    })
    expect(actions.map((a) => a.type)).toEqual(['SetViewingKey', 'InvokeExternal'])
  })

  it('carries exactly one invoke-phase action', () => {
    // Two invokes is ACTIONS_OUT_OF_ORDER; the invoke phase admits at most one.
    const actions = buildGateActionList({
      messageBookAddress: '0xabc',
      mode: MODE_APPEND,
      tag: 1n,
      payload: [0x2an],
      viewingKeyRandom: 0x99n,
    })
    expect(actions.filter((a) => a.type === 'InvokeExternal')).toHaveLength(1)
  })
})

describe('packUtf8ToFelts', () => {
  it('packs short ASCII into one felt', () => {
    expect(packUtf8ToFelts('STRK')).toEqual([0x5354524bn])
  })

  it('splits at 31 bytes so every felt stays under the field prime', () => {
    const felts = packUtf8ToFelts('a'.repeat(62))
    expect(felts).toHaveLength(2)
    for (const f of felts) expect(f).toBeLessThan(FELT_PRIME)
  })

  it('keeps multi-byte UTF-8 under the prime', () => {
    for (const f of packUtf8ToFelts('é'.repeat(40))) expect(f).toBeLessThan(FELT_PRIME)
  })

  it('produces an empty array for empty input, which the revert check then rejects', () => {
    expect(packUtf8ToFelts('')).toEqual([])
    expect(predictMessageBookRevert(MODE_APPEND, packUtf8ToFelts(''))).toBe('EMPTY_PAYLOAD')
  })
})
