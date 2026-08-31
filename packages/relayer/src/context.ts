// The one object every route reads. Built once by `main()`, set on every request by `app.ts`.
// A feature absent here means its routes answer 404: this deployment does not offer it.
import type { Call } from 'starknet'
import type { SubmissionPolicy as AllowlistPolicy, ResourceBounds } from './allowlist.js'
import type { SponsorshipLedger } from './sponsorship.js'
import type { DailyQuoteCounter } from './quote-proxy.js'
import type { RoomHub } from './rooms.js'
import type { Directory } from './directory.js'
import type { ChainFeed } from './chain-feed.js'
import type { FundingObservation } from './funding-monitor.js'
import type { GasCalibration } from './gas-calibration.js'
import type { LogoService } from './logo.js'
import type { Teller } from './teller.js'
import type { RevertWatch } from './revert-watch.js'

export interface RelayerContext {
  submit: (calls: Call[], details?: { proofFacts: string[]; proof: string; resourceBounds?: ResourceBounds }) => Promise<string>
  policy: AllowlistPolicy
  resolveApproveCeiling: () => Promise<bigint>
  /**
   * Bounds for a proven batch that arrived without any, from live prices and our own calibration.
   *
   * NOT A CONVENIENCE. `Account.execute` estimates when bounds are absent, and an estimate cannot
   * execute the proof, so every proven batch that moves value dies inside `starknet_estimateFee`
   * instead of being signed. Backfilling here means one forgetful client cannot turn that into an
   * outage — and this side holds the better number anyway, measured off the pool's own receipts.
   */
  resolveResourceBounds: () => Promise<ResourceBounds>
  sponsorship?: SponsorshipLedger
  sendBudget?: SponsorshipLedger
  faucet?: SponsorshipLedger
  /** Keyed by ACCOUNT ADDRESS, not by hashed IP — the count a user is shown. See ledger.ts. */
  accountAllowance?: SponsorshipLedger
  /**
   * Watches the hashes this relayer broadcast and gives the meters their units back on a REVERT.
   * `/submit` hands it one entry per submission that spent something; it reads the receipt itself.
   */
  revertWatch?: RevertWatch
  feeRecipient: string
  visitorSalt: string
  quoteCounter: DailyQuoteCounter
  relayerState: () => 'ok' | 'relayer-down'
  /**
   * The funding monitor's last measurement, for `/health`. A pure accessor — never a chain read.
   * Absent when no monitor is attached, which `/health` reports as `unknown` rather than as zero.
   */
  fundingObserved?: () => FundingObservation | null
  rooms?: RoomHub
  directory?: Directory
  chainFeed?: ChainFeed
  /** Measured gas units for a proven pool transaction. Absent until the first sample lands. */
  gasCalibration?: GasCalibration
  logos?: LogoService
  teller?: Teller
}
export type AppEnv = { Variables: { ctx: RelayerContext; clientIp: string } }
