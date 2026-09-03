//! What `VesuEarn` must do with real money, proved against a vault whose share price is not 1:1.
//!
//! The share price is deliberately 1.25 underlying per share throughout. At 1:1 a redeem that
//! passes a SHARE count and a redeem that passes an UNDERLYING amount return the same number, and
//! the upstream bug this contract was written to avoid — the published helper calling Vesu's
//! `withdraw(assets)` where the corrected source calls `redeem(shares)` — would pass every test
//! here unnoticed. At 1.25 the two differ by 25%, and `last_redeem_shares` catches it.

use snforge_std::{declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address, stop_cheat_caller_address};
use strk20_app::mocks::{IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockVTokenDispatcher, IMockVTokenDispatcherTrait};
use strk20_app::vesu_earn::{EarnOperation, IVesuEarnDispatcher, IVesuEarnDispatcherTrait};
use starknet::ContractAddress;

/// 1.25 underlying per whole share, scaled by `MockVToken::SHARE_SCALE`.
const PRICE: u256 = 1_250_000_000_000_000_000;
const SHARE_SCALE: u256 = 1_000_000_000_000_000_000;
const NOTE: felt252 = 'note-1';

fn addr(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

#[derive(Copy, Drop)]
struct Ctx {
    earn: IVesuEarnDispatcher,
    usdc: IMockERC20Dispatcher,
    /// The vault and the share token are one address, as they are on Vesu.
    vault: IMockVTokenDispatcher,
    pool: ContractAddress,
    helper: ContractAddress,
}

fn setup() -> Ctx {
    let erc20 = declare("MockERC20").unwrap().contract_class();
    let (usdc, _) = erc20.deploy(@array![]).unwrap();

    let vault_class = declare("MockVToken").unwrap().contract_class();
    let mut vault_args = array![];
    vault_args.append(usdc.into());
    vault_args.append(PRICE.low.into());
    vault_args.append(PRICE.high.into());
    let (vault, _) = vault_class.deploy(@vault_args).unwrap();

    let pool = addr('pool');
    let earn_class = declare("VesuEarn").unwrap().contract_class();
    let (helper, _) = earn_class.deploy(@array![pool.into()]).unwrap();

    Ctx {
        earn: IVesuEarnDispatcher { contract_address: helper },
        usdc: IMockERC20Dispatcher { contract_address: usdc },
        vault: IMockVTokenDispatcher { contract_address: vault },
        pool,
        helper,
    }
}

#[test]
fn only_the_pool_may_invoke() {
    let ctx = setup();
    assert(ctx.earn.pool() == ctx.pool, 'constructor kept the pool');
}

#[test]
#[should_panic(expected: 'ONLY_POOL')]
fn a_stranger_is_refused() {
    let ctx = setup();
    ctx.usdc.mint(ctx.helper, 100_000_000);
    // No caller cheat: the caller is the test, which is not the pool. The published helper is
    // permissionless here, and this is the one behavioural change we made to it.
    ctx
        .earn
        .privacy_invoke(
            EarnOperation::Supply,
            ctx.usdc.contract_address,
            ctx.vault.contract_address,
            100_000_000,
            NOTE,
        );
}

#[test]
fn a_supply_mints_shares_and_approves_the_pool_for_them() {
    let ctx = setup();
    // Phase 6: the pool withdraws the underlying to the helper. Then it invokes.
    ctx.usdc.mint(ctx.helper, 100_000_000); // 100 USDC, 6 decimals

    start_cheat_caller_address(ctx.helper, ctx.pool);
    let deposits = ctx
        .earn
        .privacy_invoke(
            EarnOperation::Supply,
            ctx.usdc.contract_address,
            ctx.vault.contract_address,
            100_000_000,
            NOTE,
        );
    stop_cheat_caller_address(ctx.helper);

    // 100 USDC at 1.25 per share is 80 shares, in 18 decimals.
    let expected: u256 = 100_000_000 * SHARE_SCALE / PRICE;
    assert(deposits.len() == 1, 'one deposit');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == NOTE, 'the note it was told');
    assert(deposit.token == ctx.vault.contract_address, 'the vToken, not the USDC');
    assert(deposit.amount.into() == expected, 'shares measured, not assumed');
    // Value does not leave here — the pool pulls it while crediting the note.
    assert(ctx.vault.allowance(ctx.helper, ctx.pool) == expected, 'pool approved for it');
    assert(ctx.vault.last_deposit_assets() == 100_000_000, 'deposit got the assets');
}

#[test]
fn a_redeem_burns_the_exact_share_count_it_was_given() {
    let ctx = setup();
    let shares: u256 = 80_000_000_000_000_000_000; // 80 shares, worth 100 USDC at 1.25
    ctx.vault.mint(ctx.helper, shares);

    start_cheat_caller_address(ctx.helper, ctx.pool);
    let deposits = ctx
        .earn
        .privacy_invoke(
            EarnOperation::Redeem,
            ctx.vault.contract_address,
            ctx.usdc.contract_address,
            shares,
            NOTE,
        );
    stop_cheat_caller_address(ctx.helper);

    // ── THE ASSERTION THIS WHOLE FILE EXISTS FOR ──────────────────────────────────────────
    //
    // The vault received the SHARE count verbatim. Had this contract passed an underlying amount
    // the way the published helper and the SDK README do, the vault would have been handed
    // 100_000_000 here — a number 800 billion times too small, which at this price redeems dust.
    assert(ctx.vault.last_redeem_shares() == shares, 'exact shares, not assets');

    let expected: u256 = shares * PRICE / SHARE_SCALE; // 100 USDC
    assert(deposits.len() == 1, 'one deposit');
    let deposit = *deposits.at(0);
    assert(deposit.token == ctx.usdc.contract_address, 'USDC comes back');
    assert(deposit.amount.into() == expected, 'the underlying it earned');
    assert(ctx.usdc.allowance(ctx.helper, ctx.pool) == expected, 'pool approved for it');
}

#[test]
fn a_partial_redeem_leaves_the_rest_of_the_position_alone() {
    let ctx = setup();
    let held: u256 = 80_000_000_000_000_000_000;
    let part: u256 = 20_000_000_000_000_000_000;
    ctx.vault.mint(ctx.helper, held);

    start_cheat_caller_address(ctx.helper, ctx.pool);
    ctx
        .earn
        .privacy_invoke(
            EarnOperation::Redeem,
            ctx.vault.contract_address,
            ctx.usdc.contract_address,
            part,
            NOTE,
        );
    stop_cheat_caller_address(ctx.helper);

    assert(ctx.vault.last_redeem_shares() == part, 'only the part asked for');
    assert(ctx.vault.balance_of(ctx.helper) == held - part, 'the rest stays');
}

#[test]
#[should_panic(expected: 'TOKENS_EQUAL')]
fn the_same_token_both_ways_is_refused() {
    let ctx = setup();
    start_cheat_caller_address(ctx.helper, ctx.pool);
    ctx
        .earn
        .privacy_invoke(
            EarnOperation::Supply,
            ctx.usdc.contract_address,
            ctx.usdc.contract_address,
            1,
            NOTE,
        );
}

#[test]
#[should_panic(expected: 'ZERO_AMOUNT')]
fn a_zero_amount_is_refused() {
    let ctx = setup();
    start_cheat_caller_address(ctx.helper, ctx.pool);
    ctx
        .earn
        .privacy_invoke(
            EarnOperation::Supply,
            ctx.usdc.contract_address,
            ctx.vault.contract_address,
            0,
            NOTE,
        );
}
