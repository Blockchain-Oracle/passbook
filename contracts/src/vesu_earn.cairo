//! The Vesu lending helper: shielded USDC becomes a private vToken position, and back again.
//!
//! Called ONLY through the privacy pool's `InvokeExternal` action, in the same proved transaction
//! that withdraws the input to this contract and mints the open note the output lands in. The
//! contract holds nothing between transactions: value arrives in phase 6, leaves in phase 7, and
//! the pool pulls the result while crediting the note.
//!
//! ── WHY THIS CONTRACT EXISTS AT ALL ───────────────────────────────────────────────────────
//!
//! The sponsor publishes a Vesu anonymizer with exactly this shape. Its published class,
//! `0x3751128dc3ebd36215f982766f14aaca8f78793e4b0f42a73e49372a8e24aae`, is the one named in the
//! privacy repo's contract table — and `starknet_getClass` on mainnet does not know it. There is
//! no live instance to point at, corrected or otherwise, so the position had to be built here.
//!
//! ── THE ONE LINE THAT COST SOMEBODY MONEY ─────────────────────────────────────────────────
//!
//! On exit, `redeem(shares)` — NOT `withdraw(assets)`. The published `PRIVACY-0.14.3-RC.0` helper
//! called `withdraw`, and the SDK README still shows an exit passing an underlying amount even
//! though the snippet above it has just discovered a vToken *share* count. Those are different
//! numbers by a factor of the share price, and vToken shares are 18-decimal while USDC is
//! 6-decimal, so getting it wrong is not a rounding error — it is a redemption for roughly a
//! millionth of the position, or a revert. The corrected source redeems an exact share count and
//! this contract does the same.
//!
//! Source:  https://github.com/starkware-libs/starknet-privacy
//! Path:    packages/vesu_lending_anonymizer/src/vesu_lending_anonymizer.cairo
//! Commit:  74841caf0466d122117945e28ed983e2864c8fc1 (post-fix; `redeem(shares:)` on exit)
//!
//! Transcribed rather than imported: that package needs Cairo 2.17 and this one is pinned to
//! 2.8.2, which is the toolchain the deployed Markets/Launch/Mailbox classes were built with.
//! The flow, the argument order, the balance-difference accounting and the calldata layout are
//! the corrected source's. The pool-only guard below is ours, and is the only behavioural change.

use strk20_app::pool_types::OpenNoteDeposit;
use starknet::ContractAddress;

/// The Vesu vToken entrypoints this helper drives. ERC-4626 shaped: `deposit` takes underlying
/// ASSETS, `redeem` takes vault SHARES. Reading these two lines is what the fix was about.
#[starknet::interface]
pub trait IVToken<TContractState> {
    fn deposit(ref self: TContractState, assets: u256, receiver: ContractAddress) -> u256;
    fn redeem(
        ref self: TContractState, shares: u256, receiver: ContractAddress, owner: ContractAddress,
    ) -> u256;
}

/// Which direction the position moves. Serialises as its variant index, so `Supply` is `0` and
/// `Redeem` is `1` — the same two felts the sponsor's `LendingOperation` puts on the wire.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub enum EarnOperation {
    /// Underlying in, shares out.
    Supply,
    /// Shares in, underlying out.
    Redeem,
}

#[starknet::interface]
pub trait IVesuEarn<TContractState> {
    /// `[operation, in_token, out_token, amount_lo, amount_hi, note_id]`.
    ///
    /// `amount` is underlying on `Supply` and an exact SHARE COUNT on `Redeem`. `in_token` is what
    /// leaves this contract for the vault, `out_token` what comes back — so on `Supply` the vToken
    /// is `out_token`, and on `Redeem` it is `in_token`.
    fn privacy_invoke(
        ref self: TContractState,
        operation: EarnOperation,
        in_token: ContractAddress,
        out_token: ContractAddress,
        amount: u256,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;
    fn pool(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod VesuEarn {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use strk20_app::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use strk20_app::pool_types::OpenNoteDeposit;
    use super::{EarnOperation, IVTokenDispatcher, IVTokenDispatcherTrait, IVesuEarn};

    #[storage]
    struct Storage {
        pool: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(pool.is_non_zero(), 'ZERO_POOL');
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl VesuEarnImpl of IVesuEarn<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: EarnOperation,
            in_token: ContractAddress,
            out_token: ContractAddress,
            amount: u256,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            // ── OURS, NOT THE SPONSOR'S ───────────────────────────────────────────────────
            //
            // The published helper is permissionless. That is defensible for a contract that is
            // empty between transactions, but it is only empty when nothing goes wrong: a
            // donation, a dust residue, or a token someone sends here by mistake can be swept by
            // any caller, because the last thing this function does is approve its caller for the
            // whole output balance. Pool-only costs one storage read and removes the class.
            let pool = self.pool.read();
            assert(get_caller_address() == pool, 'ONLY_POOL');

            assert(in_token.is_non_zero(), 'ZERO_IN_TOKEN');
            assert(out_token.is_non_zero(), 'ZERO_OUT_TOKEN');
            assert(amount.is_non_zero(), 'ZERO_AMOUNT');
            assert(in_token != out_token, 'TOKENS_EQUAL');

            let self_addr = get_contract_address();
            let in_erc20 = IERC20Dispatcher { contract_address: in_token };
            let out_erc20 = IERC20Dispatcher { contract_address: out_token };

            // What came back is MEASURED, never taken from the vault's return value: the balance
            // difference is true even if a vault rounds, charges, or lies about what it minted.
            let balance_before = out_erc20.balance_of(self_addr);

            match operation {
                EarnOperation::Supply => {
                    // The vault pulls the underlying, so it is approved first.
                    in_erc20.approve(out_token, amount);
                    IVTokenDispatcher { contract_address: out_token }
                        .deposit(assets: amount, receiver: self_addr);
                },
                EarnOperation::Redeem => {
                    // `amount` is a share count. See the header.
                    IVTokenDispatcher { contract_address: in_token }
                        .redeem(shares: amount, receiver: self_addr, owner: self_addr);
                },
            }

            let balance_after = out_erc20.balance_of(self_addr);
            let received: u128 = (balance_after - balance_before)
                .try_into()
                .expect('RECEIVED_AMOUNT_OVERFLOW');
            assert(received.is_non_zero(), 'ZERO_OUT_AMOUNT');

            // Value does not leave here — the pool pulls it while crediting the open note. An
            // approval without the deposit span below would strand it; the span without the
            // approval reverts the whole transaction. They are written together for that reason.
            out_erc20.approve(pool, received.into());

            array![OpenNoteDeposit { note_id, token: out_token, amount: received }].span()
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }
    }
}
