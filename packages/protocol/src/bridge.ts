//
// Leaving the pool for another chain (story: bridge — RFP idea 22, scoped to OUTBOUND only).
//
// ── ZERO CAIRO, BECAUSE STARKWARE ALREADY DEPLOYED THE HELPER ─────────────────────────────
//
// `OutboundAnonymizer` is the sponsor's own contract, live on mainnet with 432+ successful burns.
// Its entire external surface is one entrypoint, and the pool reaches it through exactly the
// mechanism a swap already proved: `InvokeExternal` forwards `(contract_address, calldata)` to the
// target's `privacy_invoke` (`privacy.cairo:533-539`). So a crossing is the SAME sandwich as a
// swap with one leg removed — withdraw to the helper, invoke it — and nothing here is a new
// protocol, only a new payload.
//
// This is the sponsor's helper, not ours. That is worth saying plainly wherever the product
// mentions it: we did not write, audit or deploy the Cairo that burns the USDC.
//
// ── THE ABI IS READ, NOT ASSUMED ──────────────────────────────────────────────────────────
//
// `starknet_getClassAt` against mainnet on 2026-08-27:
//
//     privacy_invoke(params: BuyParams) -> Span<OpenNoteDeposit>
//     BuyParams { mint_recipient: u256, amount: u256, max_fee: u256,
//                 min_finality_threshold: u32, destination_domain: u32 }
//
// A struct passed by value serialises flat and a `u256` is two felts, so the calldata is exactly
// eight felts in that order. It returns an EMPTY span — nothing comes back into the pool, which is
// why a crossing mints no open note where a swap does.
//
// ── AND IT IS PINNED AGAINST A REAL CROSSING ──────────────────────────────────────────────
//
// `bridge.test.ts` builds the calldata for mainnet tx `0x68690c68…db5` and requires it to equal
// the felts that transaction actually carried. A layout this file gets wrong is a burn of somebody
// else's money to an address nobody holds, so the check is a decoded transaction rather than a
// reading of a struct definition.
//
// ── BROWSER-SAFE ──────────────────────────────────────────────────────────────────────────
//
// `fetch`, `BigInt` and JSON only — no `starknet` import — for `token-list.ts`'s reason: the build
// gate bans the `poseidon` graph from the eager chunk and this module is imported by a surface.
//

/**
 * The sponsor's live outbound helper. 165 lines of Cairo, zero storage beyond three
 * constructor-baked addresses, and exactly three revert paths: `CALLER_NOT_POOL`, `ZERO_AMOUNT`,
 * `AMOUNT_LE_MAX_FEE`.
 *
 * No token whitelist, no recipient check, no per-caller state, no owner and no upgrade path — so
 * there is nothing about this address that can be revoked out from under a user mid-flight.
 */
export const OUTBOUND_ANONYMIZER =
  '0x009067f35d2cab3cb933f3d78793660402026f8fa31e041ca2cab4a8e9a49092'

/**
 * The ONE token this helper can burn — and it is NOT the USDC most Starknet apps mean.
 *
 * ── THE TRAP, STATED BEFORE THE ADDRESS ───────────────────────────────────────────────────
 *
 * AVNU's token list carries two: `USDC` at `0x033068f6…` (Circle's native issuance) and `USDC.e`
 * at `0x053c9125…` ("Bridged USDC", the StarkGate one). Only the native one is minted by the
 * TokenMessengerMinter that CCTP burns through, and the helper has it baked in at construction —
 * the caller cannot pass a token.
 *
 * Withdrawing `USDC.e` to this contract would hand it a token it has no code path for. Read from
 * the chain rather than from a list: the token moved in mainnet tx `0x68690c68…db5` was
 * `0x033068f6…`, whose own `symbol()` answers "USDC" and `decimals()` answers 6.
 *
 * Pinned here rather than resolved from the token list at runtime, because "whichever entry is
 * called USDC" is precisely the lookup that picks the wrong one.
 */
export const BRIDGE_USDC =
  '0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb'

/** Confirmed against the contract's own `decimals()`, not read off a list. */
export const BRIDGE_USDC_DECIMALS = 6

export const BRIDGE_USDC_SYMBOL = 'USDC'

/**
 * CCTP Fast: soft finality, seconds rather than minutes, and a protocol fee in basis points.
 *
 * Standard (2000) quotes 0 bps and takes ~13-19 minutes. Fast is what StarkWare's own deployment
 * declares on every one of its live burns, and 12 bps of a few dollars is smaller than the reason
 * to make somebody watch a spinner for a quarter of an hour.
 */
export const FAST_FINALITY_THRESHOLD = 1000

/** Starknet's own CCTP domain. The source half of every fee quote below. */
export const STARKNET_CCTP_DOMAIN = 25

/** How a destination chain spells an address. Decides both parsing and the mismatch sentence. */
export type AddressFamily = 'evm' | 'solana'

export interface BridgeDestination {
  /** Stable id used in state and in copy keys. */
  readonly key: string
  readonly name: string
  /** Circle's CCTP domain id. The eighth felt of the burn. */
  readonly domain: number
  readonly family: AddressFamily
  /**
   * Stated where the address is typed, because a wrong-chain send is unrecoverable and the
   * shape of a correct address is the only thing a user can check before pressing.
   */
  readonly addressHint: string
  /**
   * What is genuinely unproven about this destination, or `null`.
   *
   * NOT MARKETING COPY AND NOT OPTIONAL. Solana carries a real, specific gap — a fresh wallet with
   * no USDC associated-token account cannot receive, and the sponsor's helper hardcodes a zero
   * hook payload so it structurally cannot ask Circle to create one. A destination that hides that
   * is a destination that takes an irreversible burn on a promise nobody has tested.
   */
  readonly caveat: string | null
}

/**
 * Where a crossing can land.
 *
 * ── EVERY DOMAIN NUMBER HERE HAS A SOURCE ─────────────────────────────────────────────────
 *
 * The five EVM rows are the sponsor's own mainnet chain table (`privacy-bridge`
 * `packages/bridge-core/src/core/config.ts`, `EVM_CCTP_SOURCES_MAINNET`), which pairs chain id to
 * domain: Ethereum 1→0, OP Mainnet 10→2, Arbitrum One 42161→3, Base 8453→6, Polygon PoS 137→7.
 * Domain 7 is confirmed twice over — the decoded mainnet crossing declares it, and StarkWare's
 * deployment has only ever exited to Polygon.
 *
 * Solana is domain 5, from the bridge research: both ends are registered on-chain, and 270
 * Starknet→Solana burns have completed, 8 of them carrying the byte-identical forwarding hook.
 *
 * DELIBERATELY SHORT. Circle forwards to roughly eighteen domains and every extra row is one more
 * number nobody in this repository has checked. A destination list is not a feature list.
 */
export const DESTINATIONS: readonly BridgeDestination[] = [
  {
    key: 'base',
    name: 'Base',
    domain: 6,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'arbitrum',
    name: 'Arbitrum One',
    domain: 3,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'optimism',
    name: 'OP Mainnet',
    domain: 2,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'polygon',
    name: 'Polygon',
    domain: 7,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'ethereum',
    name: 'Ethereum',
    domain: 0,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'solana',
    name: 'Solana',
    domain: 5,
    family: 'solana',
    addressHint: 'a base58 account address, 32 bytes',
    caveat:
      'USDC arrives on Solana only if this address already holds a USDC token account. A brand-new ' +
      'wallet does not have one, and the delivery waits — the burn has happened and cannot be ' +
      'refunded, though the transfer stays claimable once the account exists. Nobody in this ' +
      'project has tested a first-time Solana address.',
  },
]

export function destinationFor(key: string): BridgeDestination | null {
  return DESTINATIONS.find((d) => d.key === key) ?? null
}

// ── The destination address ───────────────────────────────────────────────────────────────

export type DestinationResult =
  /** `mintRecipient` is the u256 CCTP mints to: for EVM the address's own numeric value. */
  | { readonly state: 'ok'; readonly mintRecipient: bigint }
  /** `because` is a whole sentence, safe to render on the field. */
  | { readonly state: 'refused'; readonly because: string }

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Base58 → bytes, the Bitcoin alphabet Solana uses.
 *
 * Hand-written rather than depended on: it is fifteen lines, and this module's whole value is that
 * a surface can import it without dragging a package graph into the eager chunk.
 *
 * Returns `null` for anything that is not valid base58 rather than throwing — the caller is a
 * keystroke handler, and half a pasted address is the normal case rather than an error.
 */
function base58Bytes(input: string): Uint8Array | null {
  if (input === '') return null
  // Leading '1's are leading zero bytes by definition and carry no numeric weight, so they are
  // counted separately and prepended — dropping them would silently shorten the key.
  let zeros = 0
  while (zeros < input.length && input[zeros] === '1') zeros++

  let value = 0n
  for (const character of input) {
    const digit = BASE58.indexOf(character)
    if (digit === -1) return null
    value = value * 58n + BigInt(digit)
  }

  const body: number[] = []
  while (value > 0n) {
    body.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...body])
}

/**
 * Turn what somebody typed into the `mint_recipient` felts, or say why it cannot be one.
 *
 * ── THE CHAIN AND THE ADDRESS ARE CHECKED TOGETHER, ON PURPOSE ────────────────────────────
 *
 * A Solana address pasted while Base is selected parses fine as base58 and is a perfectly valid
 * address — of the wrong kind. Validating the string alone would accept it. So the family the
 * SELECTED chain uses is what the string is held to, and the refusal names both halves: what was
 * typed and what this chain wanted.
 *
 * That pairing is the only guard against the failure mode this whole surface has to fear, which is
 * not a malformed address but a well-formed one on the wrong chain.
 */
export function parseDestination(
  destination: string,
  chain: BridgeDestination,
): DestinationResult {
  const typed = destination.trim()
  if (typed === '') return { state: 'refused', because: 'Enter a destination address' }

  if (chain.family === 'evm') {
    if (!EVM_ADDRESS.test(typed)) {
      const looksSolana = base58Bytes(typed)?.length === 32
      return {
        state: 'refused',
        because: looksSolana
          ? `That is a Solana address, and this crossing is going to ${chain.name}. Switch the chain or paste an address that starts with 0x.`
          : `${chain.name} wants ${chain.addressHint}.`,
      }
    }
    // The numeric value of the 20-byte address, which is what a left-padded bytes32 mint recipient
    // IS — the same one line the sponsor's own `bridgeOut.ts` uses (`BigInt(destination)`).
    const mintRecipient = BigInt(typed)
    if (mintRecipient === 0n) {
      return { state: 'refused', because: 'That is the zero address. USDC sent there is destroyed.' }
    }
    return { state: 'ok', mintRecipient }
  }

  const bytes = base58Bytes(typed)
  if (bytes === null || bytes.length !== 32) {
    const looksEvm = EVM_ADDRESS.test(typed)
    return {
      state: 'refused',
      because: looksEvm
        ? `That is an EVM address, and this crossing is going to ${chain.name}. Switch the chain or paste a base58 account address.`
        : `${chain.name} wants ${chain.addressHint}.`,
    }
  }
  let mintRecipient = 0n
  for (const byte of bytes) mintRecipient = (mintRecipient << 8n) | BigInt(byte)
  if (mintRecipient === 0n) {
    return { state: 'refused', because: 'That is the all-zero account. USDC sent there is destroyed.' }
  }
  return { state: 'ok', mintRecipient }
}

// ── What Circle charges ───────────────────────────────────────────────────────────────────

const IRIS_BASE = 'https://iris-api.circle.com'

/**
 * The forward-fee buffer to take.
 *
 * Circle quotes `low`/`med`/`high` for the same route because destination gas moves between the
 * quote and the mint. `med` is the sponsor's own default and it is the right one here for an
 * asymmetric reason: `feeExecuted == max_fee` on every observed message, so an over-quote is money
 * the user simply loses, while an under-quote does NOT fail — Iris falls back to Standard finality
 * with `delayReason=insufficient_fee` and the transfer still lands, slower.
 *
 * Overpaying costs money; underpaying costs minutes. Take the middle.
 */
const FEE_TIER = 'med' as const

/** The URL a fee quote goes to. Exported so a relayer proxy builds the identical one. */
export function feeQuoteUrl(destinationDomain: number): string {
  return `${IRIS_BASE}/v2/burn/USDC/fees/${STARKNET_CCTP_DOMAIN}/${destinationDomain}?forward=true`
}

export interface ForwardFee {
  /** What goes in `max_fee`: the flat forwarding fee plus the protocol fee. */
  readonly maxFeeWei: bigint
  /** Circle's Forwarding Service, which submits the destination mint and pays its gas. */
  readonly forwardFeeWei: bigint
  /** CCTP's own basis-point cut of the amount. */
  readonly protocolFeeWei: bigint
  /** The tier this quote was computed for. Must equal what the burn declares — see below. */
  readonly finalityThreshold: number
}

export type ForwardFeeResult =
  | { readonly state: 'quoted'; readonly fee: ForwardFee }
  /** `because` is renderable. A crossing with no live fee is one we refuse to guess at. */
  | { readonly state: 'unavailable'; readonly because: string }

interface IrisFeeRow {
  finalityThreshold?: unknown
  /** Protocol fee in BASIS POINTS. */
  minimumFee?: unknown
  /** Flat forwarding fee in USDC base units. Absent unless `?forward=true`. */
  forwardFee?: { low?: unknown; med?: unknown; high?: unknown }
}

async function fetchJsonDefault(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

/**
 * What this crossing will cost, read live.
 *
 * ── NOTHING HERE IS A CONSTANT, AND THAT IS THE POINT ─────────────────────────────────────
 *
 * The flat forwarding fee is destination gas priced in USDC, so it moves with the destination
 * chain: measured on 2026-08-27 it was ~$0.054 to Base, ~$0.061 to Polygon, ~$0.15 to Solana and
 * ~$1.04 to Ethereum. A pinned table would be wrong within a day and wrong in the direction that
 * strands a transfer, so the number is fetched per quote.
 *
 * ── AND THE FEE AND THE FINALITY TIER TRAVEL TOGETHER ─────────────────────────────────────
 *
 * `finalityThreshold` is carried out of here rather than re-derived at the burn. The sponsor's own
 * code calls a fee quoted for one tier paired with a burn declaring another "the exact stranding
 * class this function exists to prevent" — so `planSend` requires the two to match rather than
 * trusting two call sites to pick the same constant.
 *
 * NEVER THROWS. A surface calls this while somebody is typing.
 */
export async function fetchForwardFee(input: {
  destinationDomain: number
  amount: bigint
  /** Test seam, and the proxy seam — see `quote.ts`'s header on why the browser should not ask. */
  fetchJson?: (url: string) => Promise<unknown>
}): Promise<ForwardFeeResult> {
  const unavailable = (because: string): ForwardFeeResult => ({ state: 'unavailable', because })
  if (input.amount <= 0n) return unavailable('Enter an amount')

  let payload: unknown
  try {
    payload = await (input.fetchJson ?? fetchJsonDefault)(feeQuoteUrl(input.destinationDomain))
  } catch {
    return unavailable('The bridge fee could not be read, so nothing was quoted.')
  }
  if (!Array.isArray(payload)) {
    return unavailable('The fee service answered in a shape this app does not recognise.')
  }

  const row = (payload as IrisFeeRow[]).find(
    (r) => r.finalityThreshold === FAST_FINALITY_THRESHOLD,
  )
  if (!row) {
    // NEVER fall through to the other tier. A Standard-priced fee on a Fast-declared burn is the
    // mismatch described above; a slower crossing is the honest answer to it not being offered.
    return unavailable('Fast delivery is not being quoted for this chain right now.')
  }

  const forwardRaw = row.forwardFee?.[FEE_TIER]
  if (typeof forwardRaw !== 'number' || !Number.isFinite(forwardRaw) || forwardRaw < 0) {
    // No forwarding fee means no Forwarding Service on this route — and without it nobody submits
    // the destination mint, so the USDC would need gas at the far end that a fresh address has not
    // got. That is the whole promise of this surface, so its absence is a refusal.
    return unavailable(`Circle is not forwarding to this chain right now, so nothing was quoted.`)
  }

  const bps = row.minimumFee
  if (typeof bps !== 'number' || !Number.isFinite(bps) || bps < 0) {
    return unavailable('The fee service quoted a protocol fee this app will not build a burn from.')
  }

  // Circle's own arithmetic: `minimumFee` is basis points, scaled by 100 and divided by 1e6 — the
  // same thing as bps/10⁴, spelled the way their docs spell it. CEIL-divided, because their minimum
  // is a floor: a floored quote lands a wei under it and Iris demotes the transfer to Standard.
  const protocolFeeWei = (input.amount * BigInt(Math.ceil(bps * 100)) + 999_999n) / 1_000_000n
  const forwardFeeWei = BigInt(Math.ceil(forwardRaw))

  return {
    state: 'quoted',
    fee: {
      maxFeeWei: forwardFeeWei + protocolFeeWei,
      forwardFeeWei,
      protocolFeeWei,
      finalityThreshold: FAST_FINALITY_THRESHOLD,
    },
  }
}

/**
 * What actually lands at the destination.
 *
 * `amount − max_fee`, and it is deterministic at signing rather than discovered afterwards:
 * `feeExecuted == max_fee` on every observed message. So this number can be shown as a promise
 * rather than an estimate, which is rare enough on a bridge to be worth putting on screen.
 *
 * Returns `null` when the fee swallows the amount — the helper's own `AMOUNT_LE_MAX_FEE`, caught
 * here so a surface can say the floor instead of paying a pool fee to be told it.
 */
export function deliveredWei(amount: bigint, maxFeeWei: bigint): bigint | null {
  if (amount <= maxFeeWei) return null
  return amount - maxFeeWei
}

// ── The eight felts ───────────────────────────────────────────────────────────────────────

export type BuyParamsResult =
  | { readonly state: 'ready'; readonly calldata: readonly string[] }
  | { readonly state: 'refused'; readonly because: string }

const U128_MAX = (1n << 128n) - 1n
const U32_MAX = 0xffffffffn

/** A felt as the chain wants it: `0x`-prefixed lowercase hex. */
const felt = (value: bigint) => `0x${value.toString(16)}`

/**
 * Serialise `BuyParams` for `privacy_invoke`.
 *
 * ── EVERY FELT IS BOUNDS-CHECKED, AND NONE OF THEM IS COSMETIC ────────────────────────────
 *
 * Cairo's `u256` is `{ low: u128, high: u128 }` and `u32` is one felt with a range. A value that
 * overflows its half does not fail loudly at the boundary — it becomes a DIFFERENT number, and
 * every number in this struct is either an amount of money or the address that money lands at.
 * Splitting without checking is how a 33-byte "address" becomes a 32-byte one that belongs to
 * somebody else.
 *
 * REFUSES rather than throws, for `swap-calldata.ts`'s reason: a person is standing on the surface
 * that calls this.
 */
export function buyParamsCalldata(input: {
  mintRecipient: bigint
  amount: bigint
  maxFeeWei: bigint
  minFinalityThreshold: number
  destinationDomain: number
}): BuyParamsResult {
  const refused = (because: string): BuyParamsResult => ({ state: 'refused', because })

  const { mintRecipient, amount, maxFeeWei } = input
  if (mintRecipient <= 0n || mintRecipient > (1n << 256n) - 1n) {
    return refused('The destination address is not a value CCTP can mint to.')
  }
  if (amount <= 0n || amount > U128_MAX) {
    // The helper's own `ZERO_AMOUNT`, and the top half of a u256 the pool's `u128` balances could
    // never have held anyway.
    return refused('The amount is not a value this bridge can burn.')
  }
  if (maxFeeWei < 0n || maxFeeWei >= amount) {
    // `AMOUNT_LE_MAX_FEE`, spelled as the thing a person can act on.
    return refused('The fee is not smaller than the amount, so nothing would arrive.')
  }

  const finality = BigInt(input.minFinalityThreshold)
  const domain = BigInt(input.destinationDomain)
  if (finality <= 0n || finality > U32_MAX) return refused('The finality tier is out of range.')
  if (domain < 0n || domain > U32_MAX) return refused('The destination chain is out of range.')

  return {
    state: 'ready',
    calldata: [
      felt(mintRecipient & U128_MAX),
      felt(mintRecipient >> 128n),
      felt(amount),
      felt(0n),
      felt(maxFeeWei),
      felt(0n),
      felt(finality),
      felt(domain),
    ],
  }
}
