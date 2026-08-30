// The one object every route reads. Built once by `main()`, set on every request by `app.ts`.
// A feature absent here means its routes answer 404: this deployment does not offer it.
import type { Call } from 'starknet'
import type { SubmissionPolicy as AllowlistPolicy, ResourceBounds } from './allowlist.js'
import type { SponsorshipLedger } from './sponsorship.js'
import type { DailyQuoteCounter } from './quote-proxy.js'
import type { RoomHub } from './rooms.js'
import type { Directory } from './directory.js'
import type { ChainFeed } from './chain-feed.js'
import type { GasCalibration } from './gas-calibration.js'
import type { LogoService } from './logo.js'
import type { Teller } from './teller.js'

export interface RelayerContext {
  submit: (calls: Call[], details?: { proofFacts: string[]; proof: string; resourceBounds?: ResourceBounds }) => Promise<string>
  policy: AllowlistPolicy
  resolveApproveCeiling: () => Promise<bigint>
  sponsorship?: SponsorshipLedger
  sendBudget?: SponsorshipLedger
  faucet?: SponsorshipLedger
  /** Keyed by ACCOUNT ADDRESS, not by hashed IP — the count a user is shown. See ledger.ts. */
  accountAllowance?: SponsorshipLedger
  feeRecipient: string
  visitorSalt: string
  quoteCounter: DailyQuoteCounter
  relayerState: () => 'ok' | 'relayer-down'
  rooms?: RoomHub
  directory?: Directory
  chainFeed?: ChainFeed
  /** Measured gas units for a proven pool transaction. Absent until the first sample lands. */
  gasCalibration?: GasCalibration
  logos?: LogoService
  teller?: Teller
}
export type AppEnv = { Variables: { ctx: RelayerContext; clientIp: string } }
