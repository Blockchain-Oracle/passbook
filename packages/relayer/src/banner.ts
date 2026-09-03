// The boot banner, line for line. Every line is a fact an operator would otherwise curl for.
import { NET } from '../../protocol/src/constants.js'
import type { AppContracts, GovernanceWriteSafety } from '../../protocol/src/app-contracts.js'
import { APP_POLL_MS, HISTORY_BOUND, PRICE_POLL_MS, type ChainFeed } from './chain-feed.js'
import { offHostWarning, type SponsorshipConfig } from './env.js'
import type { FundingMonitor } from './funding-monitor.js'
import { KEEPER_CRON } from './keeper.js'
import type { LogoService } from './logo.js'
import { PROXY_TARGETS } from './quote-proxy.js'
import { ROOM_HISTORY, ROOM_IDLE_MS } from './rooms.js'
import { TELLER_INTERVAL_MS, type Teller } from './teller.js'
import type { RecoveryService } from './recovery.js'

export interface BannerInput {
  host: string
  port: number
  address: string
  nodeUrl: string
  appContracts: AppContracts
  governanceSafety: GovernanceWriteSafety
  keeperWanted: boolean
  keeperReady: boolean
  keeperNextRun: string | null
  allowedOrigins: ReadonlySet<string>
  sponsor: SponsorshipConfig
  feedWanted: boolean
  chainFeed: ChainFeed | undefined
  chainFeedStore: string | undefined
  logos: LogoService | undefined
  teller: Teller | undefined
  tellerStore: string
  faucetOn: boolean
  faucetDripWei: bigint
  monitor: FundingMonitor
  recovery: RecoveryService | undefined
  recoveryStore: string
  webauthnOrigins: ReadonlySet<string>
}

export function printBanner(b: BannerInput): void {
  const { appContracts: app, sponsor } = b
  console.log(`relayer listening on ${b.host}:${b.port}, submitting as ${b.address} via ${b.nodeUrl}`)
  console.log(`allowlist: pool ${NET.pool} · STRK approve-to-pool only`)
  console.log(
    app.markets
      ? `allowlist: Markets ${app.markets}${app.launch ? ` · Launch ${app.launch}` : ''}${app.governance ? ` · Governance ${app.governance}` : ''}`
      : 'allowlist: no Markets/Launch deployed yet',
  )
  if (!b.governanceSafety.enabled && app.governance) {
    console.log(`governance: read-only — ${b.governanceSafety.because}`)
  }
  console.log(
    b.keeperReady
      ? `keeper: cron ${KEEPER_CRON} UTC (next ${b.keeperNextRun ?? '?'}) via Pragma ${app.pragma} — reads first, sends only for a due window somebody opened`
      : b.keeperWanted
        ? 'keeper: idle — nothing deployed to keep'
        : 'keeper: disabled by RELAYER_KEEPER=off',
  )
  console.log(
    b.allowedOrigins.size
      ? `origins: ${[...b.allowedOrigins].join(', ')}`
      : 'origins: none — only callers that send no Origin header',
  )
  console.log(
    `sponsorship: ${sponsor.caps.perVisitor}/visitor LIFETIME · ${sponsor.caps.daily}/day · ledger ${sponsor.storePath}`,
  )
  console.log(
    `plain sends: ${sponsor.sendCaps.perVisitor}/visitor LIFETIME · ${sponsor.sendCaps.daily}/day · ` +
      `ledger ${sponsor.sendStorePath} · fee recipient ${b.address}`,
  )
  // Said out loud because it is the one piece of state a user might assume this process lacks.
  // Chat's backlog lives here and nowhere else; Mail's memos live on chain and never pass through.
  console.log(
    `rooms: ciphertext only, in memory · ${ROOM_HISTORY} messages kept per room · ` +
      `idle rooms dropped after ${ROOM_IDLE_MS / 60_000} minutes`,
  )
  console.log(
    b.chainFeed
      ? `chain feed: app reads every ${APP_POLL_MS / 1000}s · prices every ${PRICE_POLL_MS / 1000}s · ` +
          `history ${HISTORY_BOUND}/pair · ` +
          `${b.chainFeedStore ? `store ${b.chainFeedStore}` : 'NO STORE — history resets on deploy'} · ` +
          `warmed ${b.chainFeed.stats().historyPoints} points`
      : b.feedWanted
        ? 'chain feed: idle — nothing deployed to stream'
        : 'chain feed: disabled by RELAYER_CHAIN_FEED=off',
  )
  console.log(
    b.logos
      ? `logo studio: pin ${b.logos.pinataJwt ? 'on (20/visitor · 200/day)' : 'OFF — no RELAYER_PINATA_JWT'} · ` +
          `generate ${b.logos.geminiKey ? `on via ${b.logos.imageModel ?? 'gemini-2.5-flash-image'} (10/visitor · 100/day)` : 'OFF — no RELAYER_GEMINI_KEY'}`
      : 'logo studio: off — set RELAYER_PINATA_JWT / RELAYER_GEMINI_KEY to offer it',
  )
  console.log(
    b.teller
      ? `teller: holding ${b.teller.keyCount()} tally key(s) · sweeping every ${TELLER_INTERVAL_MS / 1000}s · ` +
          `ledger ${b.tellerStore}`
      : 'teller: off — no Governance contract deployed',
  )
  console.log(
    b.recovery
      ? `recovery: ON — ${b.recovery.stats().vaults} vault(s) · passkeys for ${[...b.webauthnOrigins].join(', ')} · ledger ${b.recoveryStore}`
      : 'recovery: off — set RELAYER_RECOVERY=on and RELAYER_WEBAUTHN_ORIGINS to offer passkeys',
  )
  console.log(
    b.faucetOn
      ? `faucet: ON — drip ${b.faucetDripWei} wei, ${sponsor.faucetCaps.perVisitor}/visitor LIFETIME, ` +
          `${sponsor.faucetCaps.daily}/day global · ledger ${sponsor.faucetStorePath} — the drip IS the subsidy (M8)\n` +
          `  starter: ${sponsor.starterCaps.perVisitor}/visitor LIFETIME · ${sponsor.starterCaps.daily}/day global · ` +
          `ledger ${sponsor.starterStorePath} — ~12 STRK a claim, so this line is the day's real spend`
      : 'faucet: off — set RELAYER_FAUCET=on to drip starter STRK (spends principal; the drip stakes the whole journey)',
  )
  console.log(
    `funding: STRK balance ${b.monitor.health()} · ` +
      `${sponsor.fundingIntervalMs ? `polling every ${sponsor.fundingIntervalMs}ms` : 'startup check only'} · ` +
      `pages to ${sponsor.opsWebhook ?? 'the log'}`,
  )
  if (b.monitor.userState() === 'relayer-down') {
    console.warn('  submissions are being REFUSED until the relayer wallet is topped up.')
  }
  console.log(
    `proxy: ${Object.values(PROXY_TARGETS).map((t) => t.host).join(', ')} · ` +
      `${sponsor.quoteDailyPerVisitor} quotes/visitor/day · ${sponsor.quoteDailyGlobal}/day overall`,
  )
  const warning = offHostWarning(b.host)
  if (warning) console.warn(warning)
}
