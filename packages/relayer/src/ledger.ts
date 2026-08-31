// The four money ledgers, opened before the socket does. One salt across all of them, so an
// operator reading a day can read the counters against each other.
import { SEND_CAP_NOTICE, SponsorshipLedger } from './sponsorship.js'
import { FileSponsorshipStore } from './sponsorship-store.js'
import { DRIP_BUDGET_SPENT } from './faucet.js'
import { ALLOWANCE_SPENT_NOTICE } from '../../protocol/src/relayer-wire.js'
import type { SponsorshipConfig } from './env.js'

export { atomicWriteJson } from './sponsorship-store.js'

/**
 * The store mints its own salt on first boot. `RELAYER_VISITOR_SALT` overrides it deliberately;
 * writing a new salt re-keys every visitor id, so today's per-visitor counters stop matching.
 */
export function openSponsorshipLedger(config: SponsorshipConfig): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.storePath)
  if (config.salt) {
    const record = store.load()
    if (record.salt !== config.salt) store.save({ ...record, salt: config.salt })
  }
  return new SponsorshipLedger(config.caps, store)
}

/** Second file, same machinery, its own notice — a busy day of sends cannot spend registrations. */
export function openSendBudgetLedger(config: SponsorshipConfig, salt: string): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.sendStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  return new SponsorshipLedger(config.sendCaps, store, Date.now(), SEND_CAP_NOTICE)
}

/** Third file: its claim set is the once-per-address record, so it must never share a reset. */
export function openFaucetLedger(config: SponsorshipConfig, salt: string): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.faucetStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  return new SponsorshipLedger(config.faucetCaps, store, Date.now(), DRIP_BUDGET_SPENT)
}

/**
 * Fourth file: the per-ACCOUNT allowance, the one a user watches count down.
 *
 * ── IT SHARES THE SALT AND USES NONE OF IT, WHICH IS WORTH SAYING OUT LOUD ────────────────
 *
 * Every other ledger here keys on `visitorId(ip, salt, day)` — hashed, day-scoped, and reset every
 * midnight by construction. This one keys on the account address instead, so the salt it carries is
 * inert. It is written anyway, because `FileSponsorshipStore` records own a salt and a file whose
 * salt disagreed with its siblings would look like a re-key rather than a design choice.
 *
 * The consequence to hold in mind: these keys are NOT day-scoped the way a visitor id is, AND this
 * ledger is opened `lifetime`, so the per-account count does not reset at 00:00 UTC either. Three
 * covered transactions per account, once. That is the offer the onboarding screens make, and it was
 * briefly not the offer the code kept — the map used to be cleared with the day, which quietly
 * renewed everyone's three every midnight.
 */
export function openAccountAllowanceLedger(config: SponsorshipConfig, salt: string): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.accountStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  // `lifetime`: three per account ONCE. See `rolledToDay` — the daily brake still resets, the
  // per-account count does not. The offer the screen makes is "your first three", not "three a day".
  return new SponsorshipLedger(config.accountCaps, store, Date.now(), ALLOWANCE_SPENT_NOTICE, true)
}
