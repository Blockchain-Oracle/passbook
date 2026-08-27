import { describe, it, expect } from 'vitest'
import type { Call } from 'starknet'

import { assertSubmittable, type SubmissionPolicy } from '../src/allowlist.js'
import { NET } from '../../protocol/src/constants.js'

//
// The app contracts are spending authority granted to the network, same as everything else in
// `allowlist.ts`. These tests are about what the relayer's key can be made to do once Markets and
// Launch exist — and, just as importantly, what it can be made to do BEFORE they do.
//

const MARKETS = '0x0750ec8f6c6c96f1e66129f84ac8ca798973bb3e5fd9384269706a7e079f4388'
const LAUNCH = '0x07c4a3f7cd257beb5a8243fb1cd3ac3e5f59b36f08a436bbd657ef214c970d22'

const policy: SubmissionPolicy = { markets: MARKETS, launch: LAUNCH }

const call = (contractAddress: string, entrypoint: string, calldata: string[] = []): Call => ({
  contractAddress,
  entrypoint,
  calldata,
})

const poolCall = call(NET.pool, 'apply_actions', ['0x1'])

describe('the pool-facing entrypoint', () => {
  it('permits privacy_invoke on both app contracts', () => {
    expect(() => assertSubmittable([call(MARKETS, 'privacy_invoke', ['0x2'])], policy)).not.toThrow()
    expect(() => assertSubmittable([call(LAUNCH, 'privacy_invoke', ['0x1'])], policy)).not.toThrow()
  })
})

describe('the keeper calls', () => {
  it('permits resolve and void on Markets', () => {
    expect(() => assertSubmittable([call(MARKETS, 'resolve', ['0x0'])], policy)).not.toThrow()
    expect(() => assertSubmittable([call(MARKETS, 'void', ['0x0'])], policy)).not.toThrow()
  })

  it('permits graduate on Launch', () => {
    expect(() => assertSubmittable([call(LAUNCH, 'graduate', ['0x0'])], policy)).not.toThrow()
  })

  // `sweep` moves the raise to an address the caller names, and its calldata carries the creator's
  // bearer secret in plaintext. An allowlisted sweep would mean this key signs transactions
  // containing somebody else's money-secret; it is refused on purpose, not by omission.
  it('refuses sweep, which carries a bearer secret and moves the raise', () => {
    expect(() => assertSubmittable([call(LAUNCH, 'sweep', ['0x0', '0x1', '0x2'])], policy)).toThrow(
      /not an allowlisted call/,
    )
  })

  // Each contract's keeper calls are its own. `graduate` is meaningless on Markets and `resolve`
  // on Launch, so permitting them across contracts would only ever sign a reverting transaction.
  it('does not let one contract’s keeper calls be made on the other', () => {
    expect(() => assertSubmittable([call(MARKETS, 'graduate', ['0x0'])], policy)).toThrow(
      /not an allowlisted call/,
    )
    expect(() => assertSubmittable([call(LAUNCH, 'resolve', ['0x0'])], policy)).toThrow(
      /not an allowlisted call/,
    )
  })

  it('refuses every other entrypoint on both', () => {
    for (const entrypoint of ['upgrade', 'transfer', 'privacy_invoke_with_computation', '__execute__']) {
      if (entrypoint === 'privacy_invoke') continue
      expect(() => assertSubmittable([call(MARKETS, entrypoint)], policy)).toThrow()
    }
  })
})

//
// THE STATE THE RELAYER BOOTS IN, and the one most likely to be got wrong: for as long as the
// declares have not landed, the policy carries no addresses at all.
//
describe('before the contracts are deployed', () => {
  it('refuses calls to them, because there is no address to compare against', () => {
    expect(() => assertSubmittable([call(MARKETS, 'privacy_invoke')], {})).toThrow(
      /not an allowlisted call/,
    )
    expect(() => assertSubmittable([call(LAUNCH, 'graduate')], {})).toThrow(/not an allowlisted call/)
  })

  it('still permits everything that worked before they existed', () => {
    expect(() => assertSubmittable([poolCall], {})).not.toThrow()
  })
})

//
// The one-per-batch rules. These are the composition checks — every control here is correct alone
// and the interesting failures come from combining them.
//
describe('one of each, counted across the whole app-contract set', () => {
  it('permits one invoke alongside the pool call', () => {
    expect(() =>
      assertSubmittable([poolCall, call(MARKETS, 'privacy_invoke', ['0x2'])], policy),
    ).not.toThrow()
  })

  // The bug this rule exists to stop: one invoke on each of three contracts is three of the action
  // being bounded, and per-contract counting would call every one of them "at most one".
  it('refuses one invoke on each of two app contracts in a single batch', () => {
    expect(() =>
      assertSubmittable(
        [call(MARKETS, 'privacy_invoke', ['0x2']), call(LAUNCH, 'privacy_invoke', ['0x1'])],
        policy,
      ),
    ).toThrow(/2 privacy_invoke calls/)
  })

  it('refuses two invokes on the same contract', () => {
    expect(() =>
      assertSubmittable(
        [call(MARKETS, 'privacy_invoke', ['0x2']), call(MARKETS, 'privacy_invoke', ['0x4'])],
        policy,
      ),
    ).toThrow(/2 privacy_invoke calls/)
  })

  // resolve, void and graduate each do their whole job the first time they succeed, so a batch of
  // them is one useful transaction and the rest reverting at this wallet's expense.
  it('refuses a batch of keeper calls', () => {
    expect(() =>
      assertSubmittable([call(MARKETS, 'resolve', ['0x0']), call(MARKETS, 'resolve', ['0x1'])], policy),
    ).toThrow(/2 keeper calls/)
    expect(() =>
      assertSubmittable([call(MARKETS, 'resolve', ['0x0']), call(LAUNCH, 'graduate', ['0x0'])], policy),
    ).toThrow(/2 keeper calls/)
  })

  it('still refuses two apply_actions when app contracts are configured', () => {
    expect(() => assertSubmittable([poolCall, poolCall], policy)).toThrow(/2 apply_actions/)
  })
})
