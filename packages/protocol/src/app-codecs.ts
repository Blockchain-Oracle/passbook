//
// The Markets and Launch contracts' shapes, and the codecs between felts and them.
//
// `markets.cairo` and `launch.cairo` declare their structs public "so the web client can decode
// `get_market` without a hand-written ABI". These decoders are that sentence's other half:
// field-for-field transcriptions, in declaration order, of `Market` and `LaunchInfo`. A struct edit
// that reorders a field breaks the test vectors before it breaks a user.
//
// Browser-safe: no imports at all. Selectors are pinned constants (`getSelectorFromName` of the
// entrypoint name), so an eager route never needs the `starknet` graph.
//

// ── Selectors, pinned. ────────────────────────────────────────────────────────────────────
export const SELECTOR = {
  market_count: '0x34b53bfc209bd95471a64893a17d5f18812ef65e53cf785999990babfc31eb8',
  get_market: '0x5764f9d1572e4d8cb7432f108c87d6ba790e18eb821744b0eefd034e85fc79',
  quote_bet: '0x1d6e26c2530698c071cdd811139e91263d91b5e3b92486b6f96074d0d577abe',
  launch_count: '0x2909cbec54fa14313e5709d13f10f6b636fab9ddedecc5e719687441fe9e57c',
  get_launch: '0x311384b8f07fb7bcaf15cf41ea4fc846752894eeb3ed4b6926f10a13c3fa243',
  launch_name: '0x3b4e3053e26d78089f696e20cb6be2475a6983e3492da4870e909f39040bb77',
  launch_symbol: '0x3fe3c45b35be2ce898dd770cfddd5d58757d46fe9959e79df656deea301bcb0',
  launch_logo: '0x258cd291f3689b9c76fc62d1def3b5b2b297dc5ec349211a7ac7f499b3c02b6',
  quote_buy: '0x14b48ce6868b115791fd52c2a56e57ac8a205144b03b21af265c85884881bde',
  create_launch: '0x385b6268c717439a1106322e5a47c12378406dc2126d7cfa29bb0d3bc88d7e0',
  series_count: '0x3e09157332ece5630a1cf543f50c10d55eb0d67c4f3f32998017c6420a5eaed',
  get_series: '0x11f1fc1fd125ad1539e312a8dd280f9a8de388238a16661fc14e7db57e62600',
  float: '0x27dc942c9fc126b5c8d7c7a7ffe83cd878f74be80b115356091dd5c1bec605e',
} as const

/** `markets.cairo`'s `SERIES_ID_BASE`: a series window's id is `(series + 1) · 2^32 + epoch`. */
export const SERIES_ID_BASE = 2 ** 32

export function seriesMarketId(seriesId: number, epoch: number): number {
  return (seriesId + 1) * SERIES_ID_BASE + epoch
}

// ── Contract state numbers, transcribed from the Cairo constants. ─────────────────────────
export const MARKET_STATE = { none: 0, active: 1, resolved: 2, voided: 3 } as const
export const LAUNCH_STATE = { none: 0, active: 1, graduated: 2, failed: 3 } as const

/** `launch.cairo`'s `UNITS_PER_EPOCH`. An epoch holds exactly sixteen units, by construction. */
export const UNITS_PER_EPOCH = 16

/** One market, decoded. Field names follow `markets.cairo`'s `Market` verbatim. */
export interface OnChainMarket {
  id: number
  /** The Pragma pair, decoded from its short string — `'BTC/USD'`. */
  pair: string
  /** The line, in Pragma's 8-decimal fixed point. */
  strike: bigint
  /** Unix seconds. */
  deadline: number
  token: string
  up: bigint
  down: bigint
  /** The constant product, fixed at seed time. What a card quotes odds against. */
  k: bigint
  seed: bigint
  collateral: bigint
  state: number
  winner: number
  experimental: boolean
  /** Seeded from the house float by a series; its residual returns there, nobody claims it. */
  house: boolean
  /** The series this window belongs to. Meaningful only when `house`. */
  series: number
  /** Σ cash_in of open bettor positions — the refund bill if the market voids. */
  openCash: bigint
  /** House vig held until settlement. Always 0 on a custom market. */
  vig: bigint
  /** The series' window length in seconds; 0 for a custom market. Filled by the reader. */
  window: number
  /** The series' vig in basis points; 0 for a custom market. Filled by the reader. */
  vigBps: number
}

/** One standing series, decoded. Field names follow `markets.cairo`'s `Series` verbatim. */
export interface OnChainSeries {
  id: number
  pair: string
  /** Seconds; windows are aligned to multiples of it. */
  window: number
  token: string
  seed: bigint
  minSources: number
  vigBps: number
  experimental: boolean
  active: boolean
}

/** One launch, decoded. Field names follow `launch.cairo`'s `LaunchInfo` verbatim. */
export interface OnChainLaunch {
  id: number
  name: string
  symbol: string
  /** `launch_logo` — empty string when the creator pointed at nothing, an `ipfs://CID` when set. */
  logoUri: string
  stakeToken: string
  /** The deployed ERC20 — zero until graduation. */
  token: string
  /** Price of one unit in epoch 0, in stake base units. */
  p0: bigint
  /** Added to the unit price with each epoch. */
  dp: bigint
  unitTokens: bigint
  epochs: number
  /** Units sold so far. `sold == epochs * UNITS_PER_EPOCH` is graduation. */
  sold: number
  raised: bigint
  deadline: number
  state: number
  swept: boolean
}

export const toBig = (felt: string): bigint => BigInt(felt)
export const toNum = (felt: string): number => Number(BigInt(felt))
export const hex = (value: number | bigint): string => `0x${BigInt(value).toString(16)}`

/** A Cairo short string — the pair id — back into ASCII. */
export function decodeShortString(felt: string): string {
  let value = BigInt(felt)
  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  return String.fromCharCode(...bytes)
}

/**
 * A string into a serialised `ByteArray` — the inverse of `decodeByteArray`, for the calldata a
 * `create_launch` carries. ASCII only by refusal: a multi-byte character would encode to different
 * bytes than the reader shows, and a token name cannot afford that ambiguity.
 */
export function encodeByteArray(text: string): string[] {
  const bytes: number[] = []
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code > 0x7f) throw new Error(`"${ch}" is not ASCII, and a ByteArray this app writes stays ASCII`)
    bytes.push(code)
  }
  const felts: string[] = []
  const fullWords = Math.floor(bytes.length / 31)
  felts.push(hex(fullWords))
  const word = (slice: number[]): string => {
    let value = 0n
    for (const b of slice) value = (value << 8n) | BigInt(b)
    return hex(value)
  }
  for (let i = 0; i < fullWords; i++) felts.push(word(bytes.slice(i * 31, i * 31 + 31)))
  const pending = bytes.slice(fullWords * 31)
  felts.push(pending.length === 0 ? '0x0' : word(pending))
  felts.push(hex(pending.length))
  return felts
}

/**
 * A serialised `ByteArray` — `[data_len, ...bytes31 words, pending_word, pending_word_len]` —
 * back into a string. Consumes from `felts` starting at `at`; returns the text and the next index,
 * because launch reads decode several of these in a row.
 */
export function decodeByteArray(felts: readonly string[], at = 0): { text: string; next: number } {
  const words = toNum(felts[at]!)
  const bytes: number[] = []
  const word31 = (felt: string, take: number) => {
    let value = BigInt(felt)
    const out: number[] = []
    while (value > 0n) {
      out.unshift(Number(value & 0xffn))
      value >>= 8n
    }
    while (out.length < take) out.unshift(0)
    return out
  }
  for (let i = 0; i < words; i++) bytes.push(...word31(felts[at + 1 + i]!, 31))
  const pendingLen = toNum(felts[at + 1 + words + 1]!)
  if (pendingLen > 0) bytes.push(...word31(felts[at + 1 + words]!, pendingLen))
  return { text: String.fromCharCode(...bytes), next: at + words + 3 }
}

/** `Market`'s 17 felts, in declaration order. Exported so the test can feed it a pinned vector. */
export function decodeMarket(id: number, felts: readonly string[]): OnChainMarket {
  if (felts.length < 17) throw new Error(`get_market returned ${felts.length} felts; Market is 17`)
  return {
    id,
    pair: decodeShortString(felts[0]!),
    strike: toBig(felts[1]!),
    deadline: toNum(felts[2]!),
    token: felts[3]!,
    up: toBig(felts[4]!),
    down: toBig(felts[5]!),
    k: toBig(felts[6]!) + (toBig(felts[7]!) << 128n),
    seed: toBig(felts[8]!),
    collateral: toBig(felts[9]!),
    state: toNum(felts[10]!),
    winner: toNum(felts[11]!),
    experimental: toBig(felts[12]!) !== 0n,
    house: toBig(felts[13]!) !== 0n,
    series: toNum(felts[14]!),
    openCash: toBig(felts[15]!),
    vig: toBig(felts[16]!),
    window: 0,
    vigBps: 0,
  }
}

/** `Series`'s 8 felts, in declaration order. */
export function decodeSeries(id: number, felts: readonly string[]): OnChainSeries {
  if (felts.length < 8) throw new Error(`get_series returned ${felts.length} felts; Series is 8`)
  return {
    id,
    pair: decodeShortString(felts[0]!),
    window: toNum(felts[1]!),
    token: felts[2]!,
    seed: toBig(felts[3]!),
    minSources: toNum(felts[4]!),
    vigBps: toNum(felts[5]!),
    experimental: toBig(felts[6]!) !== 0n,
    active: toBig(felts[7]!) !== 0n,
  }
}

/**
 * The window a series would open right now, before anyone has: state NONE, no line yet, the seed
 * on both sides. What the board shows with a countdown, and what a first bet turns real.
 */
export function unopenedWindow(series: OnChainSeries, epoch: number): OnChainMarket {
  return {
    id: seriesMarketId(series.id, epoch),
    pair: series.pair,
    strike: 0n,
    deadline: (epoch + 1) * series.window,
    token: series.token,
    up: series.seed,
    down: series.seed,
    k: series.seed * series.seed,
    seed: series.seed,
    collateral: series.seed,
    state: MARKET_STATE.none,
    winner: 255,
    experimental: series.experimental,
    house: true,
    series: series.id,
    openCash: 0n,
    vig: 0n,
    window: series.window,
    vigBps: series.vigBps,
  }
}

/** `LaunchInfo`'s 12 felts, in declaration order. */
export function decodeLaunch(
  id: number,
  felts: readonly string[],
  name: string,
  symbol: string,
  logoUri = '',
): OnChainLaunch {
  if (felts.length < 12) throw new Error(`get_launch returned ${felts.length} felts; LaunchInfo is 12`)
  return {
    id,
    name,
    symbol,
    logoUri,
    stakeToken: felts[0]!,
    token: felts[1]!,
    p0: toBig(felts[2]!),
    dp: toBig(felts[3]!),
    unitTokens: toBig(felts[4]!),
    epochs: toNum(felts[5]!),
    sold: toNum(felts[6]!),
    raised: toBig(felts[7]!),
    deadline: toNum(felts[8]!),
    // creator_commitment rides felt 9 and no surface renders it.
    state: toNum(felts[10]!),
    swept: toBig(felts[11]!) !== 0n,
  }
}
