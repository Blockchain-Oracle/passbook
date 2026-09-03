//! The Mailbox: where a private transfer's sealed memo is posted, by the pool, in the same
//! transaction that creates the note it belongs to.
//!
//! Callable ONLY through the privacy pool's `InvokeExternal` action. The pool calls
//! `privacy_invoke` after the transaction's notes exist and inside the same proof, so a memo
//! here is inseparable from the payment it describes: same hash, same receipt, same revert.
//!
//! Pool-only on purpose. The messaging RFP's sender anonymity is exactly "the pool is the
//! caller" — a memo posted by an account directly would put that account's address on the
//! public record beside its ciphertext. The predecessor `MessageBook` was permissionless and
//! argued that harmless; for a memo it is the whole leak.
//!
//! Holds no value, never approves anything, always returns an empty deposit span: a zero-deposit
//! invoke is legal, still emits `ExternalContractInvoked`, and sets no screening subject.
//!
//! The anchor is the recipient note's id — public already in the pool's own `EncNoteCreated`
//! event of the same receipt — and it is one-time: a second memo for the same note reverts. A
//! note id cannot be predicted by anyone but its sender (it hashes the sender's private key), so
//! nobody can burn an anchor ahead of an honest mail.
use strk20_app::pool_types::OpenNoteDeposit;
use starknet::ContractAddress;

#[starknet::interface]
pub trait IMailbox<TContractState> {
    /// `[anchor, version, nonce, byte_len, body]` — the sealed envelope, felt for felt.
    fn privacy_invoke(
        ref self: TContractState,
        anchor: felt252,
        version: felt252,
        nonce: felt252,
        byte_len: u32,
        body: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
    fn pool(self: @TContractState) -> ContractAddress;
    fn is_posted(self: @TContractState, anchor: felt252) -> bool;
}

#[starknet::contract]
pub mod Mailbox {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use strk20_app::pool_types::OpenNoteDeposit;

    /// The envelope version this contract accepts. Bumping the envelope means a new contract.
    pub const MAIL_VERSION: felt252 = 1;
    /// Ciphertext bound: 32 felts of 31 bytes is 992 bytes, and the client seals at most 960.
    pub const MAX_BODY_FELTS: u32 = 32;
    pub const BYTES_PER_FELT: u32 = 31;

    #[storage]
    struct Storage {
        pool: ContractAddress,
        /// One memo per note, ever. Bodies live in the event.
        posted: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Posted: Posted,
    }

    /// Keyed by the note it rides with, so a reader who knows its notes can filter for its mail.
    #[derive(Drop, starknet::Event)]
    pub struct Posted {
        #[key]
        pub anchor: felt252,
        pub version: felt252,
        pub nonce: felt252,
        pub byte_len: u32,
        pub body: Span<felt252>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(pool.is_non_zero(), 'ZERO_POOL');
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl MailboxImpl of super::IMailbox<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            anchor: felt252,
            version: felt252,
            nonce: felt252,
            byte_len: u32,
            body: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), 'ONLY_POOL');
            assert(version == MAIL_VERSION, 'MAIL_VERSION');
            assert(anchor != 0, 'MAIL_ZERO_ANCHOR');
            let felts = body.len();
            assert(felts != 0 && felts <= MAX_BODY_FELTS, 'MAIL_BODY_LEN');
            // The byte length must be exactly what this many felts can carry: the last felt
            // is short, every other one full. Anything else is an envelope nobody can unpack.
            assert(byte_len <= felts * BYTES_PER_FELT, 'MAIL_BYTE_LEN');
            assert(byte_len > (felts - 1) * BYTES_PER_FELT, 'MAIL_BYTE_LEN');
            assert(!self.posted.read(anchor), 'MAIL_ANCHOR_USED');
            self.posted.write(anchor, true);
            self.emit(Posted { anchor, version, nonce, byte_len, body });
            array![].span()
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn is_posted(self: @ContractState, anchor: felt252) -> bool {
            self.posted.read(anchor)
        }
    }
}
