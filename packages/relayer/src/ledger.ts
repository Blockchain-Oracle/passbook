// The five money ledgers, opened before the socket does. One salt across all of them, so an
// operator reading a day can read the counters against each other.
//
// ── EVERY ONE OF THEM IS `lifetime`, AND THAT IS THE POINT ────────────────────────────────
//
// An allocation is what someone gets ONCE — not once a day. A connection that used its sponsored
// registrations, its relayed sends, its drip or its starting balances does not get another set
// tomorrow. Only the shared `dailyCount` still rolls at 00:00 UTC, because that one is a fact
// about our wallet's spending for a day rather than a rule about a person.
//
// This takes TWO things and it took a bug to learn the second: the ledger opened `lifetime` (so
// `rolledToDay` keeps the per-key map), AND a visitor id with no day mixed into it
// (`lifetimeVisitorId`). With only the first, the map is preserved and then queried under a key
// that changed at midnight, so the cap resets while every counter looks correct.
import { BUDGET_EXHAUSTED_NOTICE, SEND_CAP_NOTICE, SponsorshipLedger, VISITOR_SPENT_NOTICE } from './sponsorship.js'
import { FileSponsorshipStore } from './sponsorship-store.js'
import { DRIP_BUDGET_SPENT, DRIP_VISITOR_SPENT } from './faucet.js'
import {
  ALLOWANCE_SPENT_NOTICE,
  SEND_VISITOR_SPENT_NOTICE,
  STARTER_BUDGET_NOTICE,
  STARTER_VISITOR_SPENT_NOTICE,
} from '../../protocol/src/relayer-wire.js'
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
  // `lifetime`: a connection's sponsored registrations are its share, once. The shared daily
  // budget still resets — see the header.
  return new SponsorshipLedger(
    config.caps, store, Date.now(), BUDGET_EXHAUSTED_NOTICE, true, VISITOR_SPENT_NOTICE,
  )
}

/** Second file, same machinery, its own notice — a busy day of sends cannot spend registrations. */
export function openSendBudgetLedger(config: SponsorshipConfig, salt: string): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.sendStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  return new SponsorshipLedger(
    config.sendCaps, store, Date.now(), SEND_CAP_NOTICE, true, SEND_VISITOR_SPENT_NOTICE,
  )
}

/** Third file: its claim set is the once-per-address record, so it must never share a reset. */
export function openFaucetLedger(config: SponsorshipConfig, salt: string): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.faucetStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  return new SponsorshipLedger(
    config.faucetCaps, store, Date.now(), DRIP_BUDGET_SPENT, true, DRIP_VISITOR_SPENT,
  )
}

/**
 * Fifth file: the day's brake on the shielded starter, which until now had none.
 *
 * ── IT HOLDS A BUDGET AND NOT THE CLAIMS, WHICH IS DELIBERATE ─────────────────────────────
 *
 * The `starter:<address>` claim keys stay in the FAUCET ledger, where they were written and where
 * `/faucet/:address` still reads them. Moving them here would be tidier and would also re-open
 * every starter ever claimed: the keys live on a Fly volume, and a ledger that cannot see them
 * reports every account as unclaimed. So this file carries only the counters that did not exist
 * before, and its `claimed` set stays empty for good.
 *
 * Opened `lifetime` like every other spend ledger here: two per connection, ever. Its `daily` cap
 * is the separate, shared brake on what we hand out in one day, and that one does still reset.
 */
export function openStarterBudgetLedger(config: SponsorshipConfig, salt: string): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.starterStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  return new SponsorshipLedger(
    config.starterCaps, store, Date.now(), STARTER_BUDGET_NOTICE, true, STARTER_VISITOR_SPENT_NOTICE,
  )
}

/**
 * Fourth file: the per-ACCOUNT allowance, the one a user watches count down.
 *
 * ── IT SHARES THE SALT AND USES NONE OF IT, WHICH IS WORTH SAYING OUT LOUD ────────────────
 *
 * Every other ledger here keys on `lifetimeVisitorId(ip, salt)` — a hashed connection. This one
 * keys on the account address instead, so the salt it carries is inert. It is written anyway,
 * because `FileSponsorshipStore` records own a salt and a file whose salt disagreed with its
 * siblings would look like a re-key rather than a design choice.
 *
 * It was once the ONLY `lifetime` ledger here, back when its siblings were day-scoped rate limits.
 * They are allocations now and all five agree: three covered transactions per account, once. That
 * is the offer the onboarding screens make, and it was briefly not the offer the code kept — the
 * map used to be cleared with the day, which quietly renewed everyone's three every midnight.
 */
export function openAccountAllowanceLedger(config: SponsorshipConfig, salt: string): SponsorshipLedger {
  const store = new FileSponsorshipStore(config.accountStorePath)
  const record = store.load()
  if (record.salt !== salt) store.save({ ...record, salt })
  // `lifetime`: three per account ONCE. See `rolledToDay` — the daily brake still resets, the
  // per-account count does not. The offer the screen makes is "your first three", not "three a day".
  return new SponsorshipLedger(config.accountCaps, store, Date.now(), ALLOWANCE_SPENT_NOTICE, true)
}
