use core::num::traits::Zero;
use core::poseidon::poseidon_hash_span;
use snforge_std::{
    declare, start_cheat_block_timestamp_global, ContractClassTrait, DeclareResultTrait,
};
use strk20_app::launch::{ILaunchDispatcher, ILaunchDispatcherTrait, Launch};
use strk20_app::launch_token::{ILaunchTokenDispatcher, ILaunchTokenDispatcherTrait};
use strk20_app::mocks::{
    IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPoolDispatcher, IMockPoolDispatcherTrait,
};

const NOW: u64 = 1_700_000_000;
const DAY: u64 = 86400;

// The curve every test uses unless it says otherwise:
//   epochs 2 × 16 units = 32 units total
//   tranche 1600 tokens per epoch → 100 tokens per unit → 3200 total supply
//   epoch 0 prices a unit at 100, epoch 1 at 110
//   a full sale therefore raises 16×100 + 16×110 = 1600 + 1760 = 3360
const EPOCHS: u32 = 2;
const TRANCHE: u128 = 1600;
const UNIT_TOKENS: u128 = 100;
const TOTAL_UNITS: u32 = 32;
const TOTAL_SUPPLY: u128 = 3200;
const P0: u128 = 100;
const DP: u128 = 10;
const FULL_RAISE: u128 = 3360;

#[derive(Copy, Drop)]
struct Ctx {
    launch: ILaunchDispatcher,
    pool: IMockPoolDispatcher,
    stake: IMockERC20Dispatcher,
}

fn setup() -> Ctx {
    let (stake_addr, _) = declare("MockERC20")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let (pool_addr, _) = declare("MockPool").unwrap().contract_class().deploy(@array![]).unwrap();
    let token_class = *declare("LaunchToken").unwrap().contract_class().class_hash;
    let (launch_addr, _) = declare("Launch")
        .unwrap()
        .contract_class()
        .deploy(@array![pool_addr.into(), token_class.into()])
        .unwrap();

    start_cheat_block_timestamp_global(NOW);

    Ctx {
        launch: ILaunchDispatcher { contract_address: launch_addr },
        pool: IMockPoolDispatcher { contract_address: pool_addr },
        stake: IMockERC20Dispatcher { contract_address: stake_addr },
    }
}

/// The client keeps `secret`; the chain only ever sees this.
fn commit(secret: felt252) -> felt252 {
    poseidon_hash_span(array![secret].span())
}

/// Stand in for the pool's phase-6 withdrawal: money lands in the contract's balance BEFORE the
/// invoke that claims it, which is the only reason `take_custody` can verify anything.
fn fund(ctx: Ctx, amount: u128) {
    ctx.stake.mint(ctx.launch.contract_address, amount.into());
}

fn create(ctx: Ctx) -> u64 {
    create_with(ctx, P0, DP, TRANCHE, EPOCHS, NOW + DAY)
}

fn create_with(
    ctx: Ctx, p0: u128, dp: u128, tranche: u128, epochs: u32, deadline: u64,
) -> u64 {
    ctx
        .launch
        .create_launch(
            "Passbook Token",
            "PBK",
            "ipfs://logo",
            ctx.stake.contract_address,
            p0,
            dp,
            tranche,
            epochs,
            deadline,
            commit('creator'),
        )
}

/// A funded buy of `units` units, priced by the contract itself.
fn buy(ctx: Ctx, launch_id: u64, units: u32, secret: felt252) {
    fund(ctx, ctx.launch.quote_buy(launch_id, units));
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_BUY,
            array![1, launch_id.into(), units.into(), commit(secret)].span(),
        );
}

fn token_of(ctx: Ctx, launch_id: u64) -> ILaunchTokenDispatcher {
    ILaunchTokenDispatcher { contract_address: ctx.launch.get_launch(launch_id).token }
}

/// Buys every unit across four commitments, so graduation tests have real holders to redeem.
fn sell_out(ctx: Ctx, launch_id: u64) {
    buy(ctx, launch_id, 8, 'buyer_a');
    buy(ctx, launch_id, 8, 'buyer_b');
    buy(ctx, launch_id, 8, 'buyer_c');
    buy(ctx, launch_id, 8, 'buyer_d');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Creating
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_created_launch_records_its_curve_and_its_creator() {
    let ctx = setup();
    let id = create(ctx);

    let launch = ctx.launch.get_launch(id);
    assert(launch.state == Launch::LAUNCH_ACTIVE, 'active');
    assert(launch.p0 == P0, 'opening price');
    assert(launch.dp == DP, 'price step');
    assert(launch.unit_tokens == UNIT_TOKENS, 'tokens per unit');
    assert(launch.epochs == EPOCHS, 'epoch count');
    assert(launch.sold == 0, 'nothing sold yet');
    assert(launch.raised == 0, 'nothing raised yet');
    assert(launch.token.is_zero(), 'no token before graduation');
    assert(launch.creator_commitment == commit('creator'), 'creator is a commitment');
    assert(!launch.swept, 'not swept');

    assert(ctx.launch.total_units(id) == TOTAL_UNITS, 'sixteen units per epoch');
    assert(ctx.launch.launch_count() == 1, 'one launch');
    assert(ctx.launch.launch_name(id) == "Passbook Token", 'name kept');
    assert(ctx.launch.launch_symbol(id) == "PBK", 'symbol kept');
    assert(ctx.launch.launch_logo(id) == "ipfs://logo", 'logo kept');
}

// Creating moves no money, so it can be relayer-sponsored — and because the creator is a
// commitment rather than an address, the relayer that paid the gas still cannot sweep the raise.
#[test]
fn creating_takes_no_funds_at_all() {
    let ctx = setup();
    create(ctx);
    assert(ctx.stake.balance_of(ctx.launch.contract_address) == 0, 'no money moved');
}

// If the tranche does not divide into 16, the unit is a lie and someone gets short-changed by the
// rounding. Refusing at creation is the only place this can be caught cleanly.
#[test]
#[should_panic(expected: 'TRANCHE_NOT_DIVISIBLE')]
fn a_tranche_that_does_not_divide_into_units_is_refused() {
    let ctx = setup();
    create_with(ctx, P0, DP, 1601, EPOCHS, NOW + DAY);
}

#[test]
#[should_panic(expected: 'DEADLINE_PASSED')]
fn a_launch_whose_deadline_has_already_passed_is_refused() {
    let ctx = setup();
    create_with(ctx, P0, DP, TRANCHE, EPOCHS, NOW);
}

#[test]
#[should_panic(expected: 'BAD_EPOCHS')]
fn a_launch_with_no_epochs_is_refused() {
    let ctx = setup();
    create_with(ctx, P0, DP, TRANCHE, 0, NOW + DAY);
}

#[test]
#[should_panic(expected: 'BAD_NAME')]
fn a_nameless_launch_is_refused() {
    let ctx = setup();
    ctx
        .launch
        .create_launch(
            "",
            "PBK",
            "ipfs://logo",
            ctx.stake.contract_address,
            P0,
            DP,
            TRANCHE,
            EPOCHS,
            NOW + DAY,
            commit('creator'),
        );
}

// The whole raise is proven to fit u128 at creation, so no buyer ever discovers the ceiling by
// having their own transaction revert.
#[test]
#[should_panic(expected: 'RAISE_EXCEEDS_U128')]
fn a_curve_whose_completed_raise_would_not_fit_is_refused() {
    let ctx = setup();
    create_with(ctx, 0x80000000000000000000000000000000, 0, TRANCHE, 64, NOW + DAY);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// The curve
// ─────────────────────────────────────────────────────────────────────────────────────────

// THE HEADLINE. On a continuous bonding curve the first buyer of a block pays less than the last,
// so racing pays. Here the sixteenth unit of an epoch costs exactly what the first one did, and
// being early inside an epoch is worth precisely nothing. This test is that claim.
#[test]
fn everyone_inside_an_epoch_pays_the_same_price() {
    let ctx = setup();
    let id = create(ctx);

    let first = ctx.launch.quote_buy(id, 1);
    buy(ctx, id, 15, 'early');
    let sixteenth = ctx.launch.quote_buy(id, 1);

    assert(first == P0, 'opening unit costs p0');
    assert(sixteenth == first, 'so does the last of the epoch');
}

#[test]
fn an_in_epoch_buy_costs_units_times_that_epochs_price() {
    let ctx = setup();
    let id = create(ctx);

    // Four units, all inside epoch 0: 4 × 100.
    assert(ctx.launch.quote_buy(id, 4) == 400, 'four units at a hundred');

    buy(ctx, id, 4, 'buyer');
    let launch = ctx.launch.get_launch(id);
    assert(launch.sold == 4, 'four sold');
    assert(launch.raised == 400, 'four hundred raised');
    assert(ctx.launch.get_position(commit('buyer')).cash_in == 400, 'and recorded on the position');
}

// Hand arithmetic: with 14 units gone, two remain in epoch 0 at 100 each, and the next two are
// epoch 1 at 110 each. So 200 + 220 = 420 — neither 4×100 nor 4×110. A blended price would be
// wrong in both directions and this is the test that says which.
#[test]
fn a_buy_crossing_an_epoch_boundary_pays_each_slice_its_own_price() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 14, 'early');

    assert(ctx.launch.quote_buy(id, 4) == 420, 'two at 100 plus two at 110');

    buy(ctx, id, 4, 'crosser');
    assert(ctx.launch.get_position(commit('crosser')).cash_in == 420, 'charged the split price');
    assert(ctx.launch.get_launch(id).raised == 1400 + 420, 'raise agrees');
}

#[test]
fn the_price_steps_up_exactly_at_the_epoch_boundary() {
    let ctx = setup();
    let id = create(ctx);

    buy(ctx, id, 15, 'early');
    assert(ctx.launch.quote_buy(id, 1) == 100, 'last unit of epoch 0');
    buy(ctx, id, 1, 'boundary');
    assert(ctx.launch.quote_buy(id, 1) == 110, 'first unit of epoch 1');
}

// Selling the whole curve must raise exactly what the creation-time overflow check computed.
#[test]
fn a_full_sale_raises_the_whole_curve_exactly() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);

    let launch = ctx.launch.get_launch(id);
    assert(launch.sold == TOTAL_UNITS, 'every unit sold');
    assert(launch.raised == FULL_RAISE, '16 at 100 plus 16 at 110');
}

#[test]
#[should_panic(expected: 'NOT_ENOUGH_UNITS')]
fn buying_more_units_than_remain_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 30, 'early');
    buy(ctx, id, 3, 'greedy');
}

#[test]
#[should_panic(expected: 'ZERO_UNITS')]
fn a_buy_of_nothing_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_BUY,
            array![1, id.into(), 0, commit('buyer')].span(),
        );
}

// Nothing about `privacy_invoke` proves the stake arrived — the pool withdraws and invokes in one
// transaction and tells us nothing. This is the test that says we look rather than trust.
#[test]
#[should_panic(expected: 'FUNDS_NOT_RECEIVED')]
fn an_unfunded_buy_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_BUY,
            array![1, id.into(), 4, commit('buyer')].span(),
        );
}

#[test]
#[should_panic(expected: 'SALE_CLOSED')]
fn buying_after_the_deadline_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    fund(ctx, 400);
    start_cheat_block_timestamp_global(NOW + DAY);
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_BUY,
            array![1, id.into(), 4, commit('late')].span(),
        );
}

#[test]
#[should_panic(expected: 'COMMITMENT_USED')]
fn reusing_a_commitment_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 4, 'buyer');
    buy(ctx, id, 4, 'buyer');
}

// Two buys of the same launch in one batch must walk the curve in order — otherwise the second
// buyer pays a price that stopped existing earlier in the same transaction.
#[test]
fn two_buys_of_one_launch_in_a_batch_walk_the_curve_in_order() {
    let ctx = setup();
    let id = create(ctx);

    // 14 units to sit just under the boundary, then 2 + 4 in one batch: the first pair finishes
    // epoch 0 at 100 each (200), the next four are all epoch 1 at 110 each (440).
    buy(ctx, id, 14, 'early');
    fund(ctx, 200 + 440);
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_BUY,
            array![
                2, id.into(), 2, commit('first'), id.into(), 4, commit('second'),
            ]
                .span(),
        );

    assert(ctx.launch.get_position(commit('first')).cash_in == 200, 'first finished epoch 0');
    assert(ctx.launch.get_position(commit('second')).cash_in == 440, 'second paid epoch 1');
    assert(ctx.launch.get_launch(id).sold == 20, 'twenty sold');
}

// The custody check is over the SUM, so funds for one buy cannot pay for two.
#[test]
#[should_panic(expected: 'FUNDS_NOT_RECEIVED')]
fn a_batch_funded_for_one_of_its_two_buys_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    fund(ctx, 400);
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_BUY,
            array![
                2, id.into(), 4, commit('first'), id.into(), 4, commit('second'),
            ]
                .span(),
        );
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Graduation
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn an_exactly_filled_launch_graduates_and_deploys_its_token() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);

    ctx.launch.graduate(id);

    let launch = ctx.launch.get_launch(id);
    assert(launch.state == Launch::LAUNCH_GRADUATED, 'graduated');
    assert(launch.token.is_non_zero(), 'a token exists');

    let token = token_of(ctx, id);
    assert(token.name() == "Passbook Token", 'the name it was created with');
    assert(token.symbol() == "PBK", 'and the symbol');
    assert(token.decimals() == 18, 'eighteen decimals');
    assert(token.total_supply() == TOTAL_SUPPLY.into(), 'thirty-two units of a hundred');
    // The whole supply is held against redemptions, not scattered anywhere.
    assert(
        token.balance_of(ctx.launch.contract_address) == TOTAL_SUPPLY.into(),
        'held by the launch itself',
    );
}

#[test]
#[should_panic(expected: 'NOT_SOLD_OUT')]
fn graduating_before_the_last_unit_sells_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 31, 'nearly');
    ctx.launch.graduate(id);
}

#[test]
#[should_panic(expected: 'LAUNCH_NOT_ACTIVE')]
fn graduating_twice_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);
    ctx.launch.graduate(id);
}

// Graduation has no deadline of its own: a launch that sold every unit has earned its token, and
// whether anyone remembered to call `graduate` in time is not a reason to strand a finished sale.
#[test]
fn a_sold_out_launch_can_still_graduate_long_after_its_deadline() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);

    start_cheat_block_timestamp_global(NOW + DAY * 30);
    ctx.launch.graduate(id);
    assert(ctx.launch.get_launch(id).state == Launch::LAUNCH_GRADUATED, 'still graduates');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Redeeming
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_buyer_redeems_units_for_tokens_into_the_pool() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);

    let expected: u128 = 8 * UNIT_TOKENS;
    let preview = ctx.launch.preview_redeem(array![commit('buyer_a')].span());
    assert(*preview.at(0) == expected, 'eight units of a hundred');

    let deposits = ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_REDEEM,
            array![1, 'buyer_a', 'note1'].span(),
        );

    assert(deposits.len() == 1, 'exactly one deposit');
    let deposit = *deposits.at(0);
    assert(deposit.amount == expected, 'paid in tokens, not stake');
    assert(deposit.note_id == 'note1', 'credited to the right note');
    assert(deposit.token == ctx.launch.get_launch(id).token, 'the launch token');

    // The approval was real: the pool actually collected the tokens.
    let token = token_of(ctx, id);
    assert(token.balance_of(ctx.pool.contract_address) == expected.into(), 'pool holds them now');
}

#[test]
#[should_panic(expected: 'NOT_GRADUATED')]
fn redeeming_before_graduation_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 8, 'buyer_a');
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_REDEEM,
            array![1, 'buyer_a', 'note1'].span(),
        );
}

#[test]
#[should_panic(expected: 'POSITION_NOT_OPEN')]
fn redeeming_twice_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);

    ctx
        .pool
        .invoke(
            ctx.launch.contract_address, Launch::OP_REDEEM, array![1, 'buyer_a', 'n1'].span(),
        );
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address, Launch::OP_REDEEM, array![1, 'buyer_a', 'n2'].span(),
        );
}

#[test]
#[should_panic(expected: 'ONLY_POOL')]
fn a_redemption_from_anyone_but_the_pool_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);

    ctx.launch.privacy_invoke(Launch::OP_REDEEM, array![1, 'buyer_a', 'note1'].span());
}

// The batch discipline that makes multi-note settlement possible at all: sum first, approve once.
// `MockERC20` reproduces the overwrite semantics that break a per-deposit approve loop, and
// `LaunchToken` has the same behaviour, so this fails for real if the discipline is lost.
#[test]
fn a_batch_redemption_returns_n_deposits_and_pays_every_one() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);

    let deposits = ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_REDEEM,
            array![3, 'buyer_a', 'n1', 'buyer_b', 'n2', 'buyer_c', 'n3'].span(),
        );

    assert(deposits.len() == 3, 'three deposits back');
    assert(*deposits.at(0).note_id == 'n1', 'note ids in order');
    assert(*deposits.at(1).note_id == 'n2', 'note ids in order');
    assert(*deposits.at(2).note_id == 'n3', 'note ids in order');

    let token = token_of(ctx, id);
    let expected: u256 = (3 * 8 * UNIT_TOKENS).into();
    assert(token.balance_of(ctx.pool.contract_address) == expected, 'all three pulled');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Failing and refunding
// ─────────────────────────────────────────────────────────────────────────────────────────

// No keeper has to be alive for people to get their money back: the person who wants the refund
// is the one who flips the launch to Failed, in the same transaction that pays them.
#[test]
fn the_first_refund_after_a_missed_deadline_flips_the_launch_to_failed() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 4, 'buyer');

    start_cheat_block_timestamp_global(NOW + DAY);
    assert(ctx.launch.get_launch(id).state == Launch::LAUNCH_ACTIVE, 'not flipped yet');
    // The view already tells the truth, though, because it cannot write.
    assert(*ctx.launch.preview_refund(array![commit('buyer')].span()).at(0) == 400, 'refundable');

    let deposits = ctx
        .pool
        .invoke(
            ctx.launch.contract_address, Launch::OP_REFUND, array![1, 'buyer', 'note1'].span(),
        );

    assert(deposits.len() == 1, 'one refund');
    assert(*deposits.at(0).amount == 400, 'exactly what was paid in');
    assert(*deposits.at(0).token == ctx.stake.contract_address, 'in the stake token');
    assert(ctx.launch.get_launch(id).state == Launch::LAUNCH_FAILED, 'now flipped');
    assert(ctx.pool.pulled(ctx.stake.contract_address) == 400, 'and the pool took it');
}

#[test]
#[should_panic(expected: 'NOT_FAILED')]
fn refunding_before_the_deadline_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 4, 'buyer');
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address, Launch::OP_REFUND, array![1, 'buyer', 'note1'].span(),
        );
}

#[test]
#[should_panic(expected: 'POSITION_NOT_OPEN')]
fn refunding_twice_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 4, 'buyer');
    start_cheat_block_timestamp_global(NOW + DAY);

    ctx
        .pool
        .invoke(ctx.launch.contract_address, Launch::OP_REFUND, array![1, 'buyer', 'n1'].span());
    ctx
        .pool
        .invoke(ctx.launch.contract_address, Launch::OP_REFUND, array![1, 'buyer', 'n2'].span());
}

// A launch that sold every unit is never failed, however long it sits unGraduated. Its buyers are
// owed tokens, not their money back, and letting them refund would double-spend the sale.
#[test]
#[should_panic(expected: 'NOT_FAILED')]
fn a_sold_out_launch_never_fails_however_late_it_gets() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);

    start_cheat_block_timestamp_global(NOW + DAY * 30);
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address, Launch::OP_REFUND, array![1, 'buyer_a', 'note1'].span(),
        );
}

#[test]
#[should_panic(expected: 'POSITION_NOT_OPEN')]
fn a_redeemed_position_cannot_also_be_refunded() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address, Launch::OP_REDEEM, array![1, 'buyer_a', 'n1'].span(),
        );

    start_cheat_block_timestamp_global(NOW + DAY * 30);
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address, Launch::OP_REFUND, array![1, 'buyer_a', 'n2'].span(),
        );
}

#[test]
#[should_panic(expected: 'ONLY_POOL')]
fn a_refund_from_anyone_but_the_pool_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 4, 'buyer');
    start_cheat_block_timestamp_global(NOW + DAY);

    ctx.launch.privacy_invoke(Launch::OP_REFUND, array![1, 'buyer', 'note1'].span());
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Sweeping
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn the_creator_sweeps_the_raise_once_on_proof_of_the_secret() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);

    let treasury: starknet::ContractAddress = 'treasury'.try_into().unwrap();
    ctx.launch.sweep(id, 'creator', treasury);

    assert(ctx.stake.balance_of(treasury) == FULL_RAISE.into(), 'the whole raise landed');
    assert(ctx.stake.balance_of(ctx.launch.contract_address) == 0, 'and none was left behind');
    assert(ctx.launch.get_launch(id).swept, 'marked swept');
}

#[test]
#[should_panic(expected: 'ALREADY_SWEPT')]
fn sweeping_twice_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);

    let treasury: starknet::ContractAddress = 'treasury'.try_into().unwrap();
    ctx.launch.sweep(id, 'creator', treasury);
    ctx.launch.sweep(id, 'creator', treasury);
}

// Sweeping is by SECRET, never by address — which is what lets the create be relayer-sponsored
// without handing the relayer the raise.
#[test]
#[should_panic(expected: 'BAD_CREATOR_SECRET')]
fn the_wrong_secret_cannot_sweep() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);

    let attacker: starknet::ContractAddress = 'attacker'.try_into().unwrap();
    ctx.launch.sweep(id, 'not_the_creator', attacker);
}

// On failure the stake is the buyers' money, not the creator's.
#[test]
#[should_panic(expected: 'NOT_GRADUATED')]
fn a_failed_launch_cannot_be_swept() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 4, 'buyer');
    start_cheat_block_timestamp_global(NOW + DAY);

    let treasury: starknet::ContractAddress = 'treasury'.try_into().unwrap();
    ctx.launch.sweep(id, 'creator', treasury);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Conservation — the properties the whole design rests on
// ─────────────────────────────────────────────────────────────────────────────────────────

// Failed: every buyer takes back exactly what they paid, and the contract keeps nothing.
#[test]
fn every_refund_returns_exactly_what_was_raised() {
    let ctx = setup();
    let id = create(ctx);
    buy(ctx, id, 3, 'buyer_a');
    buy(ctx, id, 7, 'buyer_b');
    buy(ctx, id, 11, 'buyer_c');

    let raised = ctx.launch.get_launch(id).raised;
    assert(
        ctx.stake.balance_of(ctx.launch.contract_address) == raised.into(),
        'the raise is really here',
    );

    start_cheat_block_timestamp_global(NOW + DAY);
    let deposits = ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_REFUND,
            array![3, 'buyer_a', 'n1', 'buyer_b', 'n2', 'buyer_c', 'n3'].span(),
        );

    let refunded = *deposits.at(0).amount + *deposits.at(1).amount + *deposits.at(2).amount;
    assert(refunded == raised, 'refunds equal the raise exactly');
    assert(ctx.stake.balance_of(ctx.launch.contract_address) == 0, 'nothing stranded');
}

// Graduated: every unit's tokens are redeemed, the supply lands exactly, and the creator's sweep
// takes the stake side to zero. Both sides of the launch close to the base unit.
#[test]
fn a_graduated_launch_closes_both_sides_to_the_base_unit() {
    let ctx = setup();
    let id = create(ctx);
    sell_out(ctx, id);
    ctx.launch.graduate(id);

    let deposits = ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_REDEEM,
            array![
                4, 'buyer_a', 'n1', 'buyer_b', 'n2', 'buyer_c', 'n3', 'buyer_d', 'n4',
            ]
                .span(),
        );

    let redeemed = *deposits.at(0).amount
        + *deposits.at(1).amount
        + *deposits.at(2).amount
        + *deposits.at(3).amount;
    assert(redeemed == TOTAL_SUPPLY, 'every token redeemed');

    let token = token_of(ctx, id);
    assert(token.balance_of(ctx.launch.contract_address) == 0, 'no tokens left behind');

    let treasury: starknet::ContractAddress = 'treasury'.try_into().unwrap();
    ctx.launch.sweep(id, 'creator', treasury);
    assert(ctx.stake.balance_of(ctx.launch.contract_address) == 0, 'no stake left behind');
    assert(ctx.stake.balance_of(treasury) == FULL_RAISE.into(), 'the creator got the raise');
}

// The attack the graduation-time ledger write exists to stop.
//
// `take_custody` recognises new money as `balance_of - accounted`. A freshly minted supply sitting
// unbooked would read as free money: open a SECOND launch whose stake token is the first launch's
// token, "buy" it with the supply being held for the first launch's real buyers, then sweep it.
// Booking the supply the moment it is minted is what makes this unfundable.
#[test]
#[should_panic(expected: 'FUNDS_NOT_RECEIVED')]
fn a_graduated_supply_cannot_be_spent_as_another_launchs_stake() {
    let ctx = setup();
    let first = create(ctx);
    sell_out(ctx, first);
    ctx.launch.graduate(first);

    let victim_token = ctx.launch.get_launch(first).token;
    let second = ctx
        .launch
        .create_launch(
            "Parasite",
            "PAR",
            "",
            victim_token,
            P0,
            DP,
            TRANCHE,
            EPOCHS,
            NOW + DAY,
            commit('attacker'),
        );

    // No stake is ever sent — the attacker is betting the held supply reads as unbooked funds.
    ctx
        .pool
        .invoke(
            ctx.launch.contract_address,
            Launch::OP_BUY,
            array![1, second.into(), 4, commit('parasite')].span(),
        );
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Dispatch and payload discipline
// ─────────────────────────────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected: 'UNKNOWN_OP')]
fn an_unknown_op_is_refused() {
    let ctx = setup();
    ctx.launch.privacy_invoke(99, array![1].span());
}

#[test]
#[should_panic(expected: 'BAD_PAYLOAD')]
fn a_payload_with_a_trailing_felt_is_refused() {
    let ctx = setup();
    let id = create(ctx);
    ctx
        .launch
        .privacy_invoke(
            Launch::OP_BUY, array![1, id.into(), 4, commit('buyer'), 999].span(),
        );
}

#[test]
#[should_panic(expected: 'UNITS_NOT_U32')]
fn a_unit_count_too_large_for_u32_is_refused_at_the_boundary() {
    let ctx = setup();
    let id = create(ctx);
    ctx
        .launch
        .privacy_invoke(
            Launch::OP_BUY, array![1, id.into(), 0x100000000, commit('buyer')].span(),
        );
}

// Quotes and previews render into the UI, so they must never panic.
#[test]
fn quotes_and_previews_are_total_and_never_panic() {
    let ctx = setup();
    let id = create(ctx);

    assert(ctx.launch.quote_buy(404, 4) == 0, 'unknown launch quotes zero');
    assert(ctx.launch.quote_buy(id, 0) == 0, 'zero units quotes zero');
    assert(ctx.launch.quote_buy(id, TOTAL_UNITS + 1) == 0, 'an impossible size quotes 0');
    assert(*ctx.launch.preview_redeem(array![commit('nobody')].span()).at(0) == 0, 'no redemption');
    assert(*ctx.launch.preview_refund(array![commit('nobody')].span()).at(0) == 0, 'no refund');
}

// `units` arrives from a felt and can be near 2^32. Adding it to `sold` would overflow u32 and
// panic with a generic arithmetic error — and inside `quote_buy`, which is supposed to be total,
// it would panic a view. Both paths subtract instead.
#[test]
fn an_absurd_unit_count_is_refused_by_name_not_by_overflow() {
    let ctx = setup();
    let id = create(ctx);
    assert(ctx.launch.quote_buy(id, 0xfffffffe) == 0, 'the view stays total');
}

#[test]
#[should_panic(expected: 'NOT_ENOUGH_UNITS')]
fn an_absurd_unit_count_is_refused_at_the_buy() {
    let ctx = setup();
    let id = create(ctx);
    ctx
        .launch
        .privacy_invoke(
            Launch::OP_BUY, array![1, id.into(), 0xfffffffe, commit('buyer')].span(),
        );
}
