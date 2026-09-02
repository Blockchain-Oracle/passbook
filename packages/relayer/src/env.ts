// Every environment variable the relayer reads, parsed once at boot. Garbage never becomes a
// default: a value the operator believes they set must be in force or refused by name.
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DRIP_WEI } from './faucet.js'
import { MAX_TIMER_MS } from './funding-monitor.js'
import { isAcceptableSalt } from './sponsorship-store.js'
import type { BudgetCaps } from './sponsorship.js'

/** `<repo>/.relayer/<file>` — the default home for every ledger. */
export function relayerFile(name: string): string {
  return fileURLToPath(new URL(`../../../.relayer/${name}`, import.meta.url))
}

/** Fails at startup rather than as an opaque signing error on the first request. */
export function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. The relayer cannot sign without it. Set it in the server ` +
        `environment only — never in a VITE_-prefixed variable, which ships to the browser.`,
    )
  }
  return value
}

/**
 * A whole decimal integer, or the default when blank. Only plain digits pass: `Number()` reads
 * `1e3`, `0x10` and `' 5 '` happily, and an operator would never know which one took effect.
 */
export function wholeInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  { min, max = Number.MAX_SAFE_INTEGER }: { min: number; max?: number },
): number {
  const raw = env[name] || ''
  if (!raw) return fallback
  const shape = min > 0 ? 'a positive integer' : 'a non-negative integer'
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be ${shape} in plain decimal digits, not ${JSON.stringify(raw)}`)
  }
  const n = Number(raw)
  if (!Number.isSafeInteger(n)) {
    throw new Error(
      `${name} is too large to represent exactly (${JSON.stringify(raw)}); the value that would ` +
        `take effect is ${n}, which is not what you wrote.`,
    )
  }
  if (n < min || n > max) {
    throw new Error(`${name} must be ${shape} between ${min} and ${max}, not ${JSON.stringify(raw)}`)
  }
  return n
}

export const positiveInt = (env: NodeJS.ProcessEnv, name: string, fallback: number, max?: number) =>
  wholeInt(env, name, fallback, { min: 1, max })

export const nonNegativeInt = (env: NodeJS.ProcessEnv, name: string, fallback: number, max?: number) =>
  wholeInt(env, name, fallback, { min: 0, max })

/** A short salt is worse than none, because it looks like one. Same predicate as the store's. */
export function resolveVisitorSalt(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.RELAYER_VISITOR_SALT || ''
  if (!raw) return undefined
  if (!isAcceptableSalt(raw)) {
    throw new Error(
      'RELAYER_VISITOR_SALT must be at least 32 hexadecimal characters. Generate one with ' +
        '`openssl rand -hex 32`, or leave it unset and let the store mint its own.',
    )
  }
  return raw
}

/** `||`, not `??`: a set-but-empty RELAYER_HOST must stay loopback, not bind every interface. */
export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.RELAYER_HOST || '127.0.0.1'
}

/** Exact-match set; no wildcard syntax exists. Empty = only callers that send no Origin. */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(
    (env.RELAYER_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
}

/**
 * The drip, read PER REQUEST so a `fly secrets set` retune takes effect on the restart it
 * triggers. A value that does not parse, or is not positive, falls back rather than drips garbage.
 */
export function faucetDripWei(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = env.RELAYER_FAUCET_DRIP_WEI
  if (!raw) return DRIP_WEI
  try {
    const parsed = BigInt(raw)
    return parsed > 0n ? parsed : DRIP_WEI
  } catch {
    return DRIP_WEI
  }
}

/**
 * The SHIELDED starter, in wei — the first private note a registered account is given.
 *
 * A separate number from `faucetDripWei`, which buys a deploy in public STRK. This one is
 * principal that becomes a note inside the pool, and it is bounded above by the approve ceiling:
 * the pool pulls the fee AND the deposit from the relayer in one batch, so `fee + starter` must fit
 * under `approveCeiling(fee)`. At a 6 STRK fee that leaves 6, and 3 keeps a wide margin while
 * still covering the pool fee of the user's own first self-paid transaction.
 */
const STARTER_WEI = 3_000_000_000_000_000_000n

export function starterDripWei(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = env.RELAYER_STARTER_DRIP_WEI
  if (!raw) return STARTER_WEI
  try {
    const parsed = BigInt(raw)
    return parsed > 0n ? parsed : STARTER_WEI
  } catch {
    return STARTER_WEI
  }
}

/** What must be true before running off-loopback, or null when it is loopback. */
export function offHostWarning(host: string): string | null {
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return null
  return (
    `WARNING: bound to ${host}, not loopback. This signer is reachable off-host. ` +
    `Do not run this way without authentication and rate limiting in front of it: ` +
    `the allowlist bounds what may be signed, not by whom or how often, so an ` +
    `exposed port still lets anyone spend up to the approve ceiling per submission.`
  )
}

export interface SponsorshipConfig {
  caps: BudgetCaps
  storePath: string
  sendCaps: BudgetCaps
  sendStorePath: string
  /**
   * The allowance a USER is shown and counts down — keyed by account address, not by IP.
   *
   * NOT AN ABUSE CONTROL, and it must never be mistaken for one: the address arrives in the request
   * body, so anyone willing to make a new account gets a new allowance. The IP-keyed budgets above
   * and the wallet balance below them are what actually bound the spend. This exists so a number
   * can be shown to a person and mean something to them — an IP-keyed count is wrong for anyone
   * behind shared egress, and worse, it is wrong in the direction that refuses honest users.
   */
  accountCaps: BudgetCaps
  accountStorePath: string
  /** `daily` × the drip is a literal STRK amount handed out per day, not a rate limit. */
  faucetCaps: BudgetCaps
  faucetStorePath: string
  /**
   * The brake on the SHIELDED starter, which had none.
   *
   * ── WHY THIS IS A FIFTH LEDGER AND NOT THE FAUCET'S ───────────────────────────────────────
   *
   * `/starter` bounded itself with a once-per-ACCOUNT claim and the wallet's funding floor, and
   * neither is a daily cap. The claim stops one account taking two; it does nothing about one
   * person making twenty accounts. And a registration can be SELF-paid — which spends no
   * sponsorship unit — so the sponsorship budget was not bounding it either. What was left was
   * "keep paying until the balance hits the floor", one ~12 STRK claim at a time.
   *
   * It cannot share `faucetCaps`: every new account needs both a public drip and a starter, so one
   * counter for both would halve the number of people a day's budget serves, and a spent drip
   * would refuse a starter for a reason that has nothing to do with it. Its own file, its own
   * notice — the rule this package already applies to sends versus registrations.
   *
   * LIFETIME per connection, like every other `perVisitor` here — see `resolveSponsorshipCaps`
   * for why that forces the number up rather than down. `daily` × ~12 STRK is the real spend.
   */
  starterCaps: BudgetCaps
  starterStorePath: string
  /**
   * Where the hashes awaiting a receipt are kept, so a restart still refunds a revert.
   * Not a ledger — it spends nothing and grants nothing; it only remembers what to check.
   */
  revertWatchStore: string
  opsWebhook: string | undefined
  salt: string | undefined
  /** Zero = startup check only. Bounded so Node's timer clamp cannot turn "monthly" into 1ms. */
  fundingIntervalMs: number
  quoteDailyPerVisitor: number
  quoteDailyGlobal: number
}

export function resolveSponsorshipCaps(env: NodeJS.ProcessEnv = process.env): SponsorshipConfig {
  return {
    // ── EVERY `perVisitor` BELOW IS NOW A LIFETIME ALLOCATION, NOT A DAILY ONE ────────────
    //
    // `ledger.ts` opens all four of these `lifetime`, so a connection gets its share once and
    // never again. That is the intended rule, and it changes what these NUMBERS have to be:
    // a cap of 1 meant "one a day" and now means "one, ever", and a great many real people share
    // one egress address — carrier NAT, an office, a campus, a conference. Sized as ANTI-FARM
    // ceilings a real visitor never reaches, because the controls that actually bound a person
    // are per-ACCOUNT and do not live here: three covered transactions per account, one drip per
    // address, one starting balance per address, each of them already permanent.
    caps: {
      perVisitor: positiveInt(env, 'RELAYER_SPONSOR_PER_VISITOR', 15),
      daily: positiveInt(env, 'RELAYER_SPONSOR_DAILY', 20),
    },
    storePath: env.RELAYER_SPONSOR_STORE || relayerFile('sponsorship.json'),
    // A relayed send is REIMBURSED — the user's own proof folds a `Withdraw` back to us — so this
    // costs gas alone and is the cheapest thing here. 3 was a sensible day's worth and is a
    // punishing lifetime, so it rises with the change in meaning rather than staying put.
    sendCaps: {
      perVisitor: positiveInt(env, 'RELAYER_SEND_PER_VISITOR', 30),
      daily: positiveInt(env, 'RELAYER_SEND_DAILY', 20),
    },
    sendStorePath: env.RELAYER_SEND_STORE || relayerFile('send-budget.json'),
    // Three per account: the registration takes one, two remain to spend on anything. `daily` is
    // the shared brake — 60 is ~20 accounts using all three, and the wallet runs out before it.
    accountCaps: {
      perVisitor: positiveInt(env, 'RELAYER_ACCOUNT_SPONSORED', 3),
      daily: positiveInt(env, 'RELAYER_ACCOUNT_SPONSORED_DAILY', 60),
    },
    accountStorePath: env.RELAYER_ACCOUNT_STORE || relayerFile('account-allowance.json'),
    // 20/day, not 2. The old number was sized against a 10 STRK drip, where a day's worth was
    // 20 STRK of real money; at a 2 STRK deploy-only drip the same daily spend buys ten times the
    // visitors. The sponsorship budget below is now the one that bounds an expensive day.
    // WAS 1, AND 1 WOULD NOW BE A PRODUCT BUG: one drip per connection EVER means the first
    // phone on a carrier NAT takes the only drip its whole network will ever get. The real
    // once-per-user control is the per-ADDRESS claim in the ledger's `claimed` set, which was
    // always permanent; this number only has to stop a farm.
    faucetCaps: {
      perVisitor: positiveInt(env, 'RELAYER_FAUCET_PER_VISITOR', 15),
      daily: positiveInt(env, 'RELAYER_FAUCET_DAILY', 20),
    },
    faucetStorePath: env.RELAYER_FAUCET_STORE || relayerFile('faucet.json'),
    // ── SIZED TO CAP A FARM, NOT TO RATION A DEMO ─────────────────────────────────────────
    //
    // The standing rule is that funding is handled and controls are NOT sized around a relayer
    // running dry. This ledger is not that: it exists because the starter had NO ceiling of any
    // kind — not a day's, not a connection's — so a self-funded registration could claim starting
    // balances until the wallet hit its floor. That was the leak.
    //
    // `perVisitor` is a LIFETIME anti-farm ceiling and is sized for shared egress like the rest.
    // `daily` is the backstop for a farm spread across many connections, deliberately set ABOVE
    // `RELAYER_SPONSOR_DAILY` (20) so an ordinary day of registrations can never be refused by it.
    // At ~12 STRK a claim (3 to the recipient, 6 pool fee, ~3 gas) it caps a bad day near 300 STRK
    // instead of at "whatever the wallet held".
    starterCaps: {
      perVisitor: positiveInt(env, 'RELAYER_STARTER_PER_VISITOR', 15),
      daily: positiveInt(env, 'RELAYER_STARTER_DAILY', 25),
    },
    starterStorePath: env.RELAYER_STARTER_STORE || relayerFile('starter-budget.json'),
    revertWatchStore: env.RELAYER_REVERT_WATCH_STORE || relayerFile('revert-watch.json'),
    opsWebhook: env.RELAYER_OPS_WEBHOOK || undefined,
    salt: resolveVisitorSalt(env),
    fundingIntervalMs: nonNegativeInt(env, 'RELAYER_FUNDING_INTERVAL_MS', 300_000, MAX_TIMER_MS),
    quoteDailyPerVisitor: positiveInt(env, 'RELAYER_QUOTE_DAILY_PER_VISITOR', 100),
    quoteDailyGlobal: positiveInt(env, 'RELAYER_QUOTE_DAILY_GLOBAL', 1_000),
  }
}

/** The switch-shaped variables: exact strings only, so a typo is "off", never "on". */
const blank = z.string().optional().transform((v) => v || undefined)
const switches = z.object({
  RELAYER_FAUCET: blank,
  RELAYER_CHAIN_FEED: blank,
  RELAYER_KEEPER: blank,
  RELAYER_AUTH_TOKEN: blank,
  RELAYER_DIRECTORY_STORE: blank,
  RELAYER_CHAIN_FEED_STORE: blank,
  RELAYER_PINATA_JWT: blank,
  RELAYER_GEMINI_KEY: blank,
  RELAYER_GEMINI_IMAGE_MODEL: blank,
  RELAYER_TELLER_STORE: blank,
  RELAYER_GOVERNANCE_FROM_BLOCK: blank,
  RELAYER_RECOVERY: blank,
  RELAYER_RECOVERY_STORE: blank,
  RELAYER_WEBAUTHN_ORIGINS: blank,
  PORT: blank,
})

/**
 * The browser origins passkeys are made for. The relayer never sees an Origin header (the proxy
 * strips it), so the client NAMES its origin and this list is what that name is checked against
 * before it becomes the WebAuthn origin and RP ID. Required when recovery is on: a passkey
 * service with no origin to verify against would accept a signature from anywhere.
 */
export function resolveWebAuthnOrigins(env: NodeJS.ProcessEnv, on: boolean): ReadonlySet<string> {
  const origins = new Set(
    (env.RELAYER_WEBAUTHN_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  if (!on) return origins
  if (origins.size === 0) throw new Error('RELAYER_RECOVERY=on needs RELAYER_WEBAUTHN_ORIGINS, a comma-separated list of exact browser origins')
  for (const origin of origins) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw new Error(`RELAYER_WEBAUTHN_ORIGINS entry ${JSON.stringify(origin)} is not an absolute URL`)
    }
    if (url.origin !== origin) throw new Error(`RELAYER_WEBAUTHN_ORIGINS entry ${JSON.stringify(origin)} must be a bare origin — scheme, host and port only`)
  }
  return origins
}

export interface RelayerEnv {
  address: string
  privateKey: string
  port: number
  host: string
  allowedOrigins: ReadonlySet<string>
  authToken: string | undefined
  sponsor: SponsorshipConfig
  faucetOn: boolean
  directoryStore: string
  chainFeedWanted: boolean
  chainFeedStore: string | undefined
  pinataJwt: string | undefined
  geminiKey: string | undefined
  imageModel: string | undefined
  tellerStore: string
  governanceFromBlock: number
  keeperWanted: boolean
  recoveryOn: boolean
  recoveryStore: string
  webauthnOrigins: ReadonlySet<string>
  recoveryOptionsPerVisitor: number
  recoveryOptionsDaily: number
}

/** The whole environment, resolved once. Throws the spec's refusal strings on bad input. */
export function resolveEnv(env: NodeJS.ProcessEnv = process.env): RelayerEnv {
  const address = required(env, 'RELAYER_ADDRESS')
  const privateKey = required(env, 'RELAYER_PRIVATE_KEY')
  const s = switches.parse(env)
  return {
    address,
    privateKey,
    port: Number(s.PORT ?? 8787),
    host: resolveHost(env),
    allowedOrigins: resolveAllowedOrigins(env),
    authToken: s.RELAYER_AUTH_TOKEN,
    sponsor: resolveSponsorshipCaps(env),
    faucetOn: s.RELAYER_FAUCET === 'on',
    directoryStore: s.RELAYER_DIRECTORY_STORE ?? relayerFile('directory.json'),
    chainFeedWanted: s.RELAYER_CHAIN_FEED !== 'off',
    chainFeedStore: s.RELAYER_CHAIN_FEED_STORE,
    pinataJwt: s.RELAYER_PINATA_JWT,
    geminiKey: s.RELAYER_GEMINI_KEY,
    imageModel: s.RELAYER_GEMINI_IMAGE_MODEL,
    tellerStore: s.RELAYER_TELLER_STORE ?? relayerFile('teller.json'),
    governanceFromBlock: Number(s.RELAYER_GOVERNANCE_FROM_BLOCK ?? 0),
    keeperWanted: s.RELAYER_KEEPER !== 'off',
    recoveryOn: s.RELAYER_RECOVERY === 'on',
    recoveryStore: s.RELAYER_RECOVERY_STORE ?? relayerFile('recovery.json'),
    webauthnOrigins: resolveWebAuthnOrigins(env, s.RELAYER_RECOVERY === 'on'),
    recoveryOptionsPerVisitor: positiveInt(env, 'RELAYER_RECOVERY_PER_VISITOR', 60),
    recoveryOptionsDaily: positiveInt(env, 'RELAYER_RECOVERY_DAILY', 5_000),
  }
}
