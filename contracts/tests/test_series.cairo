//! Standing series and the house float — the v2 half of Markets. The v1 behaviours keep their
//! own crate in `test_markets.cairo`; nothing here re-tests the ticket machine.

use core::poseidon::poseidon_hash_span;
use snforge_std::{
    declare, start_cheat_block_timestamp_global, start_cheat_caller_address,
    stop_cheat_caller_address, ContractClassTrait, DeclareResultTrait,
};
use core::num::traits::Zero;
use starknet::ContractAddress;
use strk20_app::markets::{IMarketsDispatcher, IMarketsDispatcherTrait, Markets};
use strk20_app::mocks::{
    IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPoolDispatcher, IMockPoolDispatcherTrait,
    IMockPragmaDispatcher, IMockPragmaDispatcherTrait,
};

const NOW: u64 = 1_700_000_000;
const HOUR: u64 = 3600;
const BTC_USD: felt252 = 'BTC/USD';
const SEED: u128 = 200;
const FLOAT: u128 = 1000;
/// $80,000 in Pragma's 8-decimal fixed point — the line every test window opens on.
const LINE: u128 = 8_000_000_000_000;
const ABOVE: u128 = 8_100_000_000_000;
const STEWARD: felt252 = 'steward';
const STRANGER: felt252 = 'stranger';

#[derive(Copy, Drop)]
struct Ctx {
    markets: IMarketsDispatcher,
    pool: IMockPoolDispatcher,
    token: IMockERC20Dispatcher,
    pragma: IMockPragmaDispatcher,
    steward: ContractAddress,
}

fn setup() -> Ctx {
    let (token_addr, _) = declare("MockERC20").unwrap().contract_class().deploy(@array![]).unwrap();
    let (pool_addr, _) = declare("MockPool").unwrap().contract_class().deploy(@array![]).unwrap();
    let (pragma_addr, _) = declare("MockPragma").unwrap().contract_class().deploy(@array![]).unwrap();
    let (markets_addr, _) = declare("Markets")
        .unwrap()
        .contract_class()
        .deploy(@array![pool_addr.into(), pragma_addr.into(), STEWARD, token_addr.into()])
        .unwrap();
    start_cheat_block_timestamp_global(NOW);
    let ctx = Ctx {
        markets: IMarketsDispatcher { contract_address: markets_addr },
        pool: IMockPoolDispatcher { contract_address: pool_addr },
        token: IMockERC20Dispatcher { contract_address: token_addr },
        pragma: IMockPragmaDispatcher { contract_address: pragma_addr },
        steward: STEWARD.try_into().unwrap(),
    };
    // The mock feed reports 10 sources; the line is fresh unless a test says otherwise.
    ctx.pragma.set_price(LINE, 8, NOW);
    ctx
}

fn commit(secret: felt252) -> felt252 {
    poseidon_hash_span(array![secret].span())
}

/// The steward's public funding leg: mint, approve, pull. No pool anywhere in it.
fn fund_float(ctx: Ctx, amount: u128) {
    ctx.token.mint(ctx.steward, amount.into());
    start_cheat_caller_address(ctx.token.contract_address, ctx.steward);
    ctx.token.approve(ctx.markets.contract_address, amount.into());
    stop_cheat_caller_address(ctx.token.contract_address);
    start_cheat_caller_address(ctx.markets.contract_address, ctx.steward);
    ctx.markets.fund_float(ctx.token.contract_address, amount);
    stop_cheat_caller_address(ctx.markets.contract_address);
}

fn add_series(ctx: Ctx, window: u64, min_sources: u32, experimental: bool) -> u32 {
    add_series_with_vig(ctx, window, min_sources, 0, experimental)
}

fn add_series_with_vig(ctx: Ctx, window: u64, min_sources: u32, vig_bps: u32, experimental: bool) -> u32 {
    start_cheat_caller_address(ctx.markets.contract_address, ctx.steward);
    let id = ctx
        .markets
        .add_series(
            BTC_USD, window, ctx.token.contract_address, SEED, min_sources, vig_bps, experimental,
        );
    stop_cheat_caller_address(ctx.markets.contract_address);
    id
}

/// Leaving early through the pool: the whole position, at whatever the machine pays now.
fn cash_out(ctx: Ctx, secret: felt252) {
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CASHOUT,
            array![secret, 'note', 0].span(),
        );
}

fn claim(ctx: Ctx, secret: felt252) {
    ctx
        .pool
        .invoke(ctx.markets.contract_address, Markets::OP_CLAIM, array![1, secret, 'note'].span());
}

fn as_steward(ctx: Ctx) {
    start_cheat_caller_address(ctx.markets.contract_address, ctx.steward);
}

fn as_nobody(ctx: Ctx) {
    stop_cheat_caller_address(ctx.markets.contract_address);
}

/// A funded, hourly, three-source series — the launch shape.
fn hourly(ctx: Ctx) -> u32 {
    fund_float(ctx, FLOAT);
    add_series(ctx, HOUR, 3, false)
}

/// Stand in for the pool's phase-6 withdrawal: the stake lands before the invoke that claims it.
fn fund(ctx: Ctx, amount: u128) {
    ctx.token.mint(ctx.markets.contract_address, amount.into());
}

fn bet(ctx: Ctx, market_id: u64, side: u8, amount: u128, secret: felt252) {
    fund(ctx, amount);
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_BET,
            array![1, market_id.into(), side.into(), amount.into(), commit(secret)].span(),
        );
}

fn current_id(ctx: Ctx, series_id: u32) -> u64 {
    let (market_id, _, _, _) = ctx.markets.current_market(series_id);
    market_id
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// A window exists before anyone touches it
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_series_window_has_an_id_and_a_deadline_before_anyone_bets() {
    let ctx = setup();
    let series_id = add_series(ctx, HOUR, 3, false);
    let (market_id, epoch, deadline, state) = ctx.markets.current_market(series_id);
    assert(epoch == NOW / HOUR, 'epoch');
    assert(deadline == (NOW / HOUR + 1) * HOUR, 'deadline at the hour');
    assert(market_id == Markets::SERIES_ID_BASE + epoch, 'id = (s+1)*base + epoch');
    assert(state == Markets::MARKET_NONE, 'nothing opened yet');
    assert(ctx.markets.market_id_for(series_id, epoch) == market_id, 'id helper agrees');
}

#[test]
fn an_unopened_window_quotes_as_it_will_open() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let id = current_id(ctx, series_id);
    let before = ctx.markets.quote_bet(id, Markets::SIDE_UP, 20);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    // The same stake quoted against the freshly seeded machine: the worked vector's 38 tickets.
    assert(before == 38, 'quote against the seed');
    let market = ctx.markets.get_market(id);
    assert(market.up == 182 && market.down == 220, 'reserves after the first bet');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The first bet opens it
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_first_bet_opens_the_window_on_the_oracle_line_with_the_float_seed() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let id = current_id(ctx, series_id);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    let market = ctx.markets.get_market(id);
    assert(market.state == Markets::MARKET_ACTIVE, 'open');
    assert(market.strike == LINE, 'line = oracle median at open');
    assert(market.seed == SEED && market.collateral == SEED + 20, 'seeded from the float');
    assert(market.house && market.series == series_id, 'a house window');
    assert(market.deadline == (NOW / HOUR + 1) * HOUR, 'deadline unchanged');
    assert(ctx.markets.float(ctx.token.contract_address) == FLOAT - SEED, 'float paid the seed');
}

#[test]
#[should_panic(expected: 'NO_FLOAT')]
fn a_window_cannot_open_without_float() {
    let ctx = setup();
    let series_id = add_series(ctx, HOUR, 3, false);
    bet(ctx, current_id(ctx, series_id), Markets::SIDE_UP, 20, 'alice');
}

#[test]
#[should_panic(expected: 'WINDOW_CLOSING')]
fn a_window_cannot_open_in_its_last_quarter() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    start_cheat_block_timestamp_global(deadline - HOUR / 4 + 1);
    ctx.pragma.set_price(LINE, 8, deadline - HOUR / 4 + 1);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
}

#[test]
fn a_window_opened_in_time_still_takes_bets_in_its_last_quarter() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    start_cheat_block_timestamp_global(deadline - 60);
    bet(ctx, id, Markets::SIDE_DOWN, 20, 'bob');
    assert(ctx.markets.get_market(id).collateral == SEED + 40, 'both stakes taken');
}

#[test]
#[should_panic(expected: 'EPOCH_NOT_CURRENT')]
fn a_bet_on_next_hours_window_is_refused() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let next = ctx.markets.market_id_for(series_id, NOW / HOUR + 1);
    bet(ctx, next, Markets::SIDE_UP, 20, 'alice');
}

#[test]
#[should_panic(expected: 'SERIES_RETIRED')]
fn a_retired_series_opens_no_new_window() {
    let ctx = setup();
    let series_id = hourly(ctx);
    start_cheat_caller_address(ctx.markets.contract_address, ctx.steward);
    ctx.markets.set_series_active(series_id, false);
    stop_cheat_caller_address(ctx.markets.contract_address);
    bet(ctx, current_id(ctx, series_id), Markets::SIDE_UP, 20, 'alice');
}

#[test]
#[should_panic(expected: 'ORACLE_STALE')]
fn a_feed_dead_for_an_hour_sets_no_line() {
    let ctx = setup();
    let series_id = hourly(ctx);
    ctx.pragma.set_price(LINE, 8, NOW - Markets::OPEN_MAX_LAG - 1);
    bet(ctx, current_id(ctx, series_id), Markets::SIDE_UP, 20, 'alice');
}

#[test]
#[should_panic(expected: 'ORACLE_THIN')]
fn a_feed_with_too_few_sources_sets_no_line() {
    let ctx = setup();
    fund_float(ctx, FLOAT);
    // The mock aggregates 10 sources; asking for 11 is asking for a feed that is not there.
    let series_id = add_series(ctx, HOUR, 11, false);
    bet(ctx, current_id(ctx, series_id), Markets::SIDE_UP, 20, 'alice');
}

#[test]
#[should_panic(expected: 'WINDOW_TOO_SHORT')]
fn a_fifteen_minute_series_needs_the_experimental_label() {
    let ctx = setup();
    add_series(ctx, 900, 3, false);
}

#[test]
fn a_fifteen_minute_series_is_allowed_when_labelled_experimental() {
    let ctx = setup();
    let series_id = add_series(ctx, 900, 3, true);
    assert(ctx.markets.get_series(series_id).experimental, 'labelled');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Settlement and the float
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_house_residual_returns_to_the_float_when_the_window_settles() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    ctx.pragma.set_price(ABOVE, 8, deadline);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(id);

    let market = ctx.markets.get_market(id);
    assert(market.state == Markets::MARKET_RESOLVED && market.winner == Markets::SIDE_UP, 'up');
    // Alice's 38 tickets pay 38; the house keeps the UP reserve, 182. 38 + 182 == 220 == collateral.
    assert(*ctx.markets.preview_claim(array![commit('alice')].span()).at(0) == 38, 'alice wins');
    assert(ctx.markets.float(ctx.token.contract_address) == FLOAT - SEED + 182, 'residual back');
}

#[test]
fn a_voided_window_returns_the_seed_to_the_float_and_refunds_the_bettor() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER + 1);
    ctx.markets.void(id);

    assert(ctx.markets.float(ctx.token.contract_address) == FLOAT, 'seed back, whole');
    assert(*ctx.markets.preview_claim(array![commit('alice')].span()).at(0) == 20, 'refund at cost');
}

#[test]
#[should_panic(expected: 'ORACLE_THIN')]
fn a_house_window_will_not_settle_on_a_feed_that_thinned_out() {
    let ctx = setup();
    fund_float(ctx, FLOAT);
    let series_id = add_series(ctx, HOUR, 5, false);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    // Opened on ten sources; by the deadline the feed has fallen to four.
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    ctx.pragma.set_sources(4);
    ctx.pragma.set_price(ABOVE, 8, deadline);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(id);
}

#[test]
fn a_custom_market_settles_whatever_the_source_count() {
    let ctx = setup();
    fund(ctx, SEED);
    let deadline = NOW + 2 * HOUR;
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CREATE,
            array![
                BTC_USD, LINE.into(), deadline.into(), ctx.token.contract_address.into(),
                SEED.into(), commit('seeder'), 0,
            ]
                .span(),
        );
    // A self-seeded market chose its own oracle risk; the source floor is a house rule.
    ctx.pragma.set_sources(1);
    ctx.pragma.set_price(ABOVE, 8, deadline);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(0);
    assert(ctx.markets.get_market(0).state == Markets::MARKET_RESOLVED, 'settled');
}

#[test]
fn the_books_close_across_a_house_window_with_two_sides() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    bet(ctx, id, Markets::SIDE_DOWN, 50, 'bob');
    let market = ctx.markets.get_market(id);

    ctx.pragma.set_price(ABOVE, 8, deadline);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(id);

    let alice = *ctx.markets.preview_claim(array![commit('alice')].span()).at(0);
    let bob = *ctx.markets.preview_claim(array![commit('bob')].span()).at(0);
    let residual = ctx.markets.float(ctx.token.contract_address) - (FLOAT - SEED);
    assert(bob == 0, 'bob lost');
    assert(alice + residual == market.collateral, 'winners + house == collateral');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Voids after cash-outs: the refund bill is what was paid, the house gets the rest
// ─────────────────────────────────────────────────────────────────────────────────────────

/// The reviewer's scenario: seed 200, alice 20 UP, bob 100 UP, alice leaves for 26, then a void.
/// v1 would have refunded 300 against a 294 pot. Now bob gets his 100, the house gets 194, and
/// the last wei is accounted for.
#[test]
fn a_void_after_a_cash_out_refunds_exactly_the_pot() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    bet(ctx, id, Markets::SIDE_UP, 100, 'bob');
    cash_out(ctx, 'alice');
    let market = ctx.markets.get_market(id);
    assert(market.collateral == 294 && market.open_cash == 100, 'pot 294, bill 100');

    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER + 1);
    ctx.markets.void(id);

    let house = ctx.markets.float(ctx.token.contract_address) - (FLOAT - SEED);
    let bob = *ctx.markets.preview_claim(array![commit('bob')].span()).at(0);
    assert(bob == 100, 'bob at cost');
    assert(house == 194, 'house takes what is left');
    assert(house + bob == market.collateral, 'refunds + house == pot');

    // And the ledger is whole: after bob is paid, every wei still held is idle float.
    claim(ctx, 'bob');
    let to: ContractAddress = 'treasury'.try_into().unwrap();
    as_steward(ctx);
    ctx.markets.withdraw_float(ctx.token.contract_address, FLOAT - SEED + 194, to);
    as_nobody(ctx);
    assert(ctx.token.balance_of(ctx.markets.contract_address) == 0, 'nothing stranded');
}

#[test]
fn a_custom_markets_seeder_takes_the_rest_of_a_voided_pot_after_a_cash_out() {
    let ctx = setup();
    fund(ctx, SEED);
    let deadline = NOW + 2 * HOUR;
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CREATE,
            array![
                BTC_USD, LINE.into(), deadline.into(), ctx.token.contract_address.into(),
                SEED.into(), commit('seeder'), 0,
            ]
                .span(),
        );
    bet(ctx, 0, Markets::SIDE_UP, 20, 'alice');
    bet(ctx, 0, Markets::SIDE_UP, 100, 'bob');
    cash_out(ctx, 'alice');

    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER + 1);
    ctx.markets.void(0);

    let seeder = *ctx.markets.preview_claim(array![commit('seeder')].span()).at(0);
    let bob = *ctx.markets.preview_claim(array![commit('bob')].span()).at(0);
    assert(seeder == 194 && bob == 100, 'seeder 194, bob 100');
    assert(seeder + bob == ctx.markets.get_market(0).collateral, 'refunds + seeder == pot');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The vig
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_vig_comes_off_the_top_and_reaches_the_float_at_settlement() {
    let ctx = setup();
    fund_float(ctx, FLOAT);
    // 2% — the launch figure.
    let series_id = add_series_with_vig(ctx, HOUR, 3, 200, false);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    bet(ctx, id, Markets::SIDE_UP, 100, 'alice');

    let market = ctx.markets.get_market(id);
    assert(market.vig == 2 && market.collateral == SEED + 100, 'held, not spent');
    // The machine saw 98: reserves 298 funded, kept up = ceil(40000/298) = 135, tickets 163.
    assert(market.up == 135 && market.down == 298, 'net stake priced');

    ctx.pragma.set_price(ABOVE, 8, deadline);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(id);

    let alice = *ctx.markets.preview_claim(array![commit('alice')].span()).at(0);
    let house = ctx.markets.float(ctx.token.contract_address) - (FLOAT - SEED);
    assert(alice == 163, 'tickets pay one to one');
    assert(house == 135 + 2, 'reserve plus vig');
    assert(alice + house == SEED + 100, 'to the wei');
}

#[test]
fn a_voided_window_gives_the_vig_back_inside_the_refund() {
    let ctx = setup();
    fund_float(ctx, FLOAT);
    let series_id = add_series_with_vig(ctx, HOUR, 3, 200, false);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    bet(ctx, id, Markets::SIDE_UP, 100, 'alice');
    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER + 1);
    ctx.markets.void(id);
    assert(*ctx.markets.preview_claim(array![commit('alice')].span()).at(0) == 100, 'whole stake');
    assert(ctx.markets.float(ctx.token.contract_address) == FLOAT, 'house back to even');
}

#[test]
#[should_panic(expected: 'VIG_TOO_HIGH')]
fn a_series_cannot_charge_more_than_the_cap() {
    let ctx = setup();
    add_series_with_vig(ctx, HOUR, 3, Markets::MAX_VIG_BPS + 1, false);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Opening guards and quotes that never lie
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected: 'OPENING_STAKE_TOO_SMALL')]
fn a_dust_bet_cannot_open_a_window() {
    let ctx = setup();
    let series_id = hourly(ctx);
    bet(ctx, current_id(ctx, series_id), Markets::SIDE_UP, 1, 'griefer');
}

#[test]
fn a_dust_bet_is_fine_once_the_window_is_open() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let id = current_id(ctx, series_id);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    bet(ctx, id, Markets::SIDE_DOWN, 2, 'bob');
    assert(ctx.markets.get_market(id).open_cash == 22, 'both counted');
}

#[test]
fn quotes_are_total_across_every_edge() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    let max: u128 = core::num::traits::Bounded::<u128>::MAX;
    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, max) == 0, 'overflow quotes 0');
    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, 1) == 0, 'below the opening floor');
    assert(ctx.markets.quote_bet(id + 1, Markets::SIDE_UP, 20) == 0, 'next epoch quotes 0');
    assert(ctx.markets.quote_bet(7, Markets::SIDE_UP, 20) == 0, 'unknown custom id quotes 0');
    assert(ctx.markets.quote_bet(9 * Markets::SERIES_ID_BASE, Markets::SIDE_UP, 20) == 0, 'no such series');

    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, max) == 0, 'overflow on an open one');
    assert(ctx.markets.quote_bet(id, Markets::SIDE_DOWN, 1) != 0, 'dust quotes once open');

    start_cheat_block_timestamp_global(deadline - HOUR / 4 + 1);
    let (next_id, _, _, _) = ctx.markets.current_market(series_id);
    assert(next_id == id, 'same window');
    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, 20) != 0, 'open window still quotes');

    start_cheat_block_timestamp_global(deadline);
    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, 20) == 0, 'past the deadline quotes 0');
}

#[test]
fn an_unopened_window_in_its_last_quarter_quotes_nothing() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let (id, _, deadline, _) = ctx.markets.current_market(series_id);
    start_cheat_block_timestamp_global(deadline - HOUR / 4 + 1);
    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, 20) == 0, 'would be refused');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The steward and the float
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected: 'NOT_STAKE_TOKEN')]
fn a_series_cannot_stake_in_any_other_token() {
    let ctx = setup();
    let (other, _) = declare("MockERC20").unwrap().contract_class().deploy(@array![]).unwrap();
    as_steward(ctx);
    ctx.markets.add_series(BTC_USD, HOUR, other, SEED, 3, 0, false);
}

#[test]
#[should_panic(expected: 'NOT_STAKE_TOKEN')]
fn the_float_takes_only_the_stake_token() {
    let ctx = setup();
    let (other, _) = declare("MockERC20").unwrap().contract_class().deploy(@array![]).unwrap();
    as_steward(ctx);
    ctx.markets.fund_float(other, 1);
}

#[test]
fn the_steward_hands_over_in_two_steps() {
    let ctx = setup();
    let next: ContractAddress = 'next'.try_into().unwrap();
    as_steward(ctx);
    ctx.markets.propose_steward(next);
    as_nobody(ctx);
    assert(ctx.markets.steward() == ctx.steward, 'not yet');
    start_cheat_caller_address(ctx.markets.contract_address, next);
    ctx.markets.accept_steward();
    stop_cheat_caller_address(ctx.markets.contract_address);
    assert(ctx.markets.steward() == next, 'handed over');
    assert(ctx.markets.pending_steward().is_zero(), 'nothing pending');
}

#[test]
#[should_panic(expected: 'NOT_PENDING_STEWARD')]
fn only_the_proposed_steward_can_accept() {
    let ctx = setup();
    let next: ContractAddress = 'next'.try_into().unwrap();
    as_steward(ctx);
    ctx.markets.propose_steward(next);
    as_nobody(ctx);
    start_cheat_caller_address(ctx.markets.contract_address, STRANGER.try_into().unwrap());
    ctx.markets.accept_steward();
}

#[test]
#[should_panic(expected: 'ONLY_STEWARD')]
fn a_stranger_cannot_add_a_series() {
    let ctx = setup();
    start_cheat_caller_address(ctx.markets.contract_address, STRANGER.try_into().unwrap());
    ctx.markets.add_series(BTC_USD, HOUR, ctx.token.contract_address, SEED, 3, 0, false);
}

#[test]
fn the_steward_withdraws_idle_float_and_nothing_more() {
    let ctx = setup();
    let series_id = hourly(ctx);
    bet(ctx, current_id(ctx, series_id), Markets::SIDE_UP, 20, 'alice');
    let to: ContractAddress = 'treasury'.try_into().unwrap();

    start_cheat_caller_address(ctx.markets.contract_address, ctx.steward);
    ctx.markets.withdraw_float(ctx.token.contract_address, FLOAT - SEED, to);
    stop_cheat_caller_address(ctx.markets.contract_address);

    assert(ctx.token.balance_of(to) == (FLOAT - SEED).into(), 'idle float left');
    assert(ctx.markets.float(ctx.token.contract_address) == 0, 'nothing idle remains');
    // The seed out in the window and alice's stake are still in custody.
    assert(
        ctx.token.balance_of(ctx.markets.contract_address) == (SEED + 20).into(), 'window money stays',
    );
}

#[test]
#[should_panic(expected: 'FLOAT_SHORT')]
fn the_steward_cannot_withdraw_a_seed_that_is_out_in_a_window() {
    let ctx = setup();
    let series_id = hourly(ctx);
    bet(ctx, current_id(ctx, series_id), Markets::SIDE_UP, 20, 'alice');
    start_cheat_caller_address(ctx.markets.contract_address, ctx.steward);
    ctx.markets.withdraw_float(ctx.token.contract_address, FLOAT, ctx.steward);
}

#[test]
#[should_panic(expected: 'FUNDS_NOT_RECEIVED')]
fn float_money_cannot_be_claimed_as_a_bettors_stake() {
    let ctx = setup();
    let series_id = hourly(ctx);
    // No `fund`: the only money in the contract is the float, and it is already booked.
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_BET,
            array![1, current_id(ctx, series_id).into(), Markets::SIDE_UP.into(), 20, commit('alice')]
                .span(),
        );
}

#[test]
fn custom_market_ids_and_series_ids_never_collide() {
    let ctx = setup();
    let series_id = hourly(ctx);
    let window = current_id(ctx, series_id);
    // A custom market takes the counter's first id, 0, which no series can produce.
    fund(ctx, SEED);
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CREATE,
            array![
                BTC_USD, LINE.into(), (NOW + 2 * HOUR).into(), ctx.token.contract_address.into(),
                SEED.into(), commit('seeder'), 0,
            ]
                .span(),
        );
    assert(ctx.markets.market_count() == 1, 'one custom market');
    let custom = ctx.markets.get_market(0);
    assert(!custom.house, 'custom is not house');
    assert(window >= Markets::SERIES_ID_BASE, 'series ids live above the base');
    assert(ctx.markets.get_market(window).state == Markets::MARKET_NONE, 'window untouched');
}
