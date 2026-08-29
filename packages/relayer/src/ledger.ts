// The three money ledgers, opened before the socket does. One salt across all of them, so an
// operator reading a day can read the counters against each other.
import { SEND_CAP_NOTICE, SponsorshipLedger } from './sponsorship.js'
import { FileSponsorshipStore } from './sponsorship-store.js'
import { DRIP_BUDGET_SPENT } from './faucet.js'
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
