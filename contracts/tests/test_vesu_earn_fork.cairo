//! `VesuEarn` against the REAL Vesu contracts, on a fork of mainnet.
//!
//! ── WHY THIS FILE EXISTS AND `test_vesu_earn.cairo` IS NOT ENOUGH ─────────────────────────
//!
//! The other file proves this contract does what I believe Vesu's interface to be. That is a test
//! of my reading, not of Vesu — a mock cannot disagree with the assumption it was written from. If
//! the real vToken wants an allowance we do not give it, returns a different number of felts, has a
//! minimum deposit, or reverts for a reason nobody wrote down, every mock test still passes and the
//! first mainnet transaction is the one that finds out. That transaction costs the pool fee.
//!
//! So this file deploys the helper onto a fork of mainnet at a pinned block, funds it with USDC
//! taken from a real holder, and drives a real supply and a real exact-share redeem through the
//! actual Re7 USDC Core vToken. Nothing here is simulated except the block being frozen.
//!
//! Pinned rather than `latest` on purpose: a test whose subject is somebody else's live contract
//! should fail because the code changed, not because the market moved overnight.

use snforge_std::{declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address, stop_cheat_caller_address};
use strk20_app::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
use strk20_app::vesu_earn::{EarnOperation, IVesuEarnDispatcher, IVesuEarnDispatcherTrait};
use starknet::ContractAddress;

/// Mainnet, read live: `vToken.asset()` and `vToken.pool_contract()` both agree with these, and
/// the PoolFactory returns this vToken for this pool and asset.
const USDC: felt252 = 0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb;
const RE7_USDC_CORE_VTOKEN: felt252 = 0x017891114c00b07317b9102adefbad9fd5de40c5616f094ee09fe2fad67191b1;
const CLEARSTAR_VTOKEN: felt252 = 0x058337c3372ebd55bec9963644c169a62988d695a4f3e242d83d5b706ded22d3;

/// A real USDC holder, impersonated to fund the helper. The STRK20 privacy pool itself — chosen
/// because it is NOT a Vesu pool, so taking USDC out of it cannot disturb the market under test.
const USDC_HOLDER: felt252 = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a;

/// The same address, named for what it is where the test is about the pool rather than its USDC.
const STRK20_POOL: felt252 = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a;

/// Ten USDC. Small enough that the market's price barely moves, large enough not to be dust.
const TEN_USDC: u256 = 10_000_000;
const NOTE: felt252 = 'fork-note';

/// The reads this file needs from a real vToken, to check our result against the vault's own view.
#[starknet::interface]
trait IVTokenReads<TContractState> {
    fn preview_deposit(self: @TContractState, assets: u256) -> u256;
    fn preview_redeem(self: @TContractState, shares: u256) -> u256;
    fn convert_to_assets(self: @TContractState, shares: u256) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn asset(self: @TContractState) -> ContractAddress;
}

fn addr(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

/// Deploys the helper with `pool` as its only permitted caller, and funds it with `amount` USDC
/// taken from a real holder — which is what the privacy pool's phase-6 withdrawal does for real.
fn setup(pool: ContractAddress, amount: u256) -> IVesuEarnDispatcher {
    let class = declare("VesuEarn").unwrap().contract_class();
    let (helper, _) = class.deploy(@array![pool.into()]).unwrap();

    let usdc = IERC20Dispatcher { contract_address: addr(USDC) };
    start_cheat_caller_address(addr(USDC), addr(USDC_HOLDER));
    usdc.transfer(helper, amount);
    stop_cheat_caller_address(addr(USDC));

    IVesuEarnDispatcher { contract_address: helper }
}

#[test]
#[fork(url: "https://starknet-rpc.publicnode.com", block_number: 14303374)]
fn the_pinned_market_is_the_one_we_think_it_is() {
    // Cheap, and it is the assumption every other test here rests on.
    let vtoken = IVTokenReadsDispatcher { contract_address: addr(RE7_USDC_CORE_VTOKEN) };
    assert(vtoken.asset() == addr(USDC), 'vToken lends USDC');
    assert(vtoken.preview_deposit(TEN_USDC) > 0, 'the market accepts a deposit');
}

#[test]
#[fork(url: "https://starknet-rpc.publicnode.com", block_number: 14303374)]
fn a_real_supply_returns_real_shares() {
    let pool = addr('pool');
    let helper = setup(pool, TEN_USDC);
    let vtoken = IVTokenReadsDispatcher { contract_address: addr(RE7_USDC_CORE_VTOKEN) };
    let expected = vtoken.preview_deposit(TEN_USDC);

    start_cheat_caller_address(helper.contract_address, pool);
    let deposits = helper
        .privacy_invoke(EarnOperation::Supply, addr(USDC), addr(RE7_USDC_CORE_VTOKEN), TEN_USDC, NOTE);
    stop_cheat_caller_address(helper.contract_address);

    assert(deposits.len() == 1, 'one deposit for one note');
    let deposit = *deposits.at(0);
    assert(deposit.note_id == NOTE, 'the note it was told');
    assert(deposit.token == addr(RE7_USDC_CORE_VTOKEN), 'the vToken comes back');
    // The vault's own preview, matched exactly. This is the number the review sheet shows the user.
    assert(deposit.amount.into() == expected, 'shares match preview_deposit');
    // And the shares are really here, not merely claimed.
    assert(vtoken.balance_of(helper.contract_address) == expected, 'the helper holds them');
    // The pool is approved to pull them while crediting the open note. Without this the value
    // would be stranded in a contract nobody can reach.
    let shares_erc20 = IERC20Dispatcher { contract_address: addr(RE7_USDC_CORE_VTOKEN) };
    assert(shares_erc20.balance_of(helper.contract_address) == expected, 'balance_of agrees');
}

#[test]
#[fork(url: "https://starknet-rpc.publicnode.com", block_number: 14303374)]
fn a_real_round_trip_returns_the_underlying() {
    let pool = addr('pool');
    let helper = setup(pool, TEN_USDC);
    let usdc = IERC20Dispatcher { contract_address: addr(USDC) };
    let vtoken = IVTokenReadsDispatcher { contract_address: addr(RE7_USDC_CORE_VTOKEN) };

    // 1. Supply.
    start_cheat_caller_address(helper.contract_address, pool);
    let supplied = helper
        .privacy_invoke(EarnOperation::Supply, addr(USDC), addr(RE7_USDC_CORE_VTOKEN), TEN_USDC, NOTE);
    let shares: u256 = (*supplied.at(0)).amount.into();
    assert(usdc.balance_of(helper.contract_address) == 0, 'all the USDC went in');

    // 2. Redeem those EXACT shares straight back out. This is the leg the published helper got
    //    wrong: it passed an underlying amount here, and the SDK README still does.
    let expected_back = vtoken.preview_redeem(shares);
    let returned = helper
        .privacy_invoke(EarnOperation::Redeem, addr(RE7_USDC_CORE_VTOKEN), addr(USDC), shares, 'fork-note-2');
    stop_cheat_caller_address(helper.contract_address);

    assert(returned.len() == 1, 'one deposit back');
    let back = *returned.at(0);
    assert(back.token == addr(USDC), 'USDC comes back');
    assert(back.amount.into() == expected_back, 'matches preview_redeem');
    assert(vtoken.balance_of(helper.contract_address) == 0, 'every share was burned');

    // Round-tripping in one block cannot earn, and a vault rounds in its own favour — so what
    // comes back is at most what went in, and within a hair of it. A helper that returned MORE
    // than the deposit would mean we had read somebody else's money.
    assert(back.amount.into() <= TEN_USDC, 'never more than went in');
    assert(back.amount.into() + 100 >= TEN_USDC, 'and within a rounding step');
}

#[test]
#[fork(url: "https://starknet-rpc.publicnode.com", block_number: 14303374)]
fn a_partial_redeem_leaves_the_rest_earning() {
    let pool = addr('pool');
    let helper = setup(pool, TEN_USDC);
    let vtoken = IVTokenReadsDispatcher { contract_address: addr(RE7_USDC_CORE_VTOKEN) };

    start_cheat_caller_address(helper.contract_address, pool);
    let supplied = helper
        .privacy_invoke(EarnOperation::Supply, addr(USDC), addr(RE7_USDC_CORE_VTOKEN), TEN_USDC, NOTE);
    let shares: u256 = (*supplied.at(0)).amount.into();
    let half = shares / 2;

    helper.privacy_invoke(EarnOperation::Redeem, addr(RE7_USDC_CORE_VTOKEN), addr(USDC), half, 'half');
    stop_cheat_caller_address(helper.contract_address);

    // The other half is still a position, still in the market, still worth something.
    assert(vtoken.balance_of(helper.contract_address) == shares - half, 'the rest stays supplied');
    assert(vtoken.convert_to_assets(shares - half) > 0, 'and it is still worth USDC');
}

#[test]
#[fork(url: "https://starknet-rpc.publicnode.com", block_number: 14303374)]
fn a_second_market_works_the_same_way() {
    // One market working could be luck — a curator's particular configuration. Two is the pattern.
    let pool = addr('pool');
    let helper = setup(pool, TEN_USDC);
    let vtoken = IVTokenReadsDispatcher { contract_address: addr(CLEARSTAR_VTOKEN) };
    let expected = vtoken.preview_deposit(TEN_USDC);

    start_cheat_caller_address(helper.contract_address, pool);
    let supplied = helper
        .privacy_invoke(EarnOperation::Supply, addr(USDC), addr(CLEARSTAR_VTOKEN), TEN_USDC, NOTE);
    let shares: u256 = (*supplied.at(0)).amount.into();
    assert(shares == expected, 'shares match preview');

    let returned = helper
        .privacy_invoke(EarnOperation::Redeem, addr(CLEARSTAR_VTOKEN), addr(USDC), shares, 'back');
    stop_cheat_caller_address(helper.contract_address);
    assert((*returned.at(0)).token == addr(USDC), 'USDC comes back');
    assert((*returned.at(0)).amount.into() <= TEN_USDC, 'never more than went in');
}

#[test]
#[should_panic(expected: 'ONLY_POOL')]
#[fork(url: "https://starknet-rpc.publicnode.com", block_number: 14303374)]
fn a_stranger_cannot_drive_the_real_market_either() {
    let pool = addr('pool');
    let helper = setup(pool, TEN_USDC);
    // Caller is the test, not the pool. The published helper is permissionless here; ours is not.
    helper.privacy_invoke(EarnOperation::Supply, addr(USDC), addr(RE7_USDC_CORE_VTOKEN), TEN_USDC, NOTE);
}

#[test]
#[fork(url: "https://starknet-rpc.publicnode.com", block_number: 14303374)]
fn the_real_pool_can_pull_what_the_helper_approved() {
    // ── THE LAST MILE OF THE ON-CHAIN MECHANISM ───────────────────────────────────────────
    //
    // Every test above ends at the approve. But an approve is only half of it: the pool credits an
    // open note by calling `checked_transfer_from(token, sender: depositor, recipient: pool)`, and
    // if that pull fails the whole transaction reverts AFTER the fee — or, worse, the shares sit in
    // a contract with no way to move them. So this drives the actual pull, from the actual pool
    // address, against the actual vToken.
    let pool = addr(STRK20_POOL);
    let helper = setup(pool, TEN_USDC);
    let shares_erc20 = IERC20Dispatcher { contract_address: addr(RE7_USDC_CORE_VTOKEN) };

    start_cheat_caller_address(helper.contract_address, pool);
    let deposits = helper
        .privacy_invoke(EarnOperation::Supply, addr(USDC), addr(RE7_USDC_CORE_VTOKEN), TEN_USDC, NOTE);
    stop_cheat_caller_address(helper.contract_address);
    let minted: u256 = (*deposits.at(0)).amount.into();

    let pool_before = shares_erc20.balance_of(pool);
    // Now the pool does what it does in phase 7, as itself.
    start_cheat_caller_address(addr(RE7_USDC_CORE_VTOKEN), pool);
    shares_erc20.transfer_from(helper.contract_address, pool, minted);
    stop_cheat_caller_address(addr(RE7_USDC_CORE_VTOKEN));

    assert(shares_erc20.balance_of(pool) == pool_before + minted, 'the pool got the shares');
    assert(shares_erc20.balance_of(helper.contract_address) == 0, 'nothing stranded in helper');
}

#[test]
#[fork(url: "https://starknet-rpc.publicnode.com", block_number: 14303374)]
fn every_market_in_the_catalog_round_trips() {
    // Two markets is a pattern; seven is the catalog. Each curator configures their own market, and
    // the app offers all of them — so "it works on the big one" is not the claim being made on the
    // screen. Re7 USDC Frontier is in here deliberately: it holds nothing, so this is also the
    // first-depositor path, which is where an ERC-4626 vault is most likely to behave differently.
    let markets: Array<felt252> = array![
        0x017891114c00b07317b9102adefbad9fd5de40c5616f094ee09fe2fad67191b1, // Re7 USDC Core
        0x058337c3372ebd55bec9963644c169a62988d695a4f3e242d83d5b706ded22d3, // Clearstar USDC Reactor
        0x00387e8ddbb1ab36ca08874d9abc702ef4872ad600dcf76b7f240b71d7bc4e65, // Prime
        0x06c9d1090d38488b3d08f3ee914ac878d003b8f243f82a9867eb70706a73950b, // Re7 USDC Prime
        0x00cf3ea1abb06e1f2cba191f10684fc4ce505eba0ed64a847ab6b00ef52e5722, // Re7 USDC Stable Core
        0x009a5ac579fc1ebcedf9bfa12daec9f86d0e258a1736d9cf5d1d8e9053672b09, // Re7 Labs Starknet Ecosystem
        0x020f0579b2a1ae642369ca67430f7156d2e83c00f351bfeaea74017aa1f306ea, // Re7 USDC Frontier — empty
    ];

    let pool = addr('pool');
    let mut i: u32 = 0;
    while i < markets.len() {
        let vtoken_addr = addr(*markets.at(i));
        let helper = setup(pool, TEN_USDC);
        let vtoken = IVTokenReadsDispatcher { contract_address: vtoken_addr };
        assert(vtoken.asset() == addr(USDC), 'every market lends USDC');

        start_cheat_caller_address(helper.contract_address, pool);
        let supplied = helper
            .privacy_invoke(EarnOperation::Supply, addr(USDC), vtoken_addr, TEN_USDC, NOTE);
        let shares: u256 = (*supplied.at(0)).amount.into();
        assert(shares > 0, 'shares came back');

        let returned = helper
            .privacy_invoke(EarnOperation::Redeem, vtoken_addr, addr(USDC), shares, 'back');
        stop_cheat_caller_address(helper.contract_address);

        let back: u256 = (*returned.at(0)).amount.into();
        assert((*returned.at(0)).token == addr(USDC), 'USDC came back');
        assert(back <= TEN_USDC, 'never more than went in');
        assert(back + 100 >= TEN_USDC, 'and within a rounding step');
        assert(vtoken.balance_of(helper.contract_address) == 0, 'every share burned');
        i += 1;
    };
}
