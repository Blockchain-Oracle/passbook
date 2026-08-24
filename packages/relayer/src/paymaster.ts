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
 *
 * NOT ON THE REGISTRATION PATH, and that is arithmetic rather than preference (story
 * 1.12). The withdraw-fee model below reimburses the relayer out of the transaction's
 * own value: it folds a `Withdraw` into the proven action chain and names us as the
 * recipient. A sponsored registration is a lone zero-deposit `SetViewingKey` — it mints
 * no note and moves no value, so there is nothing to withdraw from and the reimbursement
 * leg has no source. (The pool agrees: a withdraw with no inputs is
 * `NEGATIVE_INTERMEDIATE_BALANCE`, recorded in message-book.ts's ACTION_LIST_EVIDENCE.)
 * So registration pays plainly instead — `register.ts` prepends the relayer's own
 * `STRK.approve(pool, liveFee)` to the batch it submits, which works because
 * `collect_fee` pulls from `get_caller_address()` and the caller is the relayer. That is
 * the 1-5 funded-key discipline: bounded approve under a live-fee ceiling, floor-monitored
 * balance. Do not re-derive this by trying `buildTransaction` on a registration.
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
   * THE GAP IS CLOSED, and this class is not where it closed. `buildTransaction` above still
   * returns `{ actions, feeAction }` while the server requires a `SubmitBody`
   * (`protocol/src/relayer-wire.ts`), so passing one straight into the other still earns a 400
   * — but that is now a dead shape rather than an unfinished one, because the two real paths
   * both bypass it:
   *
   *   - REGISTRATION pays plainly (`protocol/src/register.ts`), for the arithmetic reason in the
   *     class comment: a lone `SetViewingKey` moves no value, so there is nothing to withdraw
   *     from and no reimbursement leg is possible.
   *   - A SEND uses the withdraw-fee model this class describes (`protocol/src/send.ts`, story
   *     1.16), and the reason it does not run through here is structural: the reimbursement
   *     `Withdraw` has to be inside the action list BEFORE the prover binds it, so only the
   *     client — the one holding the notes and calling the prover — can fold it in. The
   *     relayer's whole contribution is telling the client where to send it, which is the
   *     `GET /fee-recipient` endpoint in server.ts, not a method here. The relayer cannot
   *     verify the leg afterwards either (`apply_actions` calldata is deliberately uninspected),
   *     so its exposure to a batch that folded in no leg is bounded by the send cap instead.
   *
   * Do not re-derive either of those by trying `buildTransaction` on a real flow.
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
