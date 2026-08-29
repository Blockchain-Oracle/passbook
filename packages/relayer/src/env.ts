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
  /** `daily` × the drip is a literal STRK amount handed out per day, not a rate limit. */
  faucetCaps: BudgetCaps
  faucetStorePath: string
  opsWebhook: string | undefined
  salt: string | undefined
  /** Zero = startup check only. Bounded so Node's timer clamp cannot turn "monthly" into 1ms. */
  fundingIntervalMs: number
  quoteDailyPerVisitor: number
  quoteDailyGlobal: number
}

export function resolveSponsorshipCaps(env: NodeJS.ProcessEnv = process.env): SponsorshipConfig {
  return {
    caps: {
      perVisitor: positiveInt(env, 'RELAYER_SPONSOR_PER_VISITOR', 1),
      daily: positiveInt(env, 'RELAYER_SPONSOR_DAILY', 20),
    },
    storePath: env.RELAYER_SPONSOR_STORE || relayerFile('sponsorship.json'),
    sendCaps: {
      perVisitor: positiveInt(env, 'RELAYER_SEND_PER_VISITOR', 3),
      daily: positiveInt(env, 'RELAYER_SEND_DAILY', 20),
    },
    sendStorePath: env.RELAYER_SEND_STORE || relayerFile('send-budget.json'),
    faucetCaps: {
      perVisitor: positiveInt(env, 'RELAYER_FAUCET_PER_VISITOR', 1),
      daily: positiveInt(env, 'RELAYER_FAUCET_DAILY', 2),
    },
    faucetStorePath: env.RELAYER_FAUCET_STORE || relayerFile('faucet.json'),
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
  PORT: blank,
})

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
  }
}
