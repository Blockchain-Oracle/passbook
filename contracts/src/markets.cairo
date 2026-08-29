//! Passbook Markets — binary UP/DOWN prediction markets on a constant-product AMM (FPMM),
//! settled from Pragma, funded and paid through the StarkWare privacy pool.
//!
//! ── WHY FPMM AND NOT A POT ───────────────────────────────────────────────────────────────
//!
//! A parimutuel pot cannot tell you what you will be paid, because your payout depends on money
//! that has not arrived yet: a late $100 bet dilutes an early $20 bet several-fold. That is not a
//! presentation problem, it is the mechanism being wrong, and it is the defect the rival build
//! shipped. Here the deal is struck at bet time — the ticket count you are quoted is the ticket
//! count you are stored with, and nothing anyone does afterwards changes it. What DOES move is the
//! visible price, on every single trade, which is the information-aggregation property the RFP is
//! actually asking for. It also works with one bettor at 3am, because the machine is always the
//! counterparty.
//!
//! ── THE MACHINE, IN ONE PARAGRAPH ────────────────────────────────────────────────────────
//!
//! A market opens with a seed `s`: collateral `C = s`, reserves `up = down = s`, and an invariant
//! `k = s·s`. Buying `b` on UP drops `b` into BOTH reserves and then removes UP tickets until the
//! product is back to `k`: `tickets = (up+b) − ceil(k / (down+b))`. The `ceil` rounds the reserve
//! UP, which rounds tickets DOWN — every rounding decision in this file goes against the bettor
//! and in favour of the pot, so the books can never come up short. At settlement a winning ticket
//! pays exactly 1, and the seeder takes what is left in the winning reserve.
//!
//! ── WHY THAT CLOSES EXACTLY ──────────────────────────────────────────────────────────────
//!
//! The invariant that makes this safe is `reserve_side + tickets_outstanding_side == C`, and it
//! holds after every operation. Seeding: `s + 0 == s`. Buying `b` on UP: the reserve gains `b` and
//! loses `tickets` while outstanding tickets gain the same `tickets`, so the sum gains exactly `b`
//! — and `C` gained exactly `b`. Buying `b` on DOWN: the UP reserve gains `b`, UP tickets are
//! untouched, `C` gains `b`. So when UP wins, total payouts are `tickets_up` (to bettors, 1:1) plus
//! `up` (to the seeder) `== C`. Not approximately: exactly. `conservation_holds_across_a_full_...`
//! in the test crate asserts it to the felt.
//!
//! ── POSITIONS ARE BEARER COMMITMENTS ─────────────────────────────────────────────────────
//!
//! Storing a position against an address would publish the bettor, which is the one thing this
//! whole product exists to avoid. Instead the client picks a secret, stores `poseidon(secret)`
//! here, and later reveals the secret to claim. The contract never learns who bet; it only learns
//! that whoever is claiming knew the secret. The wallet is already client-held bearer state, so
//! this adds no new way to lose money that holding notes did not already carry.
//!
//! ── WHAT IS DELIBERATELY NOT CLAIMED ─────────────────────────────────────────────────────
//!
//! Amounts and odds are PUBLIC. Open notes are plaintext by construction and `BetPlaced` carries
//! the stake in the clear — the anonymity on offer is identity, never amount. Anyone reading this
//! contract can reconstruct the full order flow; they just cannot say whose it is.
//!
//! ── STANDING SERIES: MARKETS EXIST BY CONSTRUCTION ───────────────────────────────────────
//!
//! v1 needed someone to create every market through the pool (one 6 STRK fee each), so the board
//! was empty whenever nobody had. v2 adds series: "BTC/USD, every hour". A series' market for the
//! current window has an id by arithmetic — `(series+1)·2^32 + now/window` — and a deadline at
//! the window's end, before anyone has touched it. The first bet opens it: the line is Pragma's
//! median at that moment, and the seed comes from a house float that was funded once, publicly,
//! with a plain `transfer_from`. When the window settles, the house residual flows back into the
//! float for the next one. A window nobody bet on never exists, so there is nothing to resolve.
//!
//! The steward (constructor argument) adds series, can retire one, and can withdraw IDLE float.
//! Nothing else: positions, opened markets and settlement are as permissionless as in v1.

use starknet::ContractAddress;

/// A single binary market. Public so the web client can decode `get_market` without a
/// hand-written ABI.
///
/// `collateral` is the whole pot — seed plus every stake taken since, minus what cash-outs took
/// back out. `open_cash` is what the OPEN bettor positions paid in: the refund bill if the market
/// voids. The two are not one number split in two, because a cash-out moves `collateral` by the
/// machine's price and `open_cash` by the position's cost — the difference is the seeder's gain
/// or loss, and a void that ignored it would refund more than the pot holds.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Market {
    /// Pragma pair id, e.g. 'BTC/USD'.
    pub pair_id: felt252,
    /// The line, in Pragma's 8-decimal fixed point. Settles UP strictly above, DOWN at or below.
    pub strike: u128,
    pub deadline: u64,
    /// Stake token. One per market; a market never mixes.
    pub token: ContractAddress,
    pub up: u128,
    pub down: u128,
    /// The constant product, fixed at seed time and never rewritten. Rounding makes the live
    /// product drift ABOVE `k`, which is the pot quietly keeping the dust.
    pub k: u256,
    pub seed: u128,
    pub collateral: u128,
    pub state: u8,
    /// Only meaningful when `state == MARKET_RESOLVED`; `WINNER_UNSET` until then.
    pub winner: u8,
    /// A short-window market, allowed to exist only because it is labelled as a coin-flip against
    /// the oracle's update cadence. See `MIN_WINDOW_EXPERIMENTAL`.
    pub experimental: bool,
    /// Seeded from the house float by a series. Its residual returns to the float; there is no
    /// seeder position to claim. Appended last: the web codec reads this struct by position.
    pub house: bool,
    /// The series this window belongs to. Meaningful only when `house`.
    pub series: u32,
    /// Σ `cash_in` of open bettor positions — what a void refunds. Never counts the seed.
    pub open_cash: u128,
    /// House vig collected from stakes, held here until settlement: to the float on resolve,
    /// back to the bettors (inside their `cash_in`) on void. Always 0 on a custom market.
    pub vig: u128,
}

/// A standing market: one window after another, each opened by its first bet.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Series {
    pub pair_id: felt252,
    /// Window length in seconds; windows are aligned to multiples of it (hours on the hour).
    pub window: u64,
    pub token: ContractAddress,
    /// House liquidity per window, drawn from the float at open and returned at settlement.
    pub seed: u128,
    /// Fewest Pragma sources a line or a settlement may rest on; thinner voids and refunds.
    pub min_sources: u32,
    /// The house's edge on every stake, in basis points. An oracle-lagged 50/50 machine loses on
    /// expectation to anyone watching a live price; the vig is what keeps the float alive.
    pub vig_bps: u32,
    pub experimental: bool,
    /// A retired series opens no new windows; its open ones settle as normal.
    pub active: bool,
}

/// A bearer claim on a market, keyed by `poseidon(secret)`.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Position {
    pub market_id: u64,
    /// `SIDE_DOWN`, `SIDE_UP`, or `SIDE_SEED`.
    pub side: u8,
    /// Winning tickets, paid 1:1. Always 0 for a seed position, which is paid the residual.
    pub tickets: u128,
    /// What was paid in — the refund amount if the market voids.
    pub cash_in: u128,
    pub state: u8,
}

#[starknet::interface]
pub trait IMarkets<TContractState> {
    /// The single pool-facing entrypoint. The privacy pool calls the fixed selector
    /// `privacy_invoke` and deserialises whatever comes back into `Span<OpenNoteDeposit>`, so
    /// every operation is multiplexed through one signature and dispatched on `op`.
    fn privacy_invoke(
        ref self: TContractState, op: felt252, payload: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
    fn resolve(ref self: TContractState, market_id: u64);
    fn void(ref self: TContractState, market_id: u64);
    fn quote_bet(self: @TContractState, market_id: u64, side: u8, amount: u128) -> u128;
    fn quote_cashout(self: @TContractState, commitment: felt252) -> u128;
    fn preview_claim(self: @TContractState, commitments: Span<felt252>) -> Span<u128>;
    fn get_market(self: @TContractState, market_id: u64) -> Market;
    fn get_position(self: @TContractState, commitment: felt252) -> Position;
    fn market_count(self: @TContractState) -> u64;
    fn pool(self: @TContractState) -> ContractAddress;
    fn pragma(self: @TContractState) -> ContractAddress;

    // ── Standing series and the house float ─────────────────────────────────────────────
    /// Anyone may fund the float: `amount` is pulled from the caller by `transfer_from`.
    fn fund_float(ref self: TContractState, token: ContractAddress, amount: u128);
    /// Steward only, idle float only — never a seed that is out in an open window.
    fn withdraw_float(
        ref self: TContractState, token: ContractAddress, amount: u128, to: ContractAddress,
    );
    /// `token` must be the stake token fixed at construction. `vig_bps` ≤ `MAX_VIG_BPS`.
    fn add_series(
        ref self: TContractState,
        pair_id: felt252,
        window: u64,
        token: ContractAddress,
        seed: u128,
        min_sources: u32,
        vig_bps: u32,
        experimental: bool,
    ) -> u32;
    fn set_series_active(ref self: TContractState, series_id: u32, active: bool);
    /// Two steps, so a mistyped address cannot strand the float: propose, then the new steward accepts.
    fn propose_steward(ref self: TContractState, steward: ContractAddress);
    fn accept_steward(ref self: TContractState);
    fn get_series(self: @TContractState, series_id: u32) -> Series;
    fn series_count(self: @TContractState) -> u32;
    /// The window a bet placed now would land in: `(market_id, epoch, deadline, state)`.
    /// `state` is `MARKET_NONE` until the first bet opens it.
    fn current_market(self: @TContractState, series_id: u32) -> (u64, u64, u64, u8);
    fn market_id_for(self: @TContractState, series_id: u32, epoch: u64) -> u64;
    fn float(self: @TContractState, token: ContractAddress) -> u128;
    fn steward(self: @TContractState) -> ContractAddress;
    fn pending_steward(self: @TContractState) -> ContractAddress;
    /// The one token a series may stake in. Fixed at construction so no steward can point a
    /// window at a token whose `balance_of` lies.
    fn stake_token(self: @TContractState) -> ContractAddress;
}

use strk20_app::pool_types::OpenNoteDeposit;

#[starknet::contract]
pub mod Markets {
    use core::num::traits::{Sqrt, Zero};
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use strk20_app::batch::{approve_batch_totals, first_occurrence_total, read_batch_len};
    use strk20_app::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use strk20_app::pool_types::OpenNoteDeposit;
    use strk20_app::pragma::{DataType, IPragmaABIDispatcher, IPragmaABIDispatcherTrait};
    use super::{Market, Position, Series};

    // ── Operation codes, dispatched by `privacy_invoke` ──────────────────────────────────
    pub const OP_CREATE: felt252 = 1;
    pub const OP_BET: felt252 = 2;
    pub const OP_CASHOUT: felt252 = 3;
    pub const OP_CLAIM: felt252 = 4;

    // ── Market lifecycle. `MARKET_NONE` is what an unknown id reads back as, which is why the
    //    states start at 1 rather than 0. ─────────────────────────────────────────────────
    pub const MARKET_NONE: u8 = 0;
    pub const MARKET_ACTIVE: u8 = 1;
    pub const MARKET_RESOLVED: u8 = 2;
    pub const MARKET_VOIDED: u8 = 3;

    // ── Position lifecycle. Same trick: `POS_NONE` doubles as "this commitment is unused",
    //    which is how commitment reuse is detected without a second map. ──────────────────
    pub const POS_NONE: u8 = 0;
    pub const POS_OPEN: u8 = 1;
    pub const POS_CLAIMED: u8 = 2;

    pub const SIDE_DOWN: u8 = 0;
    pub const SIDE_UP: u8 = 1;
    /// The seeder's position. Not a side anyone can bet — it is paid the residual, not tickets.
    pub const SIDE_SEED: u8 = 2;
    /// `winner` before resolution. Deliberately not 0, because 0 is a real answer (DOWN).
    pub const WINNER_UNSET: u8 = 255;

    // ── `Claimed.kind`, so the activity feed can label a payout without re-deriving it ────
    pub const CLAIM_WIN: u8 = 1;
    pub const CLAIM_RESIDUAL: u8 = 2;
    pub const CLAIM_REFUND: u8 = 3;

    /// How long after the deadline `resolve` stays open. Past this the price being read has
    /// drifted too far from the moment the market was about, and voiding is the honest answer.
    pub const RESOLVE_WINDOW: u64 = 300;
    /// How stale Pragma's own `last_updated_timestamp` may be, measured back from the deadline.
    /// The Day-0 read caught the feed holding one timestamp for eleven minutes, so this guard
    /// fires in real life — it is not decoration.
    pub const ORACLE_MAX_LAG: u64 = 120;
    /// After this, anyone may void an unresolved market and everyone takes their money back.
    pub const VOID_AFTER: u64 = 600;
    /// Pragma publishes spot prices with 8 decimals; `strike` is recorded in the same units.
    /// If the feed ever changes shape, settlement stops rather than comparing two different
    /// scales — and `void` is waiting 300 seconds later.
    pub const STRIKE_DECIMALS: u32 = 8;

    /// The shortest market anyone may open. Pragma's median update gap is 2–4 minutes with
    /// observed 30-minute dead periods, so four out of five one-minute markets would settle on a
    /// price that never moved. One hour is the honest floor; 15 minutes is allowed only under the
    /// `experimental` flag, where the void-and-refund rule is the whole safety net. Enforcing this
    /// here rather than in the UI turns a disclaimer into something a judge can verify.
    pub const MIN_WINDOW_STANDARD: u64 = 3600;
    pub const MIN_WINDOW_EXPERIMENTAL: u64 = 900;

    /// Series market ids are `(series + 1) * SERIES_ID_BASE + epoch`; custom markets count up
    /// from 0 and never reach the base, so an id says which kind it is.
    pub const SERIES_ID_BASE: u64 = 0x100000000;
    /// How old Pragma's median may be when it becomes a window's line. The opener chooses the
    /// moment, and a line an hour behind a live price is a gift to whoever is watching one;
    /// five minutes is the feed's own cadence (median update gap measured at 2–4 minutes).
    pub const OPEN_MAX_LAG: u64 = 300;
    /// A window cannot open in its last quarter: a line taken minutes before the deadline is a
    /// coin toss on the oracle's cadence, not a market.
    pub const OPEN_LEAD_DIVISOR: u64 = 4;
    /// The stake that opens a window must be at least `seed / OPEN_MIN_STAKE_DIVISOR`: a 1-wei
    /// bet must not be able to lock every series' seed out of the float at the top of each epoch.
    pub const OPEN_MIN_STAKE_DIVISOR: u128 = 100;
    /// Vig is in basis points of the stake, capped so a series cannot be a fee trap.
    pub const MAX_VIG_BPS: u32 = 500;
    pub const BPS: u128 = 10_000;

    #[storage]
    struct Storage {
        pool: ContractAddress,
        pragma: ContractAddress,
        next_market_id: u64,
        markets: Map<u64, Market>,
        positions: Map<felt252, Position>,
        /// Custody ledger: how much of our balance is already spoken for. Funds arriving from
        /// the pool are recognised as `balance_of(self) - accounted[token]`, which is why nobody
        /// can open a market or place a bet with money they did not actually send.
        accounted: Map<ContractAddress, u256>,
        steward: ContractAddress,
        pending_steward: ContractAddress,
        /// The only token a series may stake in.
        stake_token: ContractAddress,
        series: Map<u32, Series>,
        series_count: u32,
        /// House liquidity not currently out in a window. Always inside `accounted`.
        float: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        MarketCreated: MarketCreated,
        BetPlaced: BetPlaced,
        MarketResolved: MarketResolved,
        MarketVoided: MarketVoided,
        Claimed: Claimed,
        CashedOut: CashedOut,
        SeriesAdded: SeriesAdded,
        SeriesActive: SeriesActive,
        MarketOpened: MarketOpened,
        FloatFunded: FloatFunded,
        FloatWithdrawn: FloatWithdrawn,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SeriesAdded {
        pub series_id: u32,
        pub pair_id: felt252,
        pub window: u64,
        pub token: ContractAddress,
        pub seed: u128,
        pub min_sources: u32,
        pub vig_bps: u32,
        pub experimental: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SeriesActive {
        pub series_id: u32,
        pub active: bool,
    }

    /// A series window opened by its first bet. `strike` is the line the bettors are on.
    #[derive(Drop, starknet::Event)]
    pub struct MarketOpened {
        pub market_id: u64,
        pub series_id: u32,
        pub epoch: u64,
        pub strike: u128,
        pub deadline: u64,
        pub seed: u128,
        pub oracle_ts: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FloatFunded {
        pub token: ContractAddress,
        pub amount: u128,
        pub from: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FloatWithdrawn {
        pub token: ContractAddress,
        pub amount: u128,
        pub to: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketCreated {
        #[key]
        pub market_id: u64,
        pub pair_id: felt252,
        pub strike: u128,
        pub deadline: u64,
        pub token: ContractAddress,
        pub seed: u128,
        pub commitment: felt252,
        pub experimental: bool,
    }

    /// The market's whole public history. `amount` is what feeds the denomination-anonymity
    /// counts the UI shows — read off events by the existing crowd-rpc reader, so round
    /// denominations cost nothing on-chain to encourage.
    #[derive(Drop, starknet::Event)]
    pub struct BetPlaced {
        #[key]
        pub market_id: u64,
        pub side: u8,
        pub amount: u128,
        pub tickets: u128,
        pub up_after: u128,
        pub down_after: u128,
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketResolved {
        #[key]
        pub market_id: u64,
        pub winner: u8,
        pub settle_price: u128,
        /// Pragma's own timestamp, not ours — published so anyone can audit how fresh the
        /// settling price really was.
        pub oracle_ts: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MarketVoided {
        #[key]
        pub market_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        #[key]
        pub commitment: felt252,
        pub market_id: u64,
        pub amount: u128,
        pub kind: u8,
    }

    /// A position sold back to the machine before the deadline. `tickets` is what was handed in
    /// and `amount` what was paid for them, so the feed can show the gain or loss without
    /// re-deriving the curve.
    #[derive(Drop, starknet::Event)]
    pub struct CashedOut {
        #[key]
        pub commitment: felt252,
        pub market_id: u64,
        pub tickets: u128,
        pub amount: u128,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        pool: ContractAddress,
        pragma: ContractAddress,
        steward: ContractAddress,
        stake_token: ContractAddress,
    ) {
        assert(steward.is_non_zero(), 'ZERO_STEWARD');
        assert(stake_token.is_non_zero(), 'ZERO_TOKEN');
        self.steward.write(steward);
        self.stake_token.write(stake_token);
        assert(pool.is_non_zero(), 'ZERO_POOL');
        assert(pragma.is_non_zero(), 'ZERO_PRAGMA');
        self.pool.write(pool);
        self.pragma.write(pragma);
    }

    #[abi(embed_v0)]
    impl MarketsImpl of super::IMarkets<ContractState> {
        fn privacy_invoke(
            ref self: ContractState, op: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            if op == OP_CREATE {
                self.op_create(payload)
            } else if op == OP_BET {
                self.op_bet(payload)
            } else if op == OP_CASHOUT {
                self.op_cashout(payload)
            } else if op == OP_CLAIM {
                self.op_claim(payload)
            } else {
                core::panic_with_felt252('UNKNOWN_OP')
            }
        }

        /// Permissionless on purpose. Settlement reads a public oracle and writes an answer that
        /// is a pure function of the chain's own state, so there is nothing here for a privileged
        /// caller to be trusted with — and a keeper that goes down must not be able to strand
        /// anyone's money. Anyone can settle; nobody can settle it wrong.
        fn resolve(ref self: ContractState, market_id: u64) {
            let mut market = self.markets.read(market_id);
            assert(market.state == MARKET_ACTIVE, 'MARKET_NOT_ACTIVE');

            let now = get_block_timestamp();
            assert(now >= market.deadline, 'TOO_EARLY');
            assert(now <= market.deadline + RESOLVE_WINDOW, 'TOO_LATE');

            let response = IPragmaABIDispatcher { contract_address: self.pragma.read() }
                .get_data_median(DataType::SpotEntry(market.pair_id));

            assert(response.price != 0, 'ORACLE_NO_PRICE');
            assert(response.decimals == STRIKE_DECIMALS, 'ORACLE_DECIMALS');
            // Written as an addition rather than `>= deadline - ORACLE_MAX_LAG` because a market
            // whose deadline is under 120 would underflow u64 and settle on anything.
            assert(
                response.last_updated_timestamp + ORACLE_MAX_LAG >= market.deadline, 'ORACLE_STALE',
            );

            if market.house {
                // A house line rests on real sources; a thin feed at settlement voids instead.
                let series = self.series.read(market.series);
                assert(response.num_sources_aggregated >= series.min_sources, 'ORACLE_THIN');
            }

            let winner = if response.price > market.strike {
                SIDE_UP
            } else {
                SIDE_DOWN
            };
            market.state = MARKET_RESOLVED;
            market.winner = winner;
            self.markets.write(market_id, market);

            if market.house {
                // The house residual — what a seeder would claim — plus the vig go straight
                // back to the float for the next window. Still inside `accounted`; only the
                // label moves. Winning tickets + this == collateral, exactly.
                let residual = if winner == SIDE_UP {
                    market.up
                } else {
                    market.down
                };
                self
                    .float
                    .write(market.token, self.float.read(market.token) + residual + market.vig);
            }

            self
                .emit(
                    MarketResolved {
                        market_id,
                        winner,
                        settle_price: response.price,
                        oracle_ts: response.last_updated_timestamp,
                    },
                );
        }

        /// The escape hatch, and the reason short markets are allowed to exist at all. If the
        /// oracle was stale through the whole resolve window, or nobody called `resolve` in time,
        /// every position becomes refundable at exactly what it paid in. Permissionless, because a
        /// refund switch only the operator can pull is not a refund.
        fn void(ref self: ContractState, market_id: u64) {
            let mut market = self.markets.read(market_id);
            assert(market.state == MARKET_ACTIVE, 'MARKET_NOT_ACTIVE');
            assert(get_block_timestamp() > market.deadline + VOID_AFTER, 'TOO_EARLY');

            market.state = MARKET_VOIDED;
            self.markets.write(market_id, market);
            if market.house {
                // Every open bettor is refunded at cost through `op_claim`; whatever the pot
                // holds beyond that bill is the house's — its seed, less what early leavers took
                // out at a gain, plus what they left behind at a loss. Never `seed` itself: a
                // cash-out has already moved the pot, and refunding as if it had not would pay
                // out more than the contract holds.
                self
                    .float
                    .write(market.token, self.float.read(market.token) + void_residual(market));
            }
            self.emit(MarketVoided { market_id });
        }

        /// What `amount` would buy right now. Total by construction — a quote that panics is a
        /// quote the UI cannot render, so anything unbettable quotes as 0 tickets.
        fn quote_bet(self: @ContractState, market_id: u64, side: u8, amount: u128) -> u128 {
            if amount == 0 {
                return 0;
            }
            if side != SIDE_UP && side != SIDE_DOWN {
                return 0;
            }
            let now = get_block_timestamp();
            let market = self.markets.read(market_id);
            if market.state == MARKET_ACTIVE {
                if now >= market.deadline {
                    return 0;
                }
                let stake = amount - self.vig_for(market, amount);
                return quote_total(market.up, market.down, market.k, side, stake);
            }
            // A window nobody has opened yet quotes as it will open: seed on both sides. The
            // oracle and float checks are the bet's, not the quote's — a quote must never panic.
            if market.state == MARKET_NONE {
                if let Option::Some((series_id, epoch)) = decode_series(market_id) {
                    let series = self.series.read(series_id);
                    if series.window == 0 || !series.active {
                        return 0;
                    }
                    if epoch != now / series.window {
                        return 0;
                    }
                    let deadline = (epoch + 1) * series.window;
                    if deadline - now < series.window / OPEN_LEAD_DIVISOR {
                        return 0;
                    }
                    if amount < series.seed / OPEN_MIN_STAKE_DIVISOR {
                        return 0;
                    }
                    let stake = amount - vig_of(series.vig_bps, amount);
                    let seed_u256: u256 = series.seed.into();
                    return quote_total(
                        series.seed, series.seed, seed_u256 * seed_u256, side, stake,
                    );
                }
            }
            0
        }

        /// What the machine would pay right now to buy a position back. Total, like `quote_bet` —
        /// a position that cannot be sold quotes 0 rather than breaking the panel it renders in.
        fn quote_cashout(self: @ContractState, commitment: felt252) -> u128 {
            let position = self.positions.read(commitment);
            if position.state != POS_OPEN {
                return 0;
            }
            if position.side == SIDE_SEED {
                return 0;
            }
            let market = self.markets.read(position.market_id);
            if market.state != MARKET_ACTIVE {
                return 0;
            }
            if get_block_timestamp() >= market.deadline {
                return 0;
            }
            cashout_for(market.up, market.down, market.k, position.side, position.tickets)
        }

        /// What each commitment would be paid right now, 0 meaning "cannot claim".
        ///
        /// This exists because of a trap in the pool: a zero-amount deposit REVERTS, so a batch
        /// carrying one losing ticket burns the whole fee and settles nothing. The client filters
        /// against this view before it builds the batch. Note it takes commitments, not secrets —
        /// a view call travels to an RPC node in the clear, and secrets do not go there.
        fn preview_claim(self: @ContractState, commitments: Span<felt252>) -> Span<u128> {
            let mut out: Array<u128> = array![];
            let mut i: u32 = 0;
            let n = commitments.len();
            while i != n {
                out.append(self.payout_of(*commitments.at(i)));
                i += 1;
            };
            out.span()
        }

        fn get_market(self: @ContractState, market_id: u64) -> Market {
            self.markets.read(market_id)
        }

        fn get_position(self: @ContractState, commitment: felt252) -> Position {
            self.positions.read(commitment)
        }

        fn market_count(self: @ContractState) -> u64 {
            self.next_market_id.read()
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn pragma(self: @ContractState) -> ContractAddress {
            self.pragma.read()
        }

        // ── Standing series and the house float ─────────────────────────────────────────

        fn fund_float(ref self: ContractState, token: ContractAddress, amount: u128) {
            assert(token == self.stake_token.read(), 'NOT_STAKE_TOKEN');
            assert(amount != 0, 'ZERO_AMOUNT');
            let from = get_caller_address();
            let erc20 = IERC20Dispatcher { contract_address: token };
            let me = get_contract_address();
            // Booked by what actually arrived, not by what the token claims: a token that moves
            // less than `amount` must not leave the ledger above the balance.
            let before = erc20.balance_of(me);
            let pulled = erc20.transfer_from(from, me, amount.into());
            assert(pulled, 'FLOAT_NOT_RECEIVED');
            let after = erc20.balance_of(me);
            assert(after >= before + amount.into(), 'FLOAT_NOT_RECEIVED');
            // Booked at once, so `take_custody` never reads house money as someone's stake.
            self.accounted.write(token, self.accounted.read(token) + amount.into());
            self.float.write(token, self.float.read(token) + amount);
            self.emit(FloatFunded { token, amount, from });
        }

        fn withdraw_float(
            ref self: ContractState, token: ContractAddress, amount: u128, to: ContractAddress,
        ) {
            self.only_steward();
            assert(to.is_non_zero(), 'ZERO_RECIPIENT');
            assert(amount != 0, 'ZERO_AMOUNT');
            let idle = self.float.read(token);
            assert(idle >= amount, 'FLOAT_SHORT');
            self.float.write(token, idle - amount);
            self.release_custody(token, amount);
            let sent = IERC20Dispatcher { contract_address: token }.transfer(to, amount.into());
            assert(sent, 'TRANSFER_FAILED');
            self.emit(FloatWithdrawn { token, amount, to });
        }

        fn add_series(
            ref self: ContractState,
            pair_id: felt252,
            window: u64,
            token: ContractAddress,
            seed: u128,
            min_sources: u32,
            vig_bps: u32,
            experimental: bool,
        ) -> u32 {
            self.only_steward();
            assert(pair_id != 0, 'ZERO_PAIR');
            assert(token == self.stake_token.read(), 'NOT_STAKE_TOKEN');
            assert(seed != 0, 'ZERO_SEED');
            assert(min_sources != 0, 'ZERO_MIN_SOURCES');
            assert(vig_bps <= MAX_VIG_BPS, 'VIG_TOO_HIGH');
            // The same oracle floor a custom market must clear: nothing shorter than the feed
            // can decide, and 15 minutes only under the experimental label.
            if experimental {
                assert(window >= MIN_WINDOW_EXPERIMENTAL, 'WINDOW_TOO_SHORT');
            } else {
                assert(window >= MIN_WINDOW_STANDARD, 'WINDOW_TOO_SHORT');
            }
            let series_id = self.series_count.read();
            self
                .series
                .write(
                    series_id,
                    Series {
                        pair_id, window, token, seed, min_sources, vig_bps, experimental, active: true,
                    },
                );
            self.series_count.write(series_id + 1);
            self
                .emit(
                    SeriesAdded {
                        series_id, pair_id, window, token, seed, min_sources, vig_bps, experimental,
                    },
                );
            series_id
        }

        fn set_series_active(ref self: ContractState, series_id: u32, active: bool) {
            self.only_steward();
            let mut series = self.series.read(series_id);
            assert(series.window != 0, 'NO_SUCH_SERIES');
            series.active = active;
            self.series.write(series_id, series);
            self.emit(SeriesActive { series_id, active });
        }

        fn propose_steward(ref self: ContractState, steward: ContractAddress) {
            self.only_steward();
            assert(steward.is_non_zero(), 'ZERO_STEWARD');
            self.pending_steward.write(steward);
        }

        fn accept_steward(ref self: ContractState) {
            let pending = self.pending_steward.read();
            assert(pending.is_non_zero() && get_caller_address() == pending, 'NOT_PENDING_STEWARD');
            self.steward.write(pending);
            self.pending_steward.write(Zero::zero());
        }

        fn get_series(self: @ContractState, series_id: u32) -> Series {
            self.series.read(series_id)
        }

        fn series_count(self: @ContractState) -> u32 {
            self.series_count.read()
        }

        fn current_market(self: @ContractState, series_id: u32) -> (u64, u64, u64, u8) {
            let series = self.series.read(series_id);
            assert(series.window != 0, 'NO_SUCH_SERIES');
            let epoch = get_block_timestamp() / series.window;
            let market_id = series_market_id(series_id, epoch);
            (market_id, epoch, (epoch + 1) * series.window, self.markets.read(market_id).state)
        }

        fn market_id_for(self: @ContractState, series_id: u32, epoch: u64) -> u64 {
            series_market_id(series_id, epoch)
        }

        fn float(self: @ContractState, token: ContractAddress) -> u128 {
            self.float.read(token)
        }

        fn steward(self: @ContractState) -> ContractAddress {
            self.steward.read()
        }

        fn pending_steward(self: @ContractState) -> ContractAddress {
            self.pending_steward.read()
        }

        fn stake_token(self: @ContractState) -> ContractAddress {
            self.stake_token.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// `[pair_id, strike, deadline, token, seed, seeder_commitment, experimental]`
        ///
        /// Permissionless: the custody check below is the only authorisation that matters. You
        /// cannot open a market with money you did not send, and if you did send it, it is yours
        /// to seed with. Returns an empty span — creating a market moves no money OUT.
        fn op_create(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            assert(payload.len() == 7, 'BAD_PAYLOAD');

            let pair_id = *payload.at(0);
            let strike: u128 = (*payload.at(1)).try_into().expect('STRIKE_NOT_U128');
            let deadline: u64 = (*payload.at(2)).try_into().expect('DEADLINE_NOT_U64');
            let token: ContractAddress = (*payload.at(3)).try_into().expect('TOKEN_NOT_ADDRESS');
            let seed: u128 = (*payload.at(4)).try_into().expect('SEED_NOT_U128');
            let commitment = *payload.at(5);
            let experimental = *payload.at(6) != 0;

            assert(pair_id != 0, 'ZERO_PAIR');
            assert(strike != 0, 'ZERO_STRIKE');
            assert(token.is_non_zero(), 'ZERO_TOKEN');
            assert(seed != 0, 'ZERO_SEED');
            assert(commitment != 0, 'ZERO_COMMITMENT');

            let now = get_block_timestamp();
            assert(deadline > now, 'DEADLINE_PASSED');
            let window = deadline - now;
            if experimental {
                assert(window >= MIN_WINDOW_EXPERIMENTAL, 'WINDOW_TOO_SHORT');
            } else {
                assert(window >= MIN_WINDOW_STANDARD, 'WINDOW_TOO_SHORT');
            }

            assert(self.positions.read(commitment).state == POS_NONE, 'COMMITMENT_USED');

            self.take_custody(token, seed);

            let market_id = self.next_market_id.read();
            // Custom ids count up from 0; series ids live at and above the base. Unreachable in
            // any real lifetime, asserted so the two spaces can never meet.
            assert(market_id < SERIES_ID_BASE, 'MARKET_ID_SPACE');
            let seed_u256: u256 = seed.into();
            self
                .markets
                .write(
                    market_id,
                    Market {
                        pair_id,
                        strike,
                        deadline,
                        token,
                        up: seed,
                        down: seed,
                        k: seed_u256 * seed_u256,
                        seed,
                        collateral: seed,
                        state: MARKET_ACTIVE,
                        winner: WINNER_UNSET,
                        experimental,
                        house: false,
                        series: 0,
                        open_cash: 0,
                        vig: 0,
                    },
                );
            self.next_market_id.write(market_id + 1);

            // The seeder is a position like any other, so the residual is claimed through the
            // same bearer path as a winning ticket and needs no separate withdrawal route.
            self
                .positions
                .write(
                    commitment,
                    Position {
                        market_id, side: SIDE_SEED, tickets: 0, cash_in: seed, state: POS_OPEN,
                    },
                );

            self
                .emit(
                    MarketCreated {
                        market_id, pair_id, strike, deadline, token, seed, commitment, experimental,
                    },
                );

            array![].span()
        }

        /// `[n, (market_id, side, amount, commitment) × n]`
        ///
        /// The headline capability: a three-strike ladder is three bets, ONE pool transaction, ONE
        /// fee, and one custody check per token. Nothing in the protocol's history has ever
        /// batched like this. Returns an empty span — money is going IN, not out.
        fn op_bet(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            let n = read_batch_len(payload, 4);
            let now = get_block_timestamp();

            // Collected per entry, then collapsed to one custody check per DISTINCT token below.
            let mut tokens: Array<ContractAddress> = array![];
            let mut amounts: Array<u128> = array![];

            let mut i: u32 = 0;
            while i != n {
                let base = 1 + i * 4;
                let market_id: u64 = (*payload.at(base)).try_into().expect('MARKET_NOT_U64');
                let side: u8 = (*payload.at(base + 1)).try_into().expect('SIDE_NOT_U8');
                let amount: u128 = (*payload.at(base + 2)).try_into().expect('AMOUNT_NOT_U128');
                let commitment = *payload.at(base + 3);

                // A series window opens on its first bet; every other id reads as it is.
                self.ensure_open(market_id, now, amount);
                let mut market = self.markets.read(market_id);
                assert(market.state == MARKET_ACTIVE, 'MARKET_NOT_ACTIVE');
                assert(now < market.deadline, 'BETTING_CLOSED');
                assert(side == SIDE_UP || side == SIDE_DOWN, 'BAD_SIDE');
                assert(amount != 0, 'ZERO_AMOUNT');
                assert(commitment != 0, 'ZERO_COMMITMENT');
                assert(self.positions.read(commitment).state == POS_NONE, 'COMMITMENT_USED');

                // The house's vig comes off the top and waits in the market; the machine only
                // ever sees the net stake. A custom market has no house and takes no vig.
                let vig = self.vig_for(market, amount);
                let stake = amount - vig;
                let tickets = tickets_for(market.up, market.down, market.k, side, stake);
                // A stake so small it rounds to nothing would take the money and issue no claim.
                assert(tickets != 0, 'ZERO_TICKETS');

                if side == SIDE_UP {
                    market.up = market.up + stake - tickets;
                    market.down = market.down + stake;
                } else {
                    market.down = market.down + stake - tickets;
                    market.up = market.up + stake;
                }
                market.collateral += amount;
                market.open_cash += amount;
                market.vig += vig;
                // Written back inside the loop, so two bets on the SAME market in one batch see
                // each other's price move — the second one pays the post-first-bet odds.
                self.markets.write(market_id, market);

                self
                    .positions
                    .write(
                        commitment,
                        Position { market_id, side, tickets, cash_in: amount, state: POS_OPEN },
                    );

                tokens.append(market.token);
                amounts.append(amount);

                self
                    .emit(
                        BetPlaced {
                            market_id,
                            side,
                            amount,
                            tickets,
                            up_after: market.up,
                            down_after: market.down,
                            commitment,
                        },
                    );

                i += 1;
            };

            // Custody runs last only because the stake token is discovered per market. It is still
            // airtight: nothing above transfers anything or calls out, so there is no reentrancy
            // to exploit in the gap, and a failure here reverts every write the loop just made.
            let tokens = tokens.span();
            let amounts = amounts.span();
            let mut i: u32 = 0;
            while i != n {
                let total = first_occurrence_total(tokens, amounts, i);
                if total != 0 {
                    self.take_custody(*tokens.at(i), total);
                }
                i += 1;
            };

            array![].span()
        }

        /// `[secret, note_id, min_out]` → exactly one deposit.
        ///
        /// Leaving early. The machine is always willing to buy a position back at the price the
        /// crowd has moved it to, which is the third thing a pot cannot offer: if the odds ran
        /// your way you can bank the gain with time still on the clock, and if they ran against
        /// you, you can cut the loss instead of waiting to be told.
        ///
        /// Sells the WHOLE position — there is no partial sale, because a half-sold bearer
        /// commitment would need a second secret to carry the remainder and that is a wallet
        /// feature, not a market one.
        ///
        /// Pool-only, for the same reason claiming is: the payout leaves when the pool pulls it.
        fn op_cashout(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            let pool = self.pool.read();
            assert(get_caller_address() == pool, 'ONLY_POOL');
            assert(payload.len() == 3, 'BAD_PAYLOAD');

            let secret = *payload.at(0);
            let note_id = *payload.at(1);
            let min_out: u128 = (*payload.at(2)).try_into().expect('MIN_OUT_NOT_U128');
            assert(note_id != 0, 'ZERO_NOTE_ID');

            let commitment = poseidon_hash_span(array![secret].span());
            let mut position = self.positions.read(commitment);
            assert(position.state == POS_OPEN, 'POSITION_NOT_OPEN');
            // The seeder is the counterparty, not a ticket holder: there is no side of theirs to
            // sell back, and their residual does not exist until the market settles.
            assert(position.side != SIDE_SEED, 'SEEDER_CANNOT_CASH_OUT');

            let mut market = self.markets.read(position.market_id);
            assert(market.state == MARKET_ACTIVE, 'MARKET_NOT_ACTIVE');
            // Past the deadline there is no price left to sell into — the answer is settlement,
            // and `preview_claim` is the view that matters.
            assert(get_block_timestamp() < market.deadline, 'BETTING_CLOSED');

            let payout = cashout_for(
                market.up, market.down, market.k, position.side, position.tickets,
            );
            assert(payout != 0, 'NOTHING_TO_CLAIM');
            // The odds can move between quoting and landing on chain, exactly as with a swap, so
            // the client names the worst price it will accept.
            assert(payout >= min_out, 'BELOW_MIN_OUT');

            if position.side == SIDE_UP {
                market.up = market.up + position.tickets - payout;
                market.down = market.down - payout;
            } else {
                market.down = market.down + position.tickets - payout;
                market.up = market.up - payout;
            }
            market.collateral -= payout;
            // Leaving takes the position off the refund bill at what it PAID, not what it got.
            market.open_cash -= position.cash_in;
            self.markets.write(position.market_id, market);

            position.state = POS_CLAIMED;
            self.positions.write(commitment, position);
            self.release_custody(market.token, payout);

            IERC20Dispatcher { contract_address: market.token }.approve(pool, payout.into());

            self
                .emit(
                    CashedOut {
                        commitment,
                        market_id: position.market_id,
                        tickets: position.tickets,
                        amount: payout,
                    },
                );

            array![OpenNoteDeposit { note_id, token: market.token, amount: payout }].span()
        }

        /// `[n, (secret, note_id) × n]` → exactly `n` deposits.
        ///
        /// Pool-only, and that restriction is load-bearing rather than defensive: the payout does
        /// not leave in this call, it leaves when the POOL pulls the approved sum while crediting
        /// the open notes it created earlier in the same transaction. Called by anyone else, this
        /// would mark positions claimed and approve tokens to a pool that is not going to collect
        /// — the money would simply be gone.
        fn op_claim(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            let pool = self.pool.read();
            assert(get_caller_address() == pool, 'ONLY_POOL');

            let n = read_batch_len(payload, 2);

            let mut deposits: Array<OpenNoteDeposit> = array![];
            let mut tokens: Array<ContractAddress> = array![];
            let mut amounts: Array<u128> = array![];

            let mut i: u32 = 0;
            while i != n {
                let base = 1 + i * 2;
                let secret = *payload.at(base);
                let note_id = *payload.at(base + 1);
                assert(note_id != 0, 'ZERO_NOTE_ID');

                let commitment = poseidon_hash_span(array![secret].span());
                let mut position = self.positions.read(commitment);
                // Covers an unknown secret and a second claim in one assertion: both leave the
                // position in a state that is not OPEN.
                assert(position.state == POS_OPEN, 'POSITION_NOT_OPEN');

                let market = self.markets.read(position.market_id);
                assert(market.state != MARKET_ACTIVE, 'MARKET_UNSETTLED');

                let payout = self.payout_of(commitment);
                // The pool reverts on a zero-amount deposit, so a losing ticket must never reach
                // this far. `preview_claim` is how the client keeps it out of the batch.
                assert(payout != 0, 'NOTHING_TO_CLAIM');

                position.state = POS_CLAIMED;
                self.positions.write(commitment, position);
                self.release_custody(market.token, payout);

                deposits
                    .append(OpenNoteDeposit { note_id, token: market.token, amount: payout });
                tokens.append(market.token);
                amounts.append(payout);

                let kind = if market.state == MARKET_VOIDED {
                    CLAIM_REFUND
                } else if position.side == SIDE_SEED {
                    CLAIM_RESIDUAL
                } else {
                    CLAIM_WIN
                };
                self
                    .emit(
                        Claimed {
                            commitment, market_id: position.market_id, amount: payout, kind,
                        },
                    );

                i += 1;
            };

            approve_batch_totals(pool, tokens.span(), amounts.span());

            deposits.span()
        }

        /// What `commitment` is owed right now, or 0 if it is owed nothing.
        ///
        /// Total on purpose — `preview_claim` renders this straight into the UI, and `op_claim`
        /// turns a 0 into `NOTHING_TO_CLAIM` at the point where it matters.
        fn payout_of(self: @ContractState, commitment: felt252) -> u128 {
            let position = self.positions.read(commitment);
            if position.state != POS_OPEN {
                return 0;
            }
            let market = self.markets.read(position.market_id);

            if market.state == MARKET_VOIDED {
                // Bettors at cost; the seeder takes the rest of the pot — see `void_residual`.
                return if position.side == SIDE_SEED {
                    void_residual(market)
                } else {
                    position.cash_in
                };
            }
            if market.state != MARKET_RESOLVED {
                return 0;
            }
            if position.side == SIDE_SEED {
                // The residual is whatever is left in the winning reserve — which, with the
                // outstanding winning tickets, is the collateral exactly. The seeder is the
                // counterparty, so their profit is the losing side's stakes minus what the
                // winners took.
                return if market.winner == SIDE_UP {
                    market.up
                } else {
                    market.down
                };
            }
            if position.side == market.winner {
                position.tickets
            } else {
                0
            }
        }

        fn only_steward(self: @ContractState) {
            assert(get_caller_address() == self.steward.read(), 'ONLY_STEWARD');
        }

        /// The house's cut of `amount` on this market: its series' vig, or nothing for a custom one.
        fn vig_for(self: @ContractState, market: Market, amount: u128) -> u128 {
            if !market.house {
                return 0;
            }
            vig_of(self.series.read(market.series).vig_bps, amount)
        }

        /// Opens the series window `market_id` names, if it is one and it is not open yet. Every
        /// refusal here is free — nothing has been transferred when a bet reaches it.
        fn ensure_open(ref self: ContractState, market_id: u64, now: u64, amount: u128) {
            let (series_id, epoch) = match decode_series(market_id) {
                Option::Some(decoded) => decoded,
                Option::None => { return; },
            };
            if self.markets.read(market_id).state != MARKET_NONE {
                return;
            }
            let series = self.series.read(series_id);
            assert(series.window != 0, 'NO_SUCH_SERIES');
            assert(series.active, 'SERIES_RETIRED');
            assert(amount >= series.seed / OPEN_MIN_STAKE_DIVISOR, 'OPENING_STAKE_TOO_SMALL');
            // Only the window that is live now can open: a past epoch has no price left to be
            // about, and a future one would let someone pick a line early.
            assert(epoch == now / series.window, 'EPOCH_NOT_CURRENT');
            let deadline = (epoch + 1) * series.window;
            assert(deadline - now >= series.window / OPEN_LEAD_DIVISOR, 'WINDOW_CLOSING');

            let response = IPragmaABIDispatcher { contract_address: self.pragma.read() }
                .get_data_median(DataType::SpotEntry(series.pair_id));
            assert(response.price != 0, 'ORACLE_NO_PRICE');
            assert(response.decimals == STRIKE_DECIMALS, 'ORACLE_DECIMALS');
            assert(response.num_sources_aggregated >= series.min_sources, 'ORACLE_THIN');
            assert(response.last_updated_timestamp + OPEN_MAX_LAG >= now, 'ORACLE_STALE');

            let idle = self.float.read(series.token);
            assert(idle >= series.seed, 'NO_FLOAT');
            self.float.write(series.token, idle - series.seed);

            let seed_u256: u256 = series.seed.into();
            self
                .markets
                .write(
                    market_id,
                    Market {
                        pair_id: series.pair_id,
                        strike: response.price,
                        deadline,
                        token: series.token,
                        up: series.seed,
                        down: series.seed,
                        k: seed_u256 * seed_u256,
                        seed: series.seed,
                        collateral: series.seed,
                        state: MARKET_ACTIVE,
                        winner: WINNER_UNSET,
                        experimental: series.experimental,
                        house: true,
                        series: series_id,
                        open_cash: 0,
                        vig: 0,
                    },
                );
            self
                .emit(
                    MarketOpened {
                        market_id,
                        series_id,
                        epoch,
                        strike: response.price,
                        deadline,
                        seed: series.seed,
                        oracle_ts: response.last_updated_timestamp,
                    },
                );
        }

        /// Recognise `amount` of `token` as having genuinely arrived.
        ///
        /// The pool withdraws to an arbitrary address in phase 6 and invokes us in phase 7, so
        /// funding and calling are one transaction and we are handed no proof of payment — we
        /// look. Anything above the ledger is new money; anything else is a caller claiming
        /// credit for someone else's deposit, or for nothing at all.
        ///
        /// Two limits worth stating plainly rather than discovering later. First, the ledger is
        /// per token, so a market denominated in a token whose `balance_of` lies can only defraud
        /// people who bet in THAT token — it cannot reach a STRK market's collateral, and the
        /// client only ever offers tokens it knows. Second, tokens sent here directly, outside a
        /// pool withdrawal, read as unbooked funds and can be seeded with by whoever calls first;
        /// this address is a settlement contract, not a wallet, and nothing should ever be sent
        /// to it by hand.
        fn take_custody(ref self: ContractState, token: ContractAddress, amount: u128) {
            let held = IERC20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            let booked = self.accounted.read(token);
            assert(held >= booked, 'CUSTODY_LEDGER_BROKEN');
            assert(held - booked >= amount.into(), 'FUNDS_NOT_RECEIVED');
            self.accounted.write(token, booked + amount.into());
        }

        /// Drop `amount` from the ledger as it is approved out to the pool. Keeps
        /// `balance_of - accounted` truthful once the pool completes its pull, so the next
        /// market's custody check is measured against the right baseline.
        fn release_custody(ref self: ContractState, token: ContractAddress, amount: u128) {
            let booked = self.accounted.read(token);
            assert(booked >= amount.into(), 'CUSTODY_LEDGER_BROKEN');
            self.accounted.write(token, booked - amount.into());
        }
    }

    /// `(series + 1) * SERIES_ID_BASE + epoch`. The `+ 1` keeps series 0 away from the custom
    /// counter, which starts at 0.
    fn series_market_id(series_id: u32, epoch: u64) -> u64 {
        assert(epoch < SERIES_ID_BASE, 'EPOCH_TOO_LARGE');
        let base: u64 = series_id.into();
        (base + 1) * SERIES_ID_BASE + epoch
    }

    /// `bps` of `amount`, rounded down — dust stays with the bettor.
    fn vig_of(bps: u32, amount: u128) -> u128 {
        let bps_u128: u128 = bps.into();
        let wide: u256 = amount.into() * bps_u128.into() / BPS.into();
        wide.try_into().expect('VIG_NOT_U128')
    }

    /// What the seeder — the house, or a custom market's seeder — takes when a market voids: the
    /// pot less the refund bill. Saturating, because a rounding-dust pot can sit a wei under.
    fn void_residual(market: Market) -> u128 {
        if market.collateral > market.open_cash {
            market.collateral - market.open_cash
        } else {
            0
        }
    }

    /// `tickets_for`, total: 0 wherever the real thing would overflow, so a view never panics.
    fn quote_total(up: u128, down: u128, k: u256, side: u8, stake: u128) -> u128 {
        let max: u128 = core::num::traits::Bounded::<u128>::MAX;
        let room = if up > down {
            max - up
        } else {
            max - down
        };
        if stake == 0 || stake > room {
            return 0;
        }
        tickets_for(up, down, k, side, stake)
    }

    /// The inverse: `Some((series, epoch))` for a series id, `None` for a custom one.
    fn decode_series(market_id: u64) -> Option<(u32, u64)> {
        let series_plus_one = market_id / SERIES_ID_BASE;
        if series_plus_one == 0 {
            return Option::None;
        }
        let series_id: u32 = (series_plus_one - 1).try_into().expect('SERIES_NOT_U32');
        Option::Some((series_id, market_id % SERIES_ID_BASE))
    }

    /// Tickets issued for staking `amount` on `side`, rounded DOWN.
    ///
    /// Both reserves take the stake, then the bought side is drawn back down to whatever restores
    /// the product to `k`. `ceil` on the kept reserve is what makes the rounding land on the pot's
    /// side of the line rather than the bettor's — the dust accumulates as seeder profit and the
    /// books close exactly.
    ///
    /// Worked, against the market the README explains: `up = down = 200`, so `k = 40_000`. Stake
    /// 20 on UP. Both reserves go to 220. The kept UP reserve is `ceil(40_000 / 220)` =
    /// `ceil(181.81…)` = 182, so the bettor receives `220 - 182 = 38` tickets — 38, not 38.18,
    /// because the fraction stays in the pot. Reserves settle at `up = 182`, `down = 220`, and the
    /// live product 40_040 now sits just above `k`, which is exactly the dust.
    fn tickets_for(up: u128, down: u128, k: u256, side: u8, amount: u128) -> u128 {
        let up_funded = up + amount;
        let down_funded = down + amount;

        let (bought, other) = if side == SIDE_UP {
            (up_funded, down_funded)
        } else {
            (down_funded, up_funded)
        };

        let other_u256: u256 = other.into();
        let quotient = k / other_u256;
        let kept_u256 = if k % other_u256 == 0 {
            quotient
        } else {
            quotient + 1
        };
        // Cannot exceed `bought`: `k <= up·down <= up_funded·down_funded`, so `k / other <=
        // bought`, and ceiling an exact-or-lower value against an integer bound stays inside it.
        let kept: u128 = kept_u256.try_into().expect('RESERVE_NOT_U128');
        bought - kept
    }

    /// Collateral paid for handing a whole position back, rounded DOWN.
    ///
    /// The exact inverse of a buy: the tickets return to their reserve, `x` comes out of BOTH
    /// reserves, and `x` is whatever restores the product to `k`. Written out, with
    /// `A = bought_reserve + tickets` and `B = other_reserve`, that is `(A−x)(B−x) = k`, i.e.
    ///
    ///     x² − (A+B)·x + (A·B − k) = 0
    ///
    /// and the payout is the smaller root. Its discriminant simplifies to `(A−B)² + 4k`, which is
    /// never negative, so a real root always exists — no "insufficient liquidity" case can arise.
    ///
    /// Worked, continuing the README's market: alice holds 38 UP tickets, then someone stakes 100
    /// on UP and the reserves become `up = 125`, `down = 320`. So `A = 163`, `B = 320`,
    /// `A+B = 483`, and the discriminant is `157² + 4·40_000 = 184_649`. Its root is 429.7…, taken
    /// UP to 430, so `x = (483 − 430) / 2 = 26`. Alice put in 20 and can leave with 26, with time
    /// still on the clock, because the crowd moved her way.
    ///
    /// The root is rounded UP precisely so the payout rounds DOWN — the same direction as every
    /// other rounding decision here. `sum − root` cannot underflow: `A·B >= k` makes the
    /// discriminant at most `sum²`, and the only way the floored root reaches `sum` is an exact
    /// square, which takes no rounding up.
    fn cashout_for(up: u128, down: u128, k: u256, side: u8, tickets: u128) -> u128 {
        let (bought, other) = if side == SIDE_UP {
            (up, down)
        } else {
            (down, up)
        };

        let a: u256 = (bought + tickets).into();
        let b: u256 = other.into();
        let diff = if a > b {
            a - b
        } else {
            b - a
        };
        // Overflows only for a market seeded near 2^127, which no real token supply reaches. The
        // resulting revert refuses the cash-out; it never produces a wrong number.
        let discriminant = diff * diff + 4 * k;

        let root_floor: u256 = discriminant.sqrt().into();
        let root = if root_floor * root_floor == discriminant {
            root_floor
        } else {
            root_floor + 1
        };

        let payout = (a + b - root) / 2;
        payout.try_into().expect('CASHOUT_NOT_U128')
    }

}
