//! Passbook Houses — private DAO governance on the StarkWare privacy pool.
//! `docs/governance.md` is the spec this file executes; section numbers below cite it.
//!
//! ── YOUR TOKENS ARE THE BALLOT (§4) ──────────────────────────────────────────────────────
//!
//! To vote you move governance-token value through the pool into this contract with a sealed
//! choice attached. The pool proves the value is real and injects your anonymous voter handle
//! (`identity_key`, arg 0 of `privacy_compute`); the funding leg makes your WEIGHT public while
//! the pool keeps YOU unlinkable; your CHOICE travels sealed to the proposal's tally key. Locked
//! tokens cannot vote twice — sybil resistance by conservation: ten handles splitting the same
//! tokens still sum to the same weight. No snapshot blocks, no census trees, no balance proofs.
//!
//! ── A WRONG TALLY IS NOT DETECTABLE, IT IS UNPUBLISHABLE (§6.3) ──────────────────────────
//!
//! Every ballot carries one Pedersen commitment per option on the Stark curve —
//! `C_i = w·G + r_i·H`, the chosen option holding the weight, the rest holding zero — and this
//! contract SUMS them into per-option accumulators as they arrive. Publication must present
//! per-option sums `S_i` and blind-sums `R_i` satisfying `S_i·G + R_i·H == ACC_i` and
//! `Σ S_i == total public weight`. The Teller that decrypts the sealed choices can peek early
//! (disclosed); it cannot shift, invent, drop or miscount weight, because the curve will not
//! let it. `H` is hash-to-curve over a fixed tag, pinned here and in
//! `packages/protocol/src/governance-commitment.ts` with a cross-test holding both to the same
//! points — if anyone knew `k` with `H = k·G`, they could forge; nobody derived it, so nobody does.
//!
//! ── THE HOUSE PATTERNS, KEPT VERBATIM (§10) ──────────────────────────────────────────────
//!
//! Custody ledger (`take_custody`/`release_custody`), bearer reclaim commitments
//! (`poseidon(secret)`), `approve_batch_totals` on the settling leg, pool-only assertions on
//! every leg where the pool must be mid-transaction, permissionless keeper entrypoints
//! (`publish_tally` carries its own authority; `execute` and `void_proposal` are anyone's), and
//! the `VOID_AFTER` escape so no vote can ever strand tokens (§15).

use starknet::ContractAddress;

/// One House — a governed token community (§9). Public so the web client decodes `get_house`
/// without a hand-written ABI.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct HouseInfo {
    /// The governance token. Any ERC20 the pool can carry — launched here or not (§9.1).
    pub token: ContractAddress,
    /// Absolute quorum, in token base units. Absolute rather than a supply fraction because a
    /// pool-side contract cannot read "circulating supply" without trusting it.
    pub quorum: u128,
    /// FOR must exceed this share of (FOR + AGAINST), in basis points. 5000 = simple majority.
    pub threshold_bps: u16,
    /// `COUNT_WEIGHTED` or `COUNT_MEMBER` (§9.4).
    pub counting: u8,
    /// `MEMBERS_OPEN` or `MEMBERS_INVITE` (§9.5).
    pub membership: u8,
    /// `poseidon(invite_secret)` for an invite House; 0 for an open one.
    pub invite_commitment: felt252,
    /// The public sees a member COUNT, never a member list.
    pub member_count: u64,
    /// The House pot, fundable by anyone as an anonymous deposit (§7.1).
    pub treasury: u128,
    /// The creator's bearer claim — a commitment, never an address (the `create_launch` precedent).
    pub creator_commitment: felt252,
    pub state: u8,
}

/// One proposal, in Tally's lifecycle grammar (§5).
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Proposal {
    pub house_id: u64,
    /// `MODE_SECRET_UNTIL_CLOSE` or `MODE_PERMANENT` (§6).
    pub mode: u8,
    /// 2 or 3: option 0 is AGAINST, option 1 is FOR, option 2 (when present) is ABSTAIN.
    pub options: u8,
    pub deadline: u64,
    /// The Teller's per-proposal public key x — what sealed choices are encrypted to.
    pub tally_key: felt252,
    /// The published decryption key (secret-until-close, after close). 0 until then; 0 forever
    /// in permanently-private mode.
    pub published_key: felt252,
    pub quorum: u128,
    pub threshold_bps: u16,
    /// `ACTION_TEXT` or `ACTION_SPEND`.
    pub action_kind: u8,
    pub action_amount: u128,
    pub action_recipient: ContractAddress,
    pub state: u8,
    /// Public escrowed weight across live ballots — the live quorum bar (§4.2).
    pub total_weight: u128,
    pub ballot_count: u64,
    /// Set by `publish_tally`: the accepted FOR and AGAINST sums, for the record and the UI.
    pub tally_for: u128,
    pub tally_against: u128,
}

/// One identity's live ballot on one proposal. The weight is CUMULATIVE — a re-vote replaces
/// the vector and must commit to the full cumulative escrow (§4.1's replace rule).
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Ballot {
    pub weight: u128,
    /// Replacements, counted — MACI's deniability: a shown receipt proves nothing final.
    pub seq: u32,
    pub state: u8,
}

/// A bearer escrow slot: a ballot's weight increment, or a delegation, keyed by
/// `poseidon(secret)`. The secret is the claim; the exit is as unlinkable as the entry (§4.3).
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Escrow {
    /// `ESCROW_BALLOT` or `ESCROW_DELEGATION`.
    pub kind: u8,
    /// The proposal (ballot kind) — the reclaim gate reads its state.
    pub proposal_id: u64,
    /// The delegate handle (delegation kind) — the revoke drains this pot.
    pub delegate: felt252,
    pub token: ContractAddress,
    pub amount: u128,
    pub state: u8,
}

use strk20_app::pool_types::OpenNoteDeposit;

#[starknet::interface]
pub trait IGovernance<TContractState> {
    /// The ComputeAndInvoke entrypoint (§2.1): the pool derives and injects `identity_key` as
    /// argument 0 — a per-user, per-helper handle unlinkable to any address. Ballots and joins
    /// arrive here, because both need a voter to be UNIQUE without being IDENTIFIED.
    fn privacy_compute(
        ref self: TContractState, identity_key: felt252, op: felt252, payload: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
    /// The plain invoke entrypoint — the legs that need value but no identity: delegating,
    /// funding the treasury, and the two settling legs (reclaim, revoke).
    fn privacy_invoke(
        ref self: TContractState, op: felt252, payload: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;

    fn create_house(
        ref self: TContractState,
        token: ContractAddress,
        quorum: u128,
        threshold_bps: u16,
        counting: u8,
        membership: u8,
        invite_commitment: felt252,
        metadata: ByteArray,
        creator_commitment: felt252,
    ) -> u64;
    fn propose(
        ref self: TContractState,
        house_id: u64,
        mode: u8,
        options: u8,
        deadline: u64,
        tally_key: felt252,
        action_kind: u8,
        action_amount: u128,
        action_recipient: ContractAddress,
        metadata: ByteArray,
    ) -> u64;
    /// Anyone carrying numbers the curve accepts — the CONTRACT is the authority (§6.3).
    fn publish_tally(
        ref self: TContractState,
        proposal_id: u64,
        sums: Span<u128>,
        blind_sums: Span<felt252>,
        excluded: Span<felt252>,
    );
    /// The secret-until-close reveal: on-chain forever, so the ballot book decrypts from public
    /// data alone and the Teller cannot lie, drop or reorder after the fact (§6.1).
    fn publish_key(ref self: TContractState, proposal_id: u64, key: felt252);
    /// Permissionless after Succeeded — the `graduate()` doctrine (§7).
    fn execute(ref self: TContractState, proposal_id: u64);
    /// The escape (§15): past `VOID_AFTER` with no accepted tally, anyone voids and reclaims
    /// open. No vote can ever strand tokens.
    fn void_proposal(ref self: TContractState, proposal_id: u64);

    fn house_count(self: @TContractState) -> u64;
    fn get_house(self: @TContractState, house_id: u64) -> HouseInfo;
    fn house_metadata(self: @TContractState, house_id: u64) -> ByteArray;
    fn proposal_count(self: @TContractState) -> u64;
    fn get_proposal(self: @TContractState, proposal_id: u64) -> Proposal;
    fn proposal_metadata(self: @TContractState, proposal_id: u64) -> ByteArray;
    fn get_ballot(self: @TContractState, proposal_id: u64, identity_key: felt252) -> Ballot;
    /// One accumulator point's coordinates; (0, 0) is the identity (no ballots yet).
    fn get_accumulator(self: @TContractState, proposal_id: u64, option: u8) -> (felt252, felt252);
    fn pot_of(self: @TContractState, delegate: felt252) -> u128;
    fn is_member(self: @TContractState, house_id: u64, identity_key: felt252) -> bool;
    fn get_escrow(self: @TContractState, commitment: felt252) -> Escrow;
    fn pool(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod Governance {
    use core::ec::{EcPoint, EcPointTrait, EcStateTrait};
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::storage::{StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use strk20_app::batch::{approve_batch_totals, read_batch_len};
    use strk20_app::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use strk20_app::pool_types::OpenNoteDeposit;
    use super::{Ballot, Escrow, HouseInfo, Proposal};

    // ── Operation codes ──────────────────────────────────────────────────────────────────
    /// Via `privacy_compute` — identity-bearing.
    pub const OP_BALLOT: felt252 = 1;
    pub const OP_JOIN: felt252 = 2;
    /// Via `privacy_invoke` — value without identity.
    pub const OP_DELEGATE: felt252 = 3;
    pub const OP_FUND: felt252 = 4;
    pub const OP_RECLAIM: felt252 = 5;
    pub const OP_REVOKE: felt252 = 6;

    // ── House vocabulary ─────────────────────────────────────────────────────────────────
    pub const HOUSE_NONE: u8 = 0;
    pub const HOUSE_ACTIVE: u8 = 1;
    pub const COUNT_WEIGHTED: u8 = 1;
    pub const COUNT_MEMBER: u8 = 2;
    pub const MEMBERS_OPEN: u8 = 1;
    pub const MEMBERS_INVITE: u8 = 2;

    // ── Proposal lifecycle (§5). NONE doubles as "unknown id", the markets trick. ────────
    pub const PROPOSAL_NONE: u8 = 0;
    pub const PROPOSAL_ACTIVE: u8 = 1;
    pub const PROPOSAL_SUCCEEDED: u8 = 2;
    pub const PROPOSAL_DEFEATED: u8 = 3;
    pub const PROPOSAL_EXECUTED: u8 = 4;
    pub const PROPOSAL_VOIDED: u8 = 5;

    pub const MODE_SECRET_UNTIL_CLOSE: u8 = 1;
    pub const MODE_PERMANENT: u8 = 2;

    pub const ACTION_TEXT: u8 = 1;
    pub const ACTION_SPEND: u8 = 2;

    /// Option semantics, fixed: 0 AGAINST, 1 FOR, 2 ABSTAIN (when `options == 3`).
    pub const OPT_AGAINST: u8 = 0;
    pub const OPT_FOR: u8 = 1;
    pub const MIN_OPTIONS: u8 = 2;
    pub const MAX_OPTIONS: u8 = 3;

    pub const ESCROW_NONE: u8 = 0;
    pub const ESCROW_BALLOT: u8 = 1;
    pub const ESCROW_DELEGATION: u8 = 2;
    pub const ESCROW_OPEN: u8 = 1;
    pub const ESCROW_CLAIMED: u8 = 2;

    pub const BALLOT_NONE: u8 = 0;
    pub const BALLOT_LIVE: u8 = 1;

    /// One-member-one-vote weight (§9.4): each member's ballot counts exactly this.
    pub const MEMBER_WEIGHT: u128 = 1;

    /// Shortest and longest voting windows. The floor keeps a proposal from closing before its
    /// electorate can physically vote through the pool; the ceiling keeps escrow honest — a
    /// year-long lock dressed as a vote is a different product.
    pub const MIN_WINDOW: u64 = 3600;
    pub const MAX_WINDOW: u64 = 30 * 86400;
    /// Past `deadline + VOID_AFTER` with no accepted tally, anyone voids (§15). A week: long
    /// enough for any honest Teller outage, bounded so tokens are never hostage.
    pub const VOID_AFTER: u64 = 7 * 86400;

    // ── H — the second generator (§6.3). Hash-to-curve over `passbook-governance-H-v1`,
    //    pinned byte-for-byte against `governance-commitment.ts` by the cross-test. ────────
    pub const H_X: felt252 = 0x7582d6899a59b074653bb9f46db0e7c95e5b0e0ea34ce2eda2ea3b75bff2cbe;
    pub const H_Y: felt252 = 0x33dfd9feace1e45c79c4c1488f4cd456b96f534ec997977d4bbd2bb0a668a26;
    /// The Stark curve generator, as `core::ec::stark_curve` pins it.
    pub const G_X: felt252 = 0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca;
    pub const G_Y: felt252 = 0x5668060aa49730b7be4801df46ec62de53ecd11abe43a32873000c36e8dc1f;

    #[storage]
    struct Storage {
        pool: ContractAddress,
        next_house_id: u64,
        houses: Map<u64, HouseInfo>,
        house_metadata: Map<u64, ByteArray>,
        next_proposal_id: u64,
        proposals: Map<u64, Proposal>,
        proposal_metadata: Map<u64, ByteArray>,
        /// (proposal, identity) → the live ballot.
        ballots: Map<(u64, felt252), Ballot>,
        /// (proposal, identity, option) → the ballot's commitment point, for replace/exclude.
        ballot_points: Map<(u64, felt252, u8), (felt252, felt252)>,
        /// (proposal, option) → the running accumulator. (0, 0) is the identity.
        accumulators: Map<(u64, u8), (felt252, felt252)>,
        /// Delegation pots, keyed by the delegate's identity handle (§8).
        pots: Map<felt252, u128>,
        /// The latest deadline a delegate's pot was drawn into — revocation waits it out.
        pot_locked_until: Map<felt252, u64>,
        /// (house, identity) → enrolled (invite Houses, §9.5).
        members: Map<(u64, felt252), bool>,
        /// (proposal, identity) → the committed total (own weight + drawn pot) at the last
        /// ballot — what a replace subtracts from the proposal's public total.
        committed: Map<(u64, felt252), u128>,
        /// Bearer escrow slots, keyed by `poseidon(secret)`.
        escrows: Map<felt252, Escrow>,
        /// The custody ledger — the markets' rule, verbatim (§10).
        accounted: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        HouseCreated: HouseCreated,
        ProposalCreated: ProposalCreated,
        BallotCast: BallotCast,
        Joined: Joined,
        Delegated: Delegated,
        TreasuryFunded: TreasuryFunded,
        TallyPublished: TallyPublished,
        KeyPublished: KeyPublished,
        Executed: Executed,
        ProposalVoided: ProposalVoided,
        EscrowReclaimed: EscrowReclaimed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct HouseCreated {
        #[key]
        pub house_id: u64,
        pub token: ContractAddress,
        pub counting: u8,
        pub membership: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProposalCreated {
        #[key]
        pub proposal_id: u64,
        pub house_id: u64,
        pub mode: u8,
        pub options: u8,
        pub deadline: u64,
        pub tally_key: felt252,
        pub action_kind: u8,
    }

    /// The public half of a ballot (§4.2): the handle, the weight, the count — never the choice.
    /// `sealed` is the choice+blinds encrypted to the tally key; the Teller reads it HERE, from
    /// chain events, so the ballot book is public data under the published key.
    #[derive(Drop, starknet::Event)]
    pub struct BallotCast {
        #[key]
        pub proposal_id: u64,
        pub identity_key: felt252,
        pub weight: u128,
        pub seq: u32,
        pub sealed: Span<felt252>,
    }

    /// A member COUNT moves; no member list exists to move (§9.5).
    #[derive(Drop, starknet::Event)]
    pub struct Joined {
        #[key]
        pub house_id: u64,
        pub member_count: u64,
    }

    /// The pot grew; whose tokens grew it does not exist on-chain (§8).
    #[derive(Drop, starknet::Event)]
    pub struct Delegated {
        #[key]
        pub delegate: felt252,
        pub amount: u128,
        pub pot_after: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TreasuryFunded {
        #[key]
        pub house_id: u64,
        pub amount: u128,
        pub treasury_after: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct TallyPublished {
        #[key]
        pub proposal_id: u64,
        pub tally_for: u128,
        pub tally_against: u128,
        pub excluded_count: u32,
        pub outcome: u8,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeyPublished {
        #[key]
        pub proposal_id: u64,
        pub key: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Executed {
        #[key]
        pub proposal_id: u64,
        pub action_kind: u8,
        pub amount: u128,
        pub recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ProposalVoided {
        #[key]
        pub proposal_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowReclaimed {
        #[key]
        pub commitment: felt252,
        pub kind: u8,
        pub amount: u128,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(pool.is_non_zero(), 'ZERO_POOL');
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    impl GovernanceImpl of super::IGovernance<ContractState> {
        fn privacy_compute(
            ref self: ContractState, identity_key: felt252, op: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            // Pool-only on BOTH compute ops: `identity_key` is only meaningful when the pool
            // derived it. Anyone else calling this with a chosen key would be minting voters.
            assert(get_caller_address() == self.pool.read(), 'ONLY_POOL');
            assert(identity_key != 0, 'ZERO_IDENTITY');
            if op == OP_BALLOT {
                self.op_ballot(identity_key, payload)
            } else if op == OP_JOIN {
                self.op_join(identity_key, payload)
            } else {
                core::panic_with_felt252('UNKNOWN_OP')
            }
        }

        fn privacy_invoke(
            ref self: ContractState, op: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            if op == OP_DELEGATE {
                self.op_delegate(payload)
            } else if op == OP_FUND {
                self.op_fund(payload)
            } else if op == OP_RECLAIM {
                self.op_reclaim(payload)
            } else if op == OP_REVOKE {
                self.op_revoke(payload)
            } else {
                core::panic_with_felt252('UNKNOWN_OP')
            }
        }

        /// Permissionless, creator = commitment — the `create_launch` precedent: a relayer can
        /// sponsor a creation because nothing here identifies the creator.
        fn create_house(
            ref self: ContractState,
            token: ContractAddress,
            quorum: u128,
            threshold_bps: u16,
            counting: u8,
            membership: u8,
            invite_commitment: felt252,
            metadata: ByteArray,
            creator_commitment: felt252,
        ) -> u64 {
            assert(token.is_non_zero(), 'ZERO_TOKEN');
            assert(threshold_bps < 10000, 'BAD_THRESHOLD');
            assert(counting == COUNT_WEIGHTED || counting == COUNT_MEMBER, 'BAD_COUNTING');
            assert(membership == MEMBERS_OPEN || membership == MEMBERS_INVITE, 'BAD_MEMBERSHIP');
            if membership == MEMBERS_INVITE {
                assert(invite_commitment != 0, 'ZERO_INVITE');
            } else {
                assert(invite_commitment == 0, 'INVITE_ON_OPEN_HOUSE');
                // One-member-one-vote needs a roll to count over; an open House has none.
                assert(counting == COUNT_WEIGHTED, 'MEMBER_COUNT_NEEDS_INVITE');
            }
            assert(creator_commitment != 0, 'ZERO_COMMITMENT');
            assert(metadata.len() <= 512, 'METADATA_TOO_LONG');

            let house_id = self.next_house_id.read();
            self
                .houses
                .write(
                    house_id,
                    HouseInfo {
                        token,
                        quorum,
                        threshold_bps,
                        counting,
                        membership,
                        invite_commitment,
                        member_count: 0,
                        treasury: 0,
                        creator_commitment,
                        state: HOUSE_ACTIVE,
                    },
                );
            self.house_metadata.entry(house_id).write(metadata);
            self.next_house_id.write(house_id + 1);
            self.emit(HouseCreated { house_id, token, counting, membership });
            house_id
        }

        /// Permissionless in v1, and stated: a proposal costs its proposer nothing and asks the
        /// electorate everything, so the spam bound is social (the UI ranks by escrow, and an
        /// unvoted proposal dies at its deadline). Gating on membership would need an identity,
        /// and a direct call deliberately has none.
        fn propose(
            ref self: ContractState,
            house_id: u64,
            mode: u8,
            options: u8,
            deadline: u64,
            tally_key: felt252,
            action_kind: u8,
            action_amount: u128,
            action_recipient: ContractAddress,
            metadata: ByteArray,
        ) -> u64 {
            let house = self.houses.read(house_id);
            assert(house.state == HOUSE_ACTIVE, 'NO_SUCH_HOUSE');
            assert(mode == MODE_SECRET_UNTIL_CLOSE || mode == MODE_PERMANENT, 'BAD_MODE');
            assert(options >= MIN_OPTIONS && options <= MAX_OPTIONS, 'BAD_OPTIONS');
            assert(tally_key != 0, 'ZERO_TALLY_KEY');
            assert(metadata.len() <= 2048, 'METADATA_TOO_LONG');

            let now = get_block_timestamp();
            assert(deadline > now, 'DEADLINE_PASSED');
            let window = deadline - now;
            assert(window >= MIN_WINDOW && window <= MAX_WINDOW, 'BAD_WINDOW');

            if action_kind == ACTION_TEXT {
                assert(action_amount == 0, 'TEXT_MOVES_NOTHING');
            } else if action_kind == ACTION_SPEND {
                assert(action_amount != 0, 'ZERO_SPEND');
                assert(action_recipient.is_non_zero(), 'ZERO_RECIPIENT');
            } else {
                core::panic_with_felt252('BAD_ACTION');
            }

            let proposal_id = self.next_proposal_id.read();
            self
                .proposals
                .write(
                    proposal_id,
                    Proposal {
                        house_id,
                        mode,
                        options,
                        deadline,
                        tally_key,
                        published_key: 0,
                        quorum: house.quorum,
                        threshold_bps: house.threshold_bps,
                        action_kind,
                        action_amount,
                        action_recipient,
                        state: PROPOSAL_ACTIVE,
                        total_weight: 0,
                        ballot_count: 0,
                        tally_for: 0,
                        tally_against: 0,
                    },
                );
            self.proposal_metadata.entry(proposal_id).write(metadata);
            self.next_proposal_id.write(proposal_id + 1);
            self
                .emit(
                    ProposalCreated {
                        proposal_id, house_id, mode, options, deadline, tally_key, action_kind,
                    },
                );
            proposal_id
        }

        /// The curve is the doorman (§6.3): whoever carries sums the accumulators accept may
        /// publish, and nobody can carry wrong ones.
        fn publish_tally(
            ref self: ContractState,
            proposal_id: u64,
            sums: Span<u128>,
            blind_sums: Span<felt252>,
            excluded: Span<felt252>,
        ) {
            let mut proposal = self.proposals.read(proposal_id);
            assert(proposal.state == PROPOSAL_ACTIVE, 'PROPOSAL_NOT_ACTIVE');
            assert(get_block_timestamp() >= proposal.deadline, 'TOO_EARLY');

            let options: u32 = proposal.options.into();
            assert(sums.len() == options, 'BAD_SUMS_LEN');
            assert(blind_sums.len() == options, 'BAD_BLINDS_LEN');

            // ── Subtract the excluded ballots (§4.1's malformed-commitment lane; normally
            //    empty). Exclusion is public and per-ballot, and a wrongly excluded voter can
            //    prove well-formedness by opening — which is self-incriminating for the excluder.
            let mut excluded_weight: u128 = 0;
            let mut i: u32 = 0;
            while i != excluded.len() {
                let identity = *excluded.at(i);
                let ballot = self.ballots.read((proposal_id, identity));
                assert(ballot.state == BALLOT_LIVE, 'EXCLUDED_NOT_LIVE');
                excluded_weight += ballot.weight;
                let mut opt: u8 = 0;
                while opt != proposal.options {
                    let (px, py) = self.ballot_points.read((proposal_id, identity, opt));
                    self.acc_apply(proposal_id, opt, px, py, true);
                    opt += 1;
                };
                i += 1;
            };

            // ── The equation, per option: S_i·G + R_i·H == ACC_i. ──
            let g: EcPoint = EcPointTrait::new(G_X, G_Y).expect('G_OFF_CURVE');
            let h: EcPoint = EcPointTrait::new(H_X, H_Y).expect('H_OFF_CURVE');
            let mut total: u128 = 0;
            let mut opt: u8 = 0;
            while opt != proposal.options {
                let s = *sums.at(opt.into());
                let r = *blind_sums.at(opt.into());
                total += s;

                let mut state = EcStateTrait::init();
                if s != 0 {
                    state.add_mul(s.into(), g.try_into().expect('G_ZERO'));
                }
                if r != 0 {
                    state.add_mul(r, h.try_into().expect('H_ZERO'));
                }
                let (acc_x, acc_y) = self.accumulators.read((proposal_id, opt));
                match state.finalize_nz() {
                    Option::Some(point) => {
                        let (x, y) = point.coordinates();
                        assert(x == acc_x && y == acc_y, 'TALLY_REJECTED');
                    },
                    Option::None => {
                        // S and R both zero — the sums claim an empty lane, so the accumulator
                        // must be the identity too.
                        assert(acc_x == 0 && acc_y == 0, 'TALLY_REJECTED');
                    },
                };
                opt += 1;
            };

            // ── Conservation: every ballot's weight is public, so the total is public
            //    arithmetic and a dropped lane cannot hide (§6.3's second line). ──
            assert(total == proposal.total_weight - excluded_weight, 'WEIGHT_MISMATCH');

            let tally_for = *sums.at(OPT_FOR.into());
            let tally_against = *sums.at(OPT_AGAINST.into());
            let quorum_met = total >= proposal.quorum;
            let threshold: u256 = proposal.threshold_bps.into();
            let for_256: u256 = tally_for.into();
            let against_256: u256 = tally_against.into();
            let passed = quorum_met
                && for_256 * 10000_u256 > threshold * (for_256 + against_256);

            proposal.tally_for = tally_for;
            proposal.tally_against = tally_against;
            proposal.state = if passed {
                PROPOSAL_SUCCEEDED
            } else {
                PROPOSAL_DEFEATED
            };
            self.proposals.write(proposal_id, proposal);
            self
                .emit(
                    TallyPublished {
                        proposal_id,
                        tally_for,
                        tally_against,
                        excluded_count: excluded.len(),
                        outcome: proposal.state,
                    },
                );
        }

        fn publish_key(ref self: ContractState, proposal_id: u64, key: felt252) {
            let mut proposal = self.proposals.read(proposal_id);
            assert(proposal.state != PROPOSAL_NONE, 'NO_SUCH_PROPOSAL');
            // Permanently-private NEVER publishes a key — that is the mode's whole sentence.
            assert(proposal.mode == MODE_SECRET_UNTIL_CLOSE, 'MODE_FORBIDS_KEY');
            assert(get_block_timestamp() >= proposal.deadline, 'TOO_EARLY');
            assert(proposal.published_key == 0, 'KEY_ALREADY_PUBLISHED');
            assert(key != 0, 'ZERO_KEY');
            // Permissionless ON PURPOSE: a wrong key fails to decrypt anything and forges
            // nothing, so gatekeeping it would only add a party able to withhold it.
            proposal.published_key = key;
            self.proposals.write(proposal_id, proposal);
            self.emit(KeyPublished { proposal_id, key });
        }

        /// The launch-sweep precedent: a passed spend pays a NAMED recipient directly. The
        /// treasury's funders are anonymous; its spending is the public half, on purpose.
        fn execute(ref self: ContractState, proposal_id: u64) {
            let mut proposal = self.proposals.read(proposal_id);
            assert(proposal.state == PROPOSAL_SUCCEEDED, 'NOT_SUCCEEDED');

            if proposal.action_kind == ACTION_SPEND {
                let mut house = self.houses.read(proposal.house_id);
                assert(house.treasury >= proposal.action_amount, 'TREASURY_SHORT');
                house.treasury -= proposal.action_amount;
                self.houses.write(proposal.house_id, house);
                self.release_custody(house.token, proposal.action_amount);
                IERC20Dispatcher { contract_address: house.token }
                    .transfer(proposal.action_recipient, proposal.action_amount.into());
            }

            proposal.state = PROPOSAL_EXECUTED;
            self.proposals.write(proposal_id, proposal);
            self
                .emit(
                    Executed {
                        proposal_id,
                        action_kind: proposal.action_kind,
                        amount: proposal.action_amount,
                        recipient: proposal.action_recipient,
                    },
                );
        }

        fn void_proposal(ref self: ContractState, proposal_id: u64) {
            let mut proposal = self.proposals.read(proposal_id);
            assert(proposal.state == PROPOSAL_ACTIVE, 'PROPOSAL_NOT_ACTIVE');
            assert(get_block_timestamp() > proposal.deadline + VOID_AFTER, 'TOO_EARLY');
            proposal.state = PROPOSAL_VOIDED;
            self.proposals.write(proposal_id, proposal);
            self.emit(ProposalVoided { proposal_id });
        }

        fn house_count(self: @ContractState) -> u64 {
            self.next_house_id.read()
        }
        fn get_house(self: @ContractState, house_id: u64) -> HouseInfo {
            self.houses.read(house_id)
        }
        fn house_metadata(self: @ContractState, house_id: u64) -> ByteArray {
            self.house_metadata.entry(house_id).read()
        }
        fn proposal_count(self: @ContractState) -> u64 {
            self.next_proposal_id.read()
        }
        fn get_proposal(self: @ContractState, proposal_id: u64) -> Proposal {
            self.proposals.read(proposal_id)
        }
        fn proposal_metadata(self: @ContractState, proposal_id: u64) -> ByteArray {
            self.proposal_metadata.entry(proposal_id).read()
        }
        fn get_ballot(self: @ContractState, proposal_id: u64, identity_key: felt252) -> Ballot {
            self.ballots.read((proposal_id, identity_key))
        }
        fn get_accumulator(
            self: @ContractState, proposal_id: u64, option: u8,
        ) -> (felt252, felt252) {
            self.accumulators.read((proposal_id, option))
        }
        fn pot_of(self: @ContractState, delegate: felt252) -> u128 {
            self.pots.read(delegate)
        }
        fn is_member(self: @ContractState, house_id: u64, identity_key: felt252) -> bool {
            self.members.read((house_id, identity_key))
        }
        fn get_escrow(self: @ContractState, commitment: felt252) -> Escrow {
            self.escrows.read(commitment)
        }
        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// `[house_id, proposal_id, new_total_weight, reclaim_commitment, draw_pot,
        ///   (cx, cy) × options, sealed…]`
        ///
        /// The replace rule (§4.1) in code: a new ballot from the same identity SUBTRACTS the
        /// old vector, ADDS the new one, and must commit to the identity's FULL cumulative
        /// weight — top-up and change-of-mind are the same operation with different deltas.
        fn op_ballot(
            ref self: ContractState, identity_key: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            assert(payload.len() >= 5, 'BAD_PAYLOAD');
            let house_id: u64 = (*payload.at(0)).try_into().expect('HOUSE_NOT_U64');
            let proposal_id: u64 = (*payload.at(1)).try_into().expect('PROPOSAL_NOT_U64');
            let new_total: u128 = (*payload.at(2)).try_into().expect('WEIGHT_NOT_U128');
            let reclaim_commitment = *payload.at(3);
            let draw_pot = *payload.at(4) != 0;

            let proposal = self.proposals.read(proposal_id);
            assert(proposal.state == PROPOSAL_ACTIVE, 'PROPOSAL_NOT_ACTIVE');
            assert(proposal.house_id == house_id, 'WRONG_HOUSE');
            assert(get_block_timestamp() < proposal.deadline, 'VOTING_CLOSED');
            let house = self.houses.read(house_id);

            let options: u32 = proposal.options.into();
            assert(payload.len() >= 5 + options * 2, 'BAD_PAYLOAD');

            // Membership: an invite House votes from its roll, whatever the counting mode.
            if house.membership == MEMBERS_INVITE {
                assert(self.members.read((house_id, identity_key)), 'NOT_A_MEMBER');
            }

            let mut ballot = self.ballots.read((proposal_id, identity_key));
            let prior = ballot.weight;
            let mut own_total: u128 = MEMBER_WEIGHT;

            if house.counting == COUNT_MEMBER {
                // One member, one vote, no escrow (§9.4): the weight is fixed and the pool's
                // identity uniqueness is the whole sybil argument.
                assert(new_total == MEMBER_WEIGHT, 'MEMBER_WEIGHT_FIXED');
                assert(!draw_pot, 'MEMBER_MODE_NO_POT');
                assert(reclaim_commitment == 0, 'MEMBER_MODE_NO_ESCROW');
            } else {
                // Weighted: the pot can be drawn (a delegate voting with lent weight, §8), and
                // any NEW own-weight must have genuinely arrived through the pool this
                // transaction — the custody check is the authorisation.
                let pot = if draw_pot {
                    self.pots.read(identity_key)
                } else {
                    0
                };
                if draw_pot {
                    let locked = self.pot_locked_until.read(identity_key);
                    if proposal.deadline > locked {
                        self.pot_locked_until.write(identity_key, proposal.deadline);
                    }
                }
                assert(new_total >= pot, 'WEIGHT_UNDER_POT');
                own_total = new_total - pot;
                assert(own_total >= prior, 'WEIGHT_SHRANK');
                let delta = own_total - prior;
                if delta != 0 {
                    assert(reclaim_commitment != 0, 'ZERO_COMMITMENT');
                    assert(
                        self.escrows.read(reclaim_commitment).state == ESCROW_NONE,
                        'COMMITMENT_USED',
                    );
                    self.take_custody(house.token, delta);
                    self
                        .escrows
                        .write(
                            reclaim_commitment,
                            Escrow {
                                kind: ESCROW_BALLOT,
                                proposal_id,
                                delegate: 0,
                                token: house.token,
                                amount: delta,
                                state: ESCROW_OPEN,
                            },
                        );
                } else {
                    // A pure change of mind carries no new value and needs no new secret.
                    assert(reclaim_commitment == 0, 'COMMITMENT_WITHOUT_VALUE');
                }
            }

            // ── The vector swap: out with the old points, in with the new. ──
            let mut opt: u8 = 0;
            while opt != proposal.options {
                if ballot.state == BALLOT_LIVE {
                    let (old_x, old_y) = self.ballot_points.read((proposal_id, identity_key, opt));
                    self.acc_apply(proposal_id, opt, old_x, old_y, true);
                }
                let base: u32 = 5 + opt.into() * 2;
                let cx = *payload.at(base);
                let cy = *payload.at(base + 1);
                // `EcPointTrait::new` validates on-curve — garbage points revert here, which is
                // cheaper for everyone than an exclusion at publication.
                let _valid: EcPoint = EcPointTrait::new(cx, cy).expect('POINT_OFF_CURVE');
                self.ballot_points.write((proposal_id, identity_key, opt), (cx, cy));
                self.acc_apply(proposal_id, opt, cx, cy, false);
                opt += 1;
            };

            // ── Book the public half: the total swaps the old committed weight for the new. ──
            let mut proposal_mut = self.proposals.read(proposal_id);
            let committed_prior = if ballot.state == BALLOT_LIVE {
                self.committed.read((proposal_id, identity_key))
            } else {
                proposal_mut.ballot_count += 1;
                0
            };
            proposal_mut.total_weight = proposal_mut.total_weight - committed_prior + new_total;
            self.proposals.write(proposal_id, proposal_mut);

            ballot.weight = own_total;
            ballot.seq += 1;
            ballot.state = BALLOT_LIVE;
            self.ballots.write((proposal_id, identity_key), ballot);
            self.committed.write((proposal_id, identity_key), new_total);

            let sealed = payload.slice(5 + options * 2, payload.len() - 5 - options * 2);
            self
                .emit(
                    BallotCast {
                        proposal_id, identity_key, weight: new_total, seq: ballot.seq, sealed,
                    },
                );

            // Funding leg: money in, empty span out (§10.2).
            array![].span()
        }

        /// `[house_id, invite_secret]` — zero-value, enrolls the identity on the roll (§9.5).
        fn op_join(
            ref self: ContractState, identity_key: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            assert(payload.len() == 2, 'BAD_PAYLOAD');
            let house_id: u64 = (*payload.at(0)).try_into().expect('HOUSE_NOT_U64');
            let invite_secret = *payload.at(1);

            let mut house = self.houses.read(house_id);
            assert(house.state == HOUSE_ACTIVE, 'NO_SUCH_HOUSE');
            assert(house.membership == MEMBERS_INVITE, 'OPEN_HOUSE_NO_ROLL');
            assert(
                poseidon_hash_span(array![invite_secret].span()) == house.invite_commitment,
                'WRONG_INVITE',
            );
            assert(!self.members.read((house_id, identity_key)), 'ALREADY_A_MEMBER');

            self.members.write((house_id, identity_key), true);
            house.member_count += 1;
            self.houses.write(house_id, house);
            self.emit(Joined { house_id, member_count: house.member_count });
            array![].span()
        }

        /// `[house_id, delegate_handle, amount, reclaim_commitment]` — the pot grows in public,
        /// its source never exists on-chain (§8). Pool-only: the amount must have arrived.
        fn op_delegate(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), 'ONLY_POOL');
            assert(payload.len() == 4, 'BAD_PAYLOAD');
            let house_id: u64 = (*payload.at(0)).try_into().expect('HOUSE_NOT_U64');
            let delegate = *payload.at(1);
            let amount: u128 = (*payload.at(2)).try_into().expect('AMOUNT_NOT_U128');
            let reclaim_commitment = *payload.at(3);

            let house = self.houses.read(house_id);
            assert(house.state == HOUSE_ACTIVE, 'NO_SUCH_HOUSE');
            assert(delegate != 0, 'ZERO_DELEGATE');
            assert(amount != 0, 'ZERO_AMOUNT');
            assert(reclaim_commitment != 0, 'ZERO_COMMITMENT');
            assert(self.escrows.read(reclaim_commitment).state == ESCROW_NONE, 'COMMITMENT_USED');

            self.take_custody(house.token, amount);
            let pot_after = self.pots.read(delegate) + amount;
            self.pots.write(delegate, pot_after);
            self
                .escrows
                .write(
                    reclaim_commitment,
                    Escrow {
                        kind: ESCROW_DELEGATION,
                        proposal_id: 0,
                        delegate,
                        token: house.token,
                        amount,
                        state: ESCROW_OPEN,
                    },
                );
            self.emit(Delegated { delegate, amount, pot_after });
            array![].span()
        }

        /// `[house_id, amount]` — anonymous open-note deposit into the House pot (§7.1). No
        /// commitment: this money is GIVEN, and a treasury that could be clawed back one donor
        /// at a time would not be a treasury.
        fn op_fund(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), 'ONLY_POOL');
            assert(payload.len() == 2, 'BAD_PAYLOAD');
            let house_id: u64 = (*payload.at(0)).try_into().expect('HOUSE_NOT_U64');
            let amount: u128 = (*payload.at(1)).try_into().expect('AMOUNT_NOT_U128');

            let mut house = self.houses.read(house_id);
            assert(house.state == HOUSE_ACTIVE, 'NO_SUCH_HOUSE');
            assert(amount != 0, 'ZERO_AMOUNT');

            self.take_custody(house.token, amount);
            house.treasury += amount;
            self.houses.write(house_id, house);
            self.emit(TreasuryFunded { house_id, amount, treasury_after: house.treasury });
            array![].span()
        }

        /// `[n, (secret, note_id) × n]` — ballot escrows back to their bearers after close
        /// (§4.3). The op_claim shape: pool-only, exactly n deposits, approve-batch-totals.
        fn op_reclaim(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            let pool = self.pool.read();
            assert(get_caller_address() == pool, 'ONLY_POOL');
            let n = read_batch_len(payload, 2);

            let mut deposits: Array<OpenNoteDeposit> = array![];
            let mut tokens: Array<ContractAddress> = array![];
            let mut amounts: Array<u128> = array![];

            let mut i: u32 = 0;
            while i != n {
                let base = 1 + i * 2;
                let secret = *payload.at(base);
                let note_id = *payload.at(base + 1);
                assert(note_id != 0, 'ZERO_NOTE_ID');

                let commitment = poseidon_hash_span(array![secret].span());
                let mut escrow = self.escrows.read(commitment);
                assert(escrow.state == ESCROW_OPEN, 'ESCROW_NOT_OPEN');
                assert(escrow.kind == ESCROW_BALLOT, 'NOT_A_BALLOT_ESCROW');

                // Locked while the vote is open — the no-double-count rule; every terminal
                // state (succeeded, defeated, executed, voided) opens the exit.
                let proposal = self.proposals.read(escrow.proposal_id);
                assert(proposal.state != PROPOSAL_ACTIVE, 'VOTE_STILL_OPEN');

                escrow.state = ESCROW_CLAIMED;
                self.escrows.write(commitment, escrow);
                self.release_custody(escrow.token, escrow.amount);

                deposits
                    .append(
                        OpenNoteDeposit {
                            note_id, token: escrow.token, amount: escrow.amount,
                        },
                    );
                tokens.append(escrow.token);
                amounts.append(escrow.amount);
                self
                    .emit(
                        EscrowReclaimed {
                            commitment, kind: ESCROW_BALLOT, amount: escrow.amount,
                        },
                    );
                i += 1;
            };

            approve_batch_totals(pool, tokens.span(), amounts.span());
            deposits.span()
        }

        /// `[n, (secret, note_id) × n]` — delegations drained back to their holders (§8).
        /// Immediate unless the delegate's pot is bound into a still-open ballot.
        fn op_revoke(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            let pool = self.pool.read();
            assert(get_caller_address() == pool, 'ONLY_POOL');
            let n = read_batch_len(payload, 2);

            let mut deposits: Array<OpenNoteDeposit> = array![];
            let mut tokens: Array<ContractAddress> = array![];
            let mut amounts: Array<u128> = array![];

            let mut i: u32 = 0;
            while i != n {
                let base = 1 + i * 2;
                let secret = *payload.at(base);
                let note_id = *payload.at(base + 1);
                assert(note_id != 0, 'ZERO_NOTE_ID');

                let commitment = poseidon_hash_span(array![secret].span());
                let mut escrow = self.escrows.read(commitment);
                assert(escrow.state == ESCROW_OPEN, 'ESCROW_NOT_OPEN');
                assert(escrow.kind == ESCROW_DELEGATION, 'NOT_A_DELEGATION');
                assert(
                    get_block_timestamp() > self.pot_locked_until.read(escrow.delegate),
                    'POT_BOUND_IN_A_VOTE',
                );

                escrow.state = ESCROW_CLAIMED;
                self.escrows.write(commitment, escrow);
                let pot = self.pots.read(escrow.delegate);
                assert(pot >= escrow.amount, 'POT_LEDGER_BROKEN');
                self.pots.write(escrow.delegate, pot - escrow.amount);
                self.release_custody(escrow.token, escrow.amount);

                deposits
                    .append(
                        OpenNoteDeposit {
                            note_id, token: escrow.token, amount: escrow.amount,
                        },
                    );
                tokens.append(escrow.token);
                amounts.append(escrow.amount);
                self
                    .emit(
                        EscrowReclaimed {
                            commitment, kind: ESCROW_DELEGATION, amount: escrow.amount,
                        },
                    );
                i += 1;
            };

            approve_batch_totals(pool, tokens.span(), amounts.span());
            deposits.span()
        }

        /// Add (or subtract) one point into an accumulator slot. (0, 0) is the identity.
        fn acc_apply(
            ref self: ContractState,
            proposal_id: u64,
            option: u8,
            px: felt252,
            py: felt252,
            negate: bool,
        ) {
            let point: EcPoint = EcPointTrait::new(px, py).expect('POINT_OFF_CURVE');
            let signed = if negate {
                -point
            } else {
                point
            };
            let (acc_x, acc_y) = self.accumulators.read((proposal_id, option));
            let mut state = EcStateTrait::init();
            if !(acc_x == 0 && acc_y == 0) {
                let held: EcPoint = EcPointTrait::new(acc_x, acc_y).expect('ACC_OFF_CURVE');
                state.add(held.try_into().expect('ACC_ZERO'));
            }
            state.add(signed.try_into().expect('POINT_ZERO'));
            match state.finalize_nz() {
                Option::Some(result) => {
                    let (x, y) = result.coordinates();
                    self.accumulators.write((proposal_id, option), (x, y));
                },
                Option::None => { self.accumulators.write((proposal_id, option), (0, 0)); },
            };
        }

        /// The markets' custody ledger, verbatim (§10) — funding is the authorisation.
        fn take_custody(ref self: ContractState, token: ContractAddress, amount: u128) {
            let held = IERC20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            let booked = self.accounted.read(token);
            assert(held >= booked, 'CUSTODY_LEDGER_BROKEN');
            assert(held - booked >= amount.into(), 'FUNDS_NOT_RECEIVED');
            self.accounted.write(token, booked + amount.into());
        }

        fn release_custody(ref self: ContractState, token: ContractAddress, amount: u128) {
            let booked = self.accounted.read(token);
            assert(booked >= amount.into(), 'CUSTODY_LEDGER_BROKEN');
            self.accounted.write(token, booked - amount.into());
        }
    }
}
