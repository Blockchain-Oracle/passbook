//! Test doubles for the three things `Markets` talks to: an ERC20, the privacy pool, and Pragma.
//!
//! These live in `src/` rather than `tests/` because snforge can only `declare` contracts that
//! are in the package's compiled artifacts. They are fixtures, never deployed to mainnet — the
//! deploy scripts name `Markets` explicitly, so a stray `MockERC20` class in `target/dev` costs
//! nothing but disk.
//!
//! `MockPool` is the important one. It does not merely call us — it PULLS the approved sum
//! afterwards, exactly as the real pool does while crediting open notes. It reaches its target
//! through `IPrivacyInvoke`, so one double serves both `Markets` and `Launch`. Without that pull the
//! batch-claim tests would pass against a contract that approves nothing, which is precisely the
//! bug (StarkWare's own anonymizer approving inside its loop) the batch path exists to avoid.

use starknet::ContractAddress;
use strk20_app::pool_types::OpenNoteDeposit;
use strk20_app::pragma::{DataType, PragmaPricesResponse};

#[starknet::interface]
pub trait IMockERC20<TContractState> {
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn allowance(
        self: @TContractState, owner: ContractAddress, spender: ContractAddress,
    ) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool;
    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
    /// How many times `approve` has been called, ever. The batch-claim test asserts this is 1
    /// after settling a three-strike ladder.
    fn approve_calls(self: @TContractState) -> u64;
}

#[starknet::interface]
pub trait IMockPool<TContractState> {
    /// Stand in for the pool's phase-7 `InvokeExternal`, including the deposit pull that follows.
    fn invoke(
        ref self: TContractState, target: ContractAddress, op: felt252, payload: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
    /// Stand in for `ComputeAndInvoke` (governance §2.1): the pool derives `identity_key` and
    /// injects it as argument 0 of the target's `privacy_compute`. Here the TEST chooses the
    /// key — which is exactly the thing only the pool may do in production, and why the
    /// governance contract asserts its caller.
    fn compute(
        ref self: TContractState,
        target: ContractAddress,
        identity_key: felt252,
        op: felt252,
        payload: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
    fn pulled(self: @TContractState, token: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IMockPragma<TContractState> {
    fn get_data_median(self: @TContractState, data_type: DataType) -> PragmaPricesResponse;
    fn set_price(
        ref self: TContractState, price: u128, decimals: u32, last_updated_timestamp: u64,
    );
}

#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        approve_calls: u64,
    }

    #[abi(embed_v0)]
    impl MockERC20Impl of super::IMockERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            // Overwrites rather than accumulates — real ERC20 semantics, and the reason a
            // per-deposit approve loop cannot settle a same-token batch.
            self.allowances.write((get_caller_address(), spender), amount);
            self.approve_calls.write(self.approve_calls.read() + 1);
            true
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.read((owner, spender))
        }

        /// The one leg that does not go through the pool: a launch creator sweeping their raise
        /// to an address they name.
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let from_balance = self.balances.read(sender);
            assert(from_balance >= amount, 'INSUFFICIENT_BALANCE');
            self.balances.write(sender, from_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let allowed = self.allowances.read((sender, spender));
            assert(allowed >= amount, 'INSUFFICIENT_ALLOWANCE');
            let from_balance = self.balances.read(sender);
            assert(from_balance >= amount, 'INSUFFICIENT_BALANCE');

            self.allowances.write((sender, spender), allowed - amount);
            self.balances.write(sender, from_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            true
        }

        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
        }

        fn approve_calls(self: @ContractState) -> u64 {
            self.approve_calls.read()
        }
    }
}

#[starknet::contract]
pub mod MockPool {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::{ContractAddress, get_contract_address};
    use strk20_app::batch::{IPrivacyInvokeDispatcher, IPrivacyInvokeDispatcherTrait};
    use strk20_app::governance::{IGovernanceDispatcher, IGovernanceDispatcherTrait};
    use strk20_app::pool_types::OpenNoteDeposit;
    use super::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};

    #[storage]
    struct Storage {
        pulled: Map<ContractAddress, u256>,
    }

    #[abi(embed_v0)]
    impl MockPoolImpl of super::IMockPool<ContractState> {
        fn invoke(
            ref self: ContractState, target: ContractAddress, op: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            let deposits = IPrivacyInvokeDispatcher { contract_address: target }
                .privacy_invoke(op, payload);

            // The pull. Each returned deposit is money the invoked contract has authorised us to
            // collect while we credit the matching open note; if the allowance is short, this
            // reverts — which is the whole point of modelling it.
            let mut i: u32 = 0;
            let n = deposits.len();
            while i != n {
                let deposit = *deposits.at(i);
                IMockERC20Dispatcher { contract_address: deposit.token }
                    .transfer_from(target, get_contract_address(), deposit.amount.into());
                self
                    .pulled
                    .write(
                        deposit.token,
                        self.pulled.read(deposit.token) + deposit.amount.into(),
                    );
                i += 1;
            };

            deposits
        }

        fn compute(
            ref self: ContractState,
            target: ContractAddress,
            identity_key: felt252,
            op: felt252,
            payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            let deposits = IGovernanceDispatcher { contract_address: target }
                .privacy_compute(identity_key, op, payload);

            let mut i: u32 = 0;
            let n = deposits.len();
            while i != n {
                let deposit = *deposits.at(i);
                IMockERC20Dispatcher { contract_address: deposit.token }
                    .transfer_from(target, get_contract_address(), deposit.amount.into());
                self
                    .pulled
                    .write(
                        deposit.token,
                        self.pulled.read(deposit.token) + deposit.amount.into(),
                    );
                i += 1;
            };

            deposits
        }

        fn pulled(self: @ContractState, token: ContractAddress) -> u256 {
            self.pulled.read(token)
        }
    }
}

#[starknet::contract]
pub mod MockPragma {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::{DataType, PragmaPricesResponse};

    #[storage]
    struct Storage {
        price: u128,
        decimals: u32,
        last_updated_timestamp: u64,
    }

    #[abi(embed_v0)]
    impl MockPragmaImpl of super::IMockPragma<ContractState> {
        fn get_data_median(
            self: @ContractState, data_type: DataType,
        ) -> PragmaPricesResponse {
            // The requested pair is ignored: every test market shares one feed, and the wire
            // shape of `DataType` is pinned directly against the recorded mainnet calldata in
            // `spot_entry_serialises_as_the_recorded_mainnet_calldata`, which a mock could never
            // catch anyway.
            let _ = data_type;
            PragmaPricesResponse {
                price: self.price.read(),
                decimals: self.decimals.read(),
                last_updated_timestamp: self.last_updated_timestamp.read(),
                num_sources_aggregated: 10,
                expiration_timestamp: Option::None,
            }
        }

        fn set_price(
            ref self: ContractState, price: u128, decimals: u32, last_updated_timestamp: u64,
        ) {
            self.price.write(price);
            self.decimals.write(decimals);
            self.last_updated_timestamp.write(last_updated_timestamp);
        }
    }
}
