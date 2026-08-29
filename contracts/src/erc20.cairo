//! The two ERC20 entrypoints a pool-facing contract actually needs.
//!
//! `balance_of` is how custody is PROVEN rather than trusted. The privacy pool withdraws to an
//! arbitrary address in phase 6 and invokes us in phase 7, so by the time we run, the stake is
//! either sitting in our balance or it is not — we never take the caller's word for it. See
//! `Markets::take_custody`.
//!
//! `approve` is how payouts leave: we do not push tokens to the pool, we authorise it to pull
//! exactly the batch total, and it does so while crediting the open notes.
//!
//! `transfer` is the one path that does NOT go through the pool — a launch creator sweeping their
//! raise to an address they name. That leg is public by construction, so it pushes directly
//! rather than pretending otherwise.
//!
//! `transfer_from` funds the markets' house float: house liquidity has nothing to hide, so it
//! arrives as a plain pull from an approving public account — no pool, no proof, no pool fee.
//!
//! snake_case only. STRK's mainnet class exposes both casings, and picking the snake ones keeps
//! this interface readable next to the rest of the Cairo 1 ecosystem.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}
