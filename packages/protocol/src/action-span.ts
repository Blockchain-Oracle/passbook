//
// The compiled `Span<ClientAction>` a proof invocation carries, and the one walker that reads it.
//
// Every guard that inspects what the prover is about to work on — registration, shield, starter
// drip, mail — reads the same span through the same walker, so a width fixed here is fixed for
// all of them. Widths are the pool's own serde layout (`packages/privacy/src/actions.cairo`):
// fixed for most variants, length-prefixed for the two invoke shapes.
//

import { hash } from 'starknet'
import { NET } from './constants.js'
import { CLIENT_ACTION } from './client-action-index.js'

const COMPILE_ACTIONS_SELECTOR = hash.getSelectorFromName('compile_actions')

/**
 * Pulls the `Span<ClientAction>` out of a proof invocation's `__execute__` calldata:
 * `[array_len=1, to, selector, inner_len, ...inner]`, `inner = [sender, viewingKey, ...span]`.
 * Target and selector are checked so the assertion is about what the prover works on.
 */
export function extractClientActionSpan(executeCalldata: readonly string[]): bigint[] {
  if (executeCalldata.length < 4) {
    throw new Error(`proof invocation calldata is too short to be an __execute__: ${executeCalldata.length} felts`)
  }
  if (BigInt(executeCalldata[0]!) !== 1n) {
    throw new Error(`refusing a proof invocation carrying ${executeCalldata[0]} calls: a private transaction is exactly one compile_actions`)
  }
  if (BigInt(executeCalldata[1]!) !== BigInt(NET.pool)) {
    throw new Error(`refusing a proof invocation aimed at ${executeCalldata[1]}: expected the pool ${NET.pool}`)
  }
  if (BigInt(executeCalldata[2]!) !== BigInt(COMPILE_ACTIONS_SELECTOR)) {
    throw new Error(`refusing a proof invocation of selector ${executeCalldata[2]}: expected compile_actions`)
  }
  const innerLength = Number(BigInt(executeCalldata[3]!))
  const inner = executeCalldata.slice(4)
  if (inner.length !== innerLength) {
    throw new Error(
      `compile_actions calldata declares ${innerLength} felts but ${inner.length} follow it — ` +
        'a mismatch means part of this invocation went uninspected',
    )
  }
  if (innerLength < 2) {
    throw new Error(`compile_actions calldata carries ${innerLength} felts: too few for even (sender, viewingKey)`)
  }
  return inner.slice(2).map((f) => BigInt(f))
}

/** Felts each fixed-width `ClientAction` occupies INCLUDING its variant tag. */
const FIXED_WIDTHS: Record<number, number> = {
  [CLIENT_ACTION.SetViewingKey]: 2,
  [CLIENT_ACTION.OpenChannel]: 5,
  [CLIENT_ACTION.OpenSubchannel]: 7,
  [CLIENT_ACTION.CreateEncNote]: 7,
  [CLIENT_ACTION.CreateOpenNote]: 6,
  [CLIENT_ACTION.Deposit]: 3,
  [CLIENT_ACTION.UseNote]: 4,
  [CLIENT_ACTION.Withdraw]: 5,
}

/** A `Span<felt252>` at `at`: its length felt plus that many elements, or `null` when truncated. */
function spanWidth(span: readonly bigint[], at: number): number | null {
  const len = span[at]
  if (len === undefined || len > BigInt(span.length)) return null
  const width = 1 + Number(len)
  return at + width > span.length ? null : width
}

/**
 * Width of the action whose tag sits at `at`, or `null` for an unknown variant or a span that
 * ends before the action does. `InvokeExternal` is `[tag, contract, calldata…]`;
 * `ComputeAndInvoke` is `[tag, contract, compute_data…, invoke_data…]`.
 */
function actionWidth(span: readonly bigint[], at: number): number | null {
  const variant = Number(span[at])
  const fixed = FIXED_WIDTHS[variant]
  if (fixed !== undefined) return at + fixed > span.length ? null : fixed
  if (variant === CLIENT_ACTION.InvokeExternal) {
    const calldata = spanWidth(span, at + 2)
    return calldata === null ? null : 2 + calldata
  }
  if (variant === CLIENT_ACTION.ComputeAndInvoke) {
    const compute = spanWidth(span, at + 2)
    if (compute === null) return null
    const invoke = spanWidth(span, at + 2 + compute)
    return invoke === null ? null : 2 + compute + invoke
  }
  return null
}

/** One decoded `ClientAction`: its variant tag and the felts that follow it. */
export interface DecodedAction {
  variant: number
  fields: readonly bigint[]
}

/**
 * Walks a `Span<ClientAction>` into its actions, refusing anything it cannot account for.
 *
 * It reads the declared count, advances by each variant's width, and insists the span ends
 * exactly where the last action does — an unconsumed tail is calldata nobody inspected, which on
 * a batch our own key pays for is the whole thing worth refusing.
 */
export function decodeClientActions(span: readonly bigint[], what: string): DecodedAction[] {
  const count = Number(span[0] ?? -1n)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`refusing a ${what} span declaring ${span[0] ?? 'no'} actions`)
  }
  const actions: DecodedAction[] = []
  let at = 1
  for (let index = 0; index < count; index++) {
    const variant = Number(span[at])
    const width = actionWidth(span, at)
    if (width === null) throw new Error(`refusing unsupported or truncated ${what} action ${variant} at ${index}`)
    actions.push({ variant, fields: span.slice(at + 1, at + width) })
    at += width
  }
  if (at !== span.length) throw new Error(`${span.length - at} ${what} calldata felts went uninspected`)
  return actions
}
