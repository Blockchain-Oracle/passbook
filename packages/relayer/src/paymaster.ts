import { readPoolConstants } from '../../protocol/src/pool.js'

export interface PaymasterConfig {
  relayerAddress: string
  feeToken: string
}

export interface FeeAction {
  type: 'withdraw'
  token: string
  amount: bigint
  recipient: string
}

/**
 * Every Starknet transaction publicly records which account submitted it and paid.
 * That is not hideable; the only question is whose address sits in that slot. If the
 * user submits, it is theirs. If we submit, it is ours. That is why this exists.
 *
 * It is permitted because `apply_actions` has zero caller access control and
 * `collect_fee` pulls from `get_caller_address()`, so anyone may submit. AVNU's
 * forwarder is whitelist-gated and reverts "Caller is not whitelisted" even for the
 * pool itself, and its alternative would put an API key inside the public browser
 * bundle where a rival could read and burn it during judging.
 *
 * AVNU's "sponsorship" is not sponsorship: the fee is reimbursed by an ordinary
 * withdraw action folded into the proven action chain, and the recipient is an
 * arbitrary address. So we simply name ourselves as that recipient.
 *
 * The relayer's private key lives only in the server process (server.ts) and is
 * never a field on this object — the browser holds an instance of this class, so
 * `PaymasterConfig` carries two public addresses and deliberately nothing else.
 */
export class RelayerPaymaster {
  constructor(private readonly config: PaymasterConfig) {}

  async buildTransaction(input: { actions: unknown[] }) {
    const { feeWei, paused } = await readPoolConstants()
    if (paused) throw new Error('The pool is paused. Withdrawals continue; new actions do not.')
    const feeAction: FeeAction = {
      type: 'withdraw',
      token: this.config.feeToken,
      // Read at call time, never hardcoded: this pool charged 4 STRK earlier in its
      // history and its upgrade delay is zero, so the fee can change between loads.
      amount: feeWei,
      recipient: this.config.relayerAddress,
    }
    return { actions: input.actions, feeAction }
  }

  /**
   * Posts to our server, which holds the key and submits the v3 invoke.
   * The URL is relative because the browser holds this instance: it resolves against
   * the app's own origin, which is where the relayer endpoint is served from.
   *
   * KNOWN GAP — these two halves do not connect yet, and this is the honest record of
   * it rather than a surprise for whoever wires them. `buildTransaction` above returns
   * `{ actions, feeAction }`; the server requires `{ calls: Call[] }`. The step that
   * turns an action list into pool calls does not exist: it needs `compile_actions`
   * output fed verbatim into `apply_actions`, plus the `STRK.approve(pool, fee)` that
   * must ride in the same transaction because `collect_fee` pulls from the caller.
   * Passing a `buildTransaction` result straight into here earns a 400 today. Closing
   * that is the submission-path work, which is still an open unknown.
   */
  async executeTransaction(payload: unknown): Promise<{ transactionHash: string }> {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`relayer refused: ${res.status} ${await res.text()}`)
    return res.json() as Promise<{ transactionHash: string }>
  }
}
