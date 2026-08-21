use strk20_app::pool_types::OpenNoteDeposit;

#[starknet::interface]
pub trait IMessageBook<TContractState> {
    fn privacy_invoke(
        ref self: TContractState, mode: felt252, tag: felt252, payload: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
    fn message_count(self: @TContractState, tag: felt252) -> u64;
    fn seal_root(self: @TContractState, tag: felt252) -> felt252;
}

#[starknet::contract]
pub mod MessageBook {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use strk20_app::pool_types::OpenNoteDeposit;

    pub const MODE_APPEND: felt252 = 1;
    pub const MODE_SEAL: felt252 = 2;

    #[storage]
    struct Storage {
        // Bodies live in events, never in storage. Storage holds only what must be
        // readable on-chain: how many messages a tag has, and its latest seal root.
        counts: Map<felt252, u64>,
        seals: Map<felt252, felt252>,
    }

    // `pub` on the event types and their fields is what lets the test crate build the
    // expected event and assert it was emitted. Visibility only: the ABI and the emitted
    // keys/data are identical either way.
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        MessageAppended: MessageAppended,
        ConversationSealed: ConversationSealed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MessageAppended {
        #[key]
        pub tag: felt252,
        pub index: u64,
        pub ciphertext: Span<felt252>,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ConversationSealed {
        #[key]
        pub tag: felt252,
        pub root: felt252,
        pub count: u64,
    }

    #[abi(embed_v0)]
    impl MessageBookImpl of super::IMessageBook<ContractState> {
        /// Deliberately permissionless: this contract never touches value, holds no
        /// balance and grants no allowance, so an anonymous caller can do nothing but
        /// pay gas to append their own ciphertext. Adding `assert(caller == pool)`
        /// here would break third-party reuse for no security gain.
        ///
        /// ALWAYS returns an empty span. A zero-deposit invoke is legal
        /// (`_apply_invoke_and_deposits` guards its deposit block with
        /// `if !deposits.is_empty()`), still executes, and still emits
        /// `ExternalContractInvoked`. It also sets no screening subject, which is
        /// what makes this contract immune to the default-deny policy flip.
        fn privacy_invoke(
            ref self: ContractState, mode: felt252, tag: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            assert(payload.len() != 0, 'EMPTY_PAYLOAD');

            if mode == MODE_APPEND {
                let index = self.counts.read(tag);
                self.counts.write(tag, index + 1);
                self.emit(MessageAppended { tag, index, ciphertext: payload });
            } else if mode == MODE_SEAL {
                assert(payload.len() == 1, 'SEAL_NEEDS_ONE_FELT');
                let root = *payload.at(0);
                self.seals.write(tag, root);
                self.emit(ConversationSealed { tag, root, count: self.counts.read(tag) });
            } else {
                core::panic_with_felt252('UNKNOWN_MODE');
            }

            array![].span()
        }

        fn message_count(self: @ContractState, tag: felt252) -> u64 {
            self.counts.read(tag)
        }

        fn seal_root(self: @ContractState, tag: felt252) -> felt252 {
            self.seals.read(tag)
        }
    }
}
