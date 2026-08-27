use core::poseidon::poseidon_hash_span;
use snforge_std::{
    declare, start_cheat_block_timestamp_global, ContractClassTrait, DeclareResultTrait,
};
use strk20_app::batch;
use strk20_app::markets::{IMarketsDispatcher, IMarketsDispatcherTrait, Markets};
use strk20_app::mocks::{
    IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPoolDispatcher, IMockPoolDispatcherTrait,
    IMockPragmaDispatcher, IMockPragmaDispatcherTrait,
};
use strk20_app::pragma::DataType;

const NOW: u64 = 1_700_000_000;
const HOUR: u64 = 3600;
const BTC_USD: felt252 = 'BTC/USD';
/// $80,000 in Pragma's 8-decimal fixed point.
const STRIKE: u128 = 8_000_000_000_000;
const ABOVE: u128 = 8_100_000_000_000;
const BELOW: u128 = 7_900_000_000_000;
/// 2^128 — one past what an `OpenNoteDeposit` amount can carry.
const TOO_BIG_FOR_U128: felt252 = 0x100000000000000000000000000000000;

#[derive(Copy, Drop)]
struct Ctx {
    markets: IMarketsDispatcher,
    pool: IMockPoolDispatcher,
    token: IMockERC20Dispatcher,
    pragma: IMockPragmaDispatcher,
}

fn setup() -> Ctx {
    let (token_addr, _) = declare("MockERC20")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let (pool_addr, _) = declare("MockPool").unwrap().contract_class().deploy(@array![]).unwrap();
    let (pragma_addr, _) = declare("MockPragma")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let (markets_addr, _) = declare("Markets")
        .unwrap()
        .contract_class()
        .deploy(@array![pool_addr.into(), pragma_addr.into()])
        .unwrap();

    start_cheat_block_timestamp_global(NOW);

    Ctx {
        markets: IMarketsDispatcher { contract_address: markets_addr },
        pool: IMockPoolDispatcher { contract_address: pool_addr },
        token: IMockERC20Dispatcher { contract_address: token_addr },
        pragma: IMockPragmaDispatcher { contract_address: pragma_addr },
    }
}

/// The client keeps `secret`; the chain only ever sees this.
fn commit(secret: felt252) -> felt252 {
    poseidon_hash_span(array![secret].span())
}

/// Stand in for the pool's phase-6 withdrawal: money lands in the contract's balance BEFORE the
/// invoke that claims it, which is the only reason `take_custody` can verify anything.
fn fund(ctx: Ctx, amount: u128) {
    ctx.token.mint(ctx.markets.contract_address, amount.into());
}

fn create(ctx: Ctx, seed: u128, deadline: u64, secret: felt252) -> u64 {
    create_flagged(ctx, seed, deadline, secret, false)
}

fn create_flagged(
    ctx: Ctx, seed: u128, deadline: u64, secret: felt252, experimental: bool,
) -> u64 {
    let market_id = ctx.markets.market_count();
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CREATE,
            array![
                BTC_USD,
                STRIKE.into(),
                deadline.into(),
                ctx.token.contract_address.into(),
                seed.into(),
                commit(secret),
                if experimental {
                    1
                } else {
                    0
                },
            ]
                .span(),
        );
    market_id
}

fn bet(ctx: Ctx, market_id: u64, side: u8, amount: u128, secret: felt252) {
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_BET,
            array![1, market_id.into(), side.into(), amount.into(), commit(secret)].span(),
        );
}

/// A seed-and-stake in one step, for tests whose subject is settlement rather than funding.
fn funded_bet(ctx: Ctx, market_id: u64, side: u8, amount: u128, secret: felt252) {
    fund(ctx, amount);
    bet(ctx, market_id, side, amount, secret);
}

fn resolve_with(ctx: Ctx, market_id: u64, price: u128, deadline: u64) {
    ctx.pragma.set_price(price, 8, deadline);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(market_id);
}

fn preview_one(ctx: Ctx, secret: felt252) -> u128 {
    let out = ctx.markets.preview_claim(array![commit(secret)].span());
    *out.at(0)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Creating and seeding
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_funded_create_seeds_both_reserves_and_the_seeder_position() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');

    let market = ctx.markets.get_market(id);
    assert(market.state == Markets::MARKET_ACTIVE, 'market is active');
    assert(market.up == 200, 'up seeded');
    assert(market.down == 200, 'down seeded');
    assert(market.k == 40000, 'k is the seed squared');
    assert(market.collateral == 200, 'collateral is the seed');
    assert(market.winner == Markets::WINNER_UNSET, 'no winner before settlement');
    assert(market.token == ctx.token.contract_address, 'stake token recorded');
    assert(ctx.markets.market_count() == 1, 'one market exists');

    // The seeder is an ordinary bearer position, claimable through the same path as a ticket.
    let position = ctx.markets.get_position(commit('seeder'));
    assert(position.side == Markets::SIDE_SEED, 'seed side');
    assert(position.cash_in == 200, 'refundable at the seed');
    assert(position.tickets == 0, 'the seeder holds no tickets');
    assert(position.state == Markets::POS_OPEN, 'open');
}

// Nothing about `privacy_invoke` proves a stake arrived — the pool withdraws and invokes in one
// transaction and tells us nothing. This is the test that says we look rather than trust.
#[test]
#[should_panic(expected: 'FUNDS_NOT_RECEIVED')]
fn an_unfunded_create_is_refused() {
    let ctx = setup();
    create(ctx, 200, NOW + HOUR, 'seeder');
}

#[test]
#[should_panic(expected: 'WINDOW_TOO_SHORT')]
fn a_market_shorter_than_an_hour_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    create(ctx, 200, NOW + 600, 'seeder');
}

// The 15-minute tier exists, but only behind the flag that turns the void-and-refund rule into
// the advertised behaviour rather than a surprise.
#[test]
fn a_fifteen_minute_market_is_allowed_only_when_flagged_experimental() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create_flagged(ctx, 200, NOW + 900, 'seeder', true);
    assert(ctx.markets.get_market(id).experimental, 'flagged experimental');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The FPMM itself
// ─────────────────────────────────────────────────────────────────────────────────────────

// The vector the README and the video both explain, checked against arithmetic done by hand:
//
//   seed 200 → k = 200 × 200 = 40_000, reserves up = down = 200
//   stake 20 on UP → both reserves take it: up = down = 220
//   restore the product: kept UP = ceil(40_000 / 220) = ceil(181.8181…) = 182
//   tickets = 220 − 182 = 38          ← 38, not 38.18: the fraction stays with the pot
//   reserves settle at up = 182, down = 220; live product 40_040, just above k
#[test]
fn the_worked_vector_issues_thirty_eight_tickets_and_the_quote_agrees() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');

    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, 20) == 38, 'quoted 38 before betting');

    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    let market = ctx.markets.get_market(id);
    assert(market.up == 182, 'up reserve is 182');
    assert(market.down == 220, 'down reserve is 220');
    assert(market.collateral == 220, 'collateral took the stake');
    assert(market.k == 40000, 'k is never rewritten');

    let position = ctx.markets.get_position(commit('alice'));
    assert(position.tickets == 38, 'stored exactly what was quoted');
    assert(position.cash_in == 20, 'stake recorded for refunds');
    assert(position.side == Markets::SIDE_UP, 'up side');
}

#[test]
fn buying_a_side_makes_that_side_dearer_and_the_other_cheaper() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');

    let before = ctx.markets.quote_bet(id, Markets::SIDE_UP, 20);
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    // Same money, fewer tickets: the crowd's opinion moved and the price moved with it. This is
    // the aggregation the RFP is asking for, and the thing a pot structurally cannot show.
    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, 20) < before, 'up got dearer');
    assert(ctx.markets.quote_bet(id, Markets::SIDE_DOWN, 20) > before, 'down got cheaper');
}

// Alice's deal survives Bob's. In a parimutuel pot Bob's money would have come straight out of
// her payout; here it comes out of the reserve she already bought against.
#[test]
fn a_later_bet_cannot_touch_an_earlier_bettors_tickets() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');

    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    let alice_before = ctx.markets.get_position(commit('alice')).tickets;
    funded_bet(ctx, id, Markets::SIDE_UP, 100, 'bob');

    assert(ctx.markets.get_position(commit('alice')).tickets == alice_before, 'locked at bet time');
}

#[test]
#[should_panic(expected: 'BETTING_CLOSED')]
fn a_bet_after_the_deadline_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    fund(ctx, 20);
    start_cheat_block_timestamp_global(NOW + HOUR);
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
}

#[test]
#[should_panic(expected: 'BAD_SIDE')]
fn a_side_that_is_neither_up_nor_down_is_refused() {
    let ctx = setup();
    fund(ctx, 220);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    bet(ctx, id, 7, 20, 'alice');
}

#[test]
#[should_panic(expected: 'COMMITMENT_USED')]
fn reusing_a_commitment_is_refused() {
    let ctx = setup();
    fund(ctx, 240);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The ladder: three markets, one transaction, one fee, one custody check per token
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn three_bets_across_three_markets_ride_one_custody_check() {
    let ctx = setup();
    fund(ctx, 600);
    let a = create(ctx, 200, NOW + HOUR, 'seed_a');
    let b = create(ctx, 200, NOW + HOUR, 'seed_b');
    let c = create(ctx, 200, NOW + HOUR, 'seed_c');

    // ONE withdrawal covering all three stakes, then ONE invoke carrying all three bets — the
    // shape nothing in the protocol's 1,248-event history has ever used.
    fund(ctx, 60);
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_BET,
            array![
                3,
                a.into(),
                Markets::SIDE_UP.into(),
                20,
                commit('rung1'),
                b.into(),
                Markets::SIDE_UP.into(),
                20,
                commit('rung2'),
                c.into(),
                Markets::SIDE_DOWN.into(),
                20,
                commit('rung3'),
            ]
                .span(),
        );

    assert(ctx.markets.get_position(commit('rung1')).tickets == 38, 'rung 1 filled');
    assert(ctx.markets.get_position(commit('rung2')).tickets == 38, 'rung 2 filled');
    assert(ctx.markets.get_position(commit('rung3')).tickets == 38, 'rung 3 filled');
    assert(ctx.markets.get_market(a).collateral == 220, 'a took its stake');
    assert(ctx.markets.get_market(c).down == 182, 'c moved its down side');
}

// The custody check is over the SUM, not per bet — so money for two bets cannot buy three.
#[test]
#[should_panic(expected: 'FUNDS_NOT_RECEIVED')]
fn a_batch_funded_for_two_of_its_three_bets_is_refused() {
    let ctx = setup();
    fund(ctx, 600);
    let a = create(ctx, 200, NOW + HOUR, 'seed_a');
    let b = create(ctx, 200, NOW + HOUR, 'seed_b');
    let c = create(ctx, 200, NOW + HOUR, 'seed_c');

    fund(ctx, 40);
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_BET,
            array![
                3,
                a.into(),
                Markets::SIDE_UP.into(),
                20,
                commit('rung1'),
                b.into(),
                Markets::SIDE_UP.into(),
                20,
                commit('rung2'),
                c.into(),
                Markets::SIDE_UP.into(),
                20,
                commit('rung3'),
            ]
                .span(),
        );
}

// Two rungs on ONE market must see each other, or the second bettor gets a price that stopped
// existing earlier in the same transaction.
#[test]
fn two_bets_on_the_same_market_in_one_batch_move_the_price_between_them() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');

    fund(ctx, 40);
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_BET,
            array![
                2,
                id.into(),
                Markets::SIDE_UP.into(),
                20,
                commit('first'),
                id.into(),
                Markets::SIDE_UP.into(),
                20,
                commit('second'),
            ]
                .span(),
        );

    let first = ctx.markets.get_position(commit('first')).tickets;
    let second = ctx.markets.get_position(commit('second')).tickets;
    assert(first == 38, 'first pays the opening price');
    assert(second < first, 'second pays the moved price');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Settlement
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_fresh_price_above_the_strike_settles_up() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    resolve_with(ctx, id, ABOVE, deadline);

    let market = ctx.markets.get_market(id);
    assert(market.state == Markets::MARKET_RESOLVED, 'resolved');
    assert(market.winner == Markets::SIDE_UP, 'up wins');
}

// The line settles STRICTLY above, so landing exactly on the strike is a DOWN market. Worth
// pinning: it is the one case where a reader's intuition and the code can differ silently.
#[test]
fn a_price_exactly_on_the_strike_settles_down() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    resolve_with(ctx, id, STRIKE, deadline);

    assert(ctx.markets.get_market(id).winner == Markets::SIDE_DOWN, 'down wins on the line');
}

// The rival build settles on a raw spot read, and their own source comment records them watching
// a nine-minute-stale price go by. Given Pragma's measured 20–30 minute dead periods, this guard
// is the difference between settling the market and settling a different hour's price.
#[test]
#[should_panic(expected: 'ORACLE_STALE')]
fn a_price_older_than_the_freshness_guard_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    ctx.pragma.set_price(ABOVE, 8, deadline - Markets::ORACLE_MAX_LAG - 1);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(id);
}

#[test]
fn a_price_exactly_at_the_freshness_limit_still_settles() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    ctx.pragma.set_price(ABOVE, 8, deadline - Markets::ORACLE_MAX_LAG);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(id);

    assert(ctx.markets.get_market(id).state == Markets::MARKET_RESOLVED, 'settled at the limit');
}

#[test]
#[should_panic(expected: 'TOO_EARLY')]
fn settling_before_the_deadline_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    ctx.pragma.set_price(ABOVE, 8, deadline);
    start_cheat_block_timestamp_global(deadline - 1);
    ctx.markets.resolve(id);
}

#[test]
#[should_panic(expected: 'TOO_LATE')]
fn settling_after_the_resolve_window_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    ctx.pragma.set_price(ABOVE, 8, deadline);
    start_cheat_block_timestamp_global(deadline + Markets::RESOLVE_WINDOW + 1);
    ctx.markets.resolve(id);
}

// If the feed ever changes scale, the strike and the price are no longer the same units and the
// comparison is meaningless. Refusing here costs a void 300 seconds later; not refusing pays out
// the wrong side.
#[test]
#[should_panic(expected: 'ORACLE_DECIMALS')]
fn a_feed_that_changes_decimals_stops_settlement() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    ctx.pragma.set_price(ABOVE, 18, deadline);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(id);
}

#[test]
#[should_panic(expected: 'TOO_EARLY')]
fn voiding_before_its_timer_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER);
    ctx.markets.void(id);
}

#[test]
fn a_market_nobody_settled_can_be_voided_by_anyone() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER + 1);
    ctx.markets.void(id);

    assert(ctx.markets.get_market(id).state == Markets::MARKET_VOIDED, 'voided');
}

#[test]
#[should_panic(expected: 'MARKET_NOT_ACTIVE')]
fn a_voided_market_cannot_then_be_resolved() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER + 1);
    ctx.markets.void(id);

    ctx.pragma.set_price(ABOVE, 8, deadline);
    ctx.markets.resolve(id);
}

#[test]
#[should_panic(expected: 'MARKET_NOT_ACTIVE')]
fn a_resolved_market_cannot_then_be_voided() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    resolve_with(ctx, id, ABOVE, deadline);

    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER + 1);
    ctx.markets.void(id);
}

#[test]
#[should_panic(expected: 'MARKET_NOT_ACTIVE')]
fn resolving_a_market_that_does_not_exist_is_refused() {
    let ctx = setup();
    start_cheat_block_timestamp_global(NOW + HOUR);
    ctx.markets.resolve(99);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Claiming
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_winning_ticket_pays_one_to_one_and_the_pool_collects_it() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    resolve_with(ctx, id, ABOVE, deadline);
    assert(preview_one(ctx, 'alice') == 38, 'preview says 38');

    let deposits = ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CLAIM, array![1, 'alice', 'note1'].span(),
        );

    assert(deposits.len() == 1, 'exactly one deposit back');
    let deposit = *deposits.at(0);
    assert(deposit.amount == 38, 'a ticket is worth one');
    assert(deposit.note_id == 'note1', 'credited to the right note');
    assert(deposit.token == ctx.token.contract_address, 'paid in the stake token');

    // The approval was real: the pool actually took the money.
    assert(ctx.pool.pulled(ctx.token.contract_address) == 38, 'pool pulled the payout');
    assert(
        ctx.markets.get_position(commit('alice')).state == Markets::POS_CLAIMED, 'marked claimed',
    );
}

// The seeder is the counterparty, and what they take home is whatever is left in the winning
// reserve — 182 here, against 38 of winning tickets, for the 220 that went in.
#[test]
fn the_seeder_takes_the_winning_reserve_as_their_residual() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    resolve_with(ctx, id, ABOVE, deadline);

    assert(preview_one(ctx, 'seeder') == 182, 'residual is the up reserve');
    assert(preview_one(ctx, 'seeder') + preview_one(ctx, 'alice') == 220, 'and that is the pot');
}

// A zero-amount deposit reverts inside the pool, so a losing ticket must never reach a batch.
// `preview_claim` is how the client keeps it out; this is the backstop if it does not.
#[test]
#[should_panic(expected: 'NOTHING_TO_CLAIM')]
fn claiming_a_losing_ticket_panics_rather_than_returning_zero() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    resolve_with(ctx, id, BELOW, deadline);
    assert(preview_one(ctx, 'alice') == 0, 'preview warns first');

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CLAIM, array![1, 'alice', 'note1'].span(),
        );
}

#[test]
fn a_voided_market_refunds_every_position_at_what_it_paid_in() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    funded_bet(ctx, id, Markets::SIDE_DOWN, 50, 'bob');

    start_cheat_block_timestamp_global(deadline + Markets::VOID_AFTER + 1);
    ctx.markets.void(id);

    // Even the loser-to-be is made whole: a void is not a settlement.
    assert(preview_one(ctx, 'alice') == 20, 'alice gets her stake');
    assert(preview_one(ctx, 'bob') == 50, 'bob gets his stake');
    assert(preview_one(ctx, 'seeder') == 200, 'the seeder gets the seed');

    let deposits = ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CLAIM,
            array![3, 'alice', 'n1', 'bob', 'n2', 'seeder', 'n3'].span(),
        );
    assert(deposits.len() == 3, 'three refunds');
    assert(ctx.pool.pulled(ctx.token.contract_address) == 270, 'refunds equal the pot');
    assert(ctx.token.balance_of(ctx.markets.contract_address) == 0, 'nothing stranded');
}

#[test]
#[should_panic(expected: 'POSITION_NOT_OPEN')]
fn a_position_cannot_be_claimed_twice() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    resolve_with(ctx, id, ABOVE, deadline);

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CLAIM, array![1, 'alice', 'note1'].span(),
        );
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CLAIM, array![1, 'alice', 'note2'].span(),
        );
}

#[test]
#[should_panic(expected: 'POSITION_NOT_OPEN')]
fn a_secret_nobody_ever_bet_with_claims_nothing() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    resolve_with(ctx, id, ABOVE, deadline);

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CLAIM, array![1, 'nobody', 'note1'].span(),
        );
}

#[test]
#[should_panic(expected: 'MARKET_UNSETTLED')]
fn claiming_before_the_market_settles_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CLAIM, array![1, 'alice', 'note1'].span(),
        );
}

// The payout does not leave in this call — it leaves when the POOL pulls the approved sum while
// crediting the open notes it made earlier in the same transaction. Called by anyone else, this
// would mark the position spent and approve tokens to a collector that never comes.
#[test]
#[should_panic(expected: 'ONLY_POOL')]
fn a_claim_from_anyone_but_the_pool_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    resolve_with(ctx, id, ABOVE, deadline);

    ctx.markets.privacy_invoke(Markets::OP_CLAIM, array![1, 'alice', 'note1'].span());
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Batch settlement — the headline
// ─────────────────────────────────────────────────────────────────────────────────────────

// StarkWare's own anonymizer approves inside its deposit loop; because `approve` overwrites
// rather than accumulates, the second same-token pull in a batch finds too little allowance and
// the whole transaction reverts. `MockERC20` reproduces that behaviour exactly, so this test
// genuinely fails if the sum-then-approve-once discipline is ever lost.
#[test]
fn a_three_market_ladder_settles_in_one_batch_with_exactly_one_approval() {
    let ctx = setup();
    fund(ctx, 600);
    let deadline = NOW + HOUR;
    let a = create(ctx, 200, deadline, 'seed_a');
    let b = create(ctx, 200, deadline, 'seed_b');
    let c = create(ctx, 200, deadline, 'seed_c');

    funded_bet(ctx, a, Markets::SIDE_UP, 20, 'rung1');
    funded_bet(ctx, b, Markets::SIDE_UP, 20, 'rung2');
    funded_bet(ctx, c, Markets::SIDE_UP, 20, 'rung3');

    ctx.pragma.set_price(ABOVE, 8, deadline);
    start_cheat_block_timestamp_global(deadline + 10);
    ctx.markets.resolve(a);
    ctx.markets.resolve(b);
    ctx.markets.resolve(c);

    let approvals_before = ctx.token.approve_calls();

    let deposits = ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CLAIM,
            array![3, 'rung1', 'n1', 'rung2', 'n2', 'rung3', 'n3'].span(),
        );

    assert(deposits.len() == 3, 'exactly three deposits back');
    assert(ctx.token.approve_calls() - approvals_before == 1, 'ONE approval for the sum');
    assert(*deposits.at(0).note_id == 'n1', 'note ids in order');
    assert(*deposits.at(1).note_id == 'n2', 'note ids in order');
    assert(*deposits.at(2).note_id == 'n3', 'note ids in order');
    assert(ctx.pool.pulled(ctx.token.contract_address) == 114, 'three times 38 collected');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Conservation — the property the whole mechanism rests on
// ─────────────────────────────────────────────────────────────────────────────────────────

// Every payout plus the seeder's residual equals the collateral EXACTLY. Not within rounding:
// exactly. If this ever drifts, either someone is paid with someone else's stake or money is
// stranded in the contract forever, and both are the kind of bug a prediction market dies of.
#[test]
fn the_books_close_to_the_felt_across_a_full_lifecycle() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');

    // Deliberately awkward numbers on both sides, so the rounding has somewhere to hide.
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    funded_bet(ctx, id, Markets::SIDE_DOWN, 57, 'bob');
    funded_bet(ctx, id, Markets::SIDE_UP, 33, 'carol');

    let collateral = ctx.markets.get_market(id).collateral;
    assert(collateral == 310, 'seed plus every stake');
    assert(
        ctx.token.balance_of(ctx.markets.contract_address) == collateral.into(),
        'and it is all really here',
    );

    resolve_with(ctx, id, ABOVE, deadline);

    // UP won: alice and carol hold winning tickets, bob holds nothing, the seeder takes the rest.
    assert(preview_one(ctx, 'bob') == 0, 'the losing side is owed nothing');

    let deposits = ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CLAIM,
            array![3, 'alice', 'n1', 'carol', 'n2', 'seeder', 'n3'].span(),
        );
    assert(deposits.len() == 3, 'three deposits');

    let paid = *deposits.at(0).amount + *deposits.at(1).amount + *deposits.at(2).amount;
    assert(paid == collateral, 'payouts equal the pot exactly');
    assert(ctx.token.balance_of(ctx.markets.contract_address) == 0, 'nothing left behind');
    assert(ctx.pool.pulled(ctx.token.contract_address) == collateral.into(), 'the pool took it all');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Payload and dispatch discipline
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected: 'UNKNOWN_OP')]
fn an_unknown_op_is_refused() {
    let ctx = setup();
    ctx.markets.privacy_invoke(99, array![1].span());
}

#[test]
#[should_panic(expected: 'BAD_PAYLOAD')]
fn a_payload_with_a_trailing_felt_is_refused() {
    let ctx = setup();
    fund(ctx, 220);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    ctx
        .markets
        .privacy_invoke(
            Markets::OP_BET,
            array![1, id.into(), Markets::SIDE_UP.into(), 20, commit('alice'), 999].span(),
        );
}

#[test]
#[should_panic(expected: 'EMPTY_BATCH')]
fn a_batch_of_nothing_is_refused() {
    let ctx = setup();
    ctx.markets.privacy_invoke(Markets::OP_BET, array![0].span());
}

// Payouts cross the wire as u128 because that is what an `OpenNoteDeposit` carries. Anything
// that would not fit is refused at the boundary rather than silently truncated into a different
// number.
#[test]
#[should_panic(expected: 'AMOUNT_NOT_U128')]
fn a_stake_too_large_for_u128_is_refused_at_the_boundary() {
    let ctx = setup();
    fund(ctx, 220);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    ctx
        .markets
        .privacy_invoke(
            Markets::OP_BET,
            array![
                1,
                id.into(),
                Markets::SIDE_UP.into(),
                TOO_BIG_FOR_U128,
                commit('alice'),
            ]
                .span(),
        );
}

#[test]
#[should_panic(expected: 'BATCH_TOO_LARGE')]
fn a_batch_beyond_the_pools_note_ceiling_is_refused() {
    let ctx = setup();
    // Asserted through OP_BET rather than OP_CLAIM: claiming checks its caller first, so a
    // direct call there would be refused as ONLY_POOL before the batch size was ever read.
    ctx.markets.privacy_invoke(Markets::OP_BET, array![(batch::MAX_BATCH + 1).into()].span());
}

// Quotes render into the UI, so they must never panic — an unknown market is 0 tickets, not a
// broken page.
#[test]
fn quotes_are_total_and_never_panic() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');

    assert(ctx.markets.quote_bet(404, Markets::SIDE_UP, 20) == 0, 'unknown market quotes zero');
    assert(ctx.markets.quote_bet(id, 7, 20) == 0, 'bad side quotes zero');
    assert(ctx.markets.quote_bet(id, Markets::SIDE_UP, 0) == 0, 'zero stake quotes zero');
    assert(preview_one(ctx, 'nobody') == 0, 'unknown commitment previews 0');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The oracle wire shape
// ─────────────────────────────────────────────────────────────────────────────────────────

// A mock can never catch this: it would happily answer whatever variant we asked for. The only
// real check is against the calldata recorded from a live mainnet read —
// `evidence/day0-markets-launch-checks.json`, block 13955303, calldata `[0x0, pair_id]`.
// Reorder `DataType` and this test fails; leave it unreordered and settlement asks the oracle
// the question it means to ask.
#[test]
fn spot_entry_serialises_as_the_recorded_mainnet_calldata() {
    let mut out: Array<felt252> = array![];
    DataType::SpotEntry(BTC_USD).serialize(ref out);

    assert(out.len() == 2, 'two felts on the wire');
    assert(*out.at(0) == 0, 'SpotEntry is variant zero');
    assert(*out.at(1) == BTC_USD, 'then the pair id');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Leaving early
// ─────────────────────────────────────────────────────────────────────────────────────────

// Sell back with nothing having happened in between and you get your stake back to the felt, and
// the market is left exactly as it was found. That round trip is the sharpest check there is that
// the cash-out quadratic really is the inverse of the buy.
#[test]
fn an_immediate_cash_out_returns_the_stake_and_restores_the_market() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    assert(ctx.markets.quote_cashout(commit('alice')) == 20, 'quoted the stake back');

    let deposits = ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CASHOUT, array!['alice', 'note1', 0].span(),
        );

    assert(deposits.len() == 1, 'one deposit back');
    assert(*deposits.at(0).amount == 20, 'paid the stake back');

    let market = ctx.markets.get_market(id);
    assert(market.up == 200, 'up reserve restored');
    assert(market.down == 200, 'down reserve restored');
    assert(market.collateral == 200, 'collateral restored');
}

// The headline: the crowd moves your way and you can bank it before the market even ends.
//
// Hand arithmetic, continuing the worked vector. Alice holds 38 UP tickets against up = 182,
// down = 220. Bob then stakes 100 on UP: both reserves take it (282 / 320), the kept UP reserve
// is ceil(40_000 / 320) = 125, so bob gets 157 tickets and the market sits at up = 125, down = 320.
// Alice sells her 38 back: A = 125 + 38 = 163, B = 320, so A + B = 483 and the discriminant is
// 157² + 4·40_000 = 184_649. Its root is 429.7…, taken UP to 430, so she is paid
// (483 − 430) / 2 = 26 — against a stake of 20, with the clock still running.
#[test]
fn a_position_the_crowd_moved_in_favour_of_can_be_banked_early() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    funded_bet(ctx, id, Markets::SIDE_UP, 100, 'bob');

    assert(ctx.markets.get_position(commit('bob')).tickets == 157, 'bob paid the moved price');
    assert(ctx.markets.quote_cashout(commit('alice')) == 26, 'alice is up on her 20');

    let deposits = ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CASHOUT, array!['alice', 'note1', 26].span(),
        );
    assert(*deposits.at(0).amount == 26, 'and she is paid it');
    assert(ctx.pool.pulled(ctx.token.contract_address) == 26, 'the pool collected it');

    let market = ctx.markets.get_market(id);
    assert(market.up == 137, 'up reserve after the sale');
    assert(market.down == 294, 'down reserve after the sale');
    assert(market.collateral == 294, 'collateral after the sale');
}

// Odds move between quoting and landing, exactly as with a swap, so the client names its floor.
#[test]
#[should_panic(expected: 'BELOW_MIN_OUT')]
fn a_cash_out_that_slipped_below_the_floor_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CASHOUT, array!['alice', 'note1', 21].span(),
        );
}

#[test]
#[should_panic(expected: 'SEEDER_CANNOT_CASH_OUT')]
fn the_seeder_cannot_sell_their_side_back() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CASHOUT, array!['seeder', 'note1', 0].span(),
        );
}

#[test]
#[should_panic(expected: 'BETTING_CLOSED')]
fn cashing_out_after_the_deadline_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    start_cheat_block_timestamp_global(deadline);
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CASHOUT, array!['alice', 'note1', 0].span(),
        );
}

// Selling a position and then claiming it would be paid twice out of one pot. The shared
// POS_CLAIMED state is what makes the two paths mutually exclusive.
#[test]
#[should_panic(expected: 'POSITION_NOT_OPEN')]
fn a_position_sold_back_can_no_longer_be_claimed() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CASHOUT, array!['alice', 'note1', 0].span(),
        );

    resolve_with(ctx, id, ABOVE, deadline);
    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CLAIM, array![1, 'alice', 'note2'].span(),
        );
}

#[test]
#[should_panic(expected: 'ONLY_POOL')]
fn a_cash_out_from_anyone_but_the_pool_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let id = create(ctx, 200, NOW + HOUR, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    ctx.markets.privacy_invoke(Markets::OP_CASHOUT, array!['alice', 'note1', 0].span());
}

// Conservation has to survive someone leaving early, not just the straight-through path: after
// alice sells out, the pot still closes exactly over whoever is left.
#[test]
fn the_books_still_close_when_someone_leaves_before_the_end() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    funded_bet(ctx, id, Markets::SIDE_UP, 100, 'bob');

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address, Markets::OP_CASHOUT, array!['alice', 'note1', 0].span(),
        );

    let collateral = ctx.markets.get_market(id).collateral;
    assert(collateral == 294, 'the pot shrank by what she took');
    assert(
        ctx.token.balance_of(ctx.markets.contract_address) == collateral.into(),
        'and the balance agrees',
    );

    resolve_with(ctx, id, ABOVE, deadline);

    let deposits = ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CLAIM,
            array![2, 'bob', 'n1', 'seeder', 'n2'].span(),
        );
    let paid = *deposits.at(0).amount + *deposits.at(1).amount;
    assert(paid == collateral, 'the rest closes exactly');
    assert(ctx.token.balance_of(ctx.markets.contract_address) == 0, 'nothing left behind');
}

#[test]
fn cash_out_quotes_are_total_and_never_panic() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');

    assert(ctx.markets.quote_cashout(commit('nobody')) == 0, 'unknown quotes zero');
    assert(ctx.markets.quote_cashout(commit('seeder')) == 0, 'the seeder quotes zero');

    resolve_with(ctx, id, ABOVE, deadline);
    assert(ctx.markets.quote_cashout(commit('alice')) == 0, 'settled markets quote zero');
}

// A batch is not a way around the one-claim-per-position rule. The position is written back
// inside the loop, so the second copy of the same secret meets an already-closed position rather
// than being paid twice out of one pot.
#[test]
#[should_panic(expected: 'POSITION_NOT_OPEN')]
fn the_same_secret_twice_in_one_batch_is_refused() {
    let ctx = setup();
    fund(ctx, 200);
    let deadline = NOW + HOUR;
    let id = create(ctx, 200, deadline, 'seeder');
    funded_bet(ctx, id, Markets::SIDE_UP, 20, 'alice');
    resolve_with(ctx, id, ABOVE, deadline);

    ctx
        .pool
        .invoke(
            ctx.markets.contract_address,
            Markets::OP_CLAIM,
            array![2, 'alice', 'n1', 'alice', 'n2'].span(),
        );
}
