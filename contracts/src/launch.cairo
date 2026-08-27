//! Passbook Launch — confidential token launches on a stepwise-linear epoch curve.
//!
//! ── WHY EPOCHS AND NOT A BONDING CURVE ───────────────────────────────────────────────────
//!
//! On a continuous curve every buyer pays a different price, so the only winning move is to be
//! earlier than everyone else — which on a public mempool means paying for priority, and on a
//! private pool means the people who cannot see the flow are systematically the ones who lose.
//! Here the supply is cut into `epochs` epochs of 16 units each, and **every unit inside an epoch
//! costs exactly the same**. Being first inside an epoch is worth nothing. That is not a promise
//! in a README, it is what `cost_of` computes, and `everyone_in_an_epoch_pays_the_same_price`
//! is the test that says so.
//!
//! Epoch `e` prices a unit at `p0 + e·dp`. A buy that runs past an epoch boundary is summed
//! per-epoch, so it pays the real price of each slice rather than one blended number.
//!
//! ── PRICES ARE PER UNIT, NOT PER TOKEN ───────────────────────────────────────────────────
//!
//! The design sketch wrote the curve as a per-token price. That is unrepresentable: with 18-decimal
//! tokens, a realistic raise (~60 STRK for ~1e6 tokens) prices one token at ~6e-5 base units, which
//! as an integer is zero. So `p0` and `dp` are the price of one UNIT, in the stake token's base
//! units, and the curve is otherwise exactly as designed. Every cost is then an integer
//! multiplication with no division anywhere — which is why `Σ refunds == raised` closes exactly.
//!
//! ── THE MONEY, END TO END ────────────────────────────────────────────────────────────────
//!
//! Buyers pay stake (STRK) and hold a bearer commitment. If every unit sells, anyone may
//! `graduate`: the contract deploys the token, mints the whole supply to itself, and buyers redeem
//! their units for tokens into the pool. The creator sweeps the raise. If the deadline passes with
//! units unsold, the launch fails and every buyer takes back exactly what they paid — the first
//! refund flips the state, so no keeper has to be alive for people to get their money.
//!
//! ── DELIBERATE CUTS, STATED RATHER THAN HIDDEN ───────────────────────────────────────────
//!
//! No DEX auto-listing at graduation. No creator royalty. No sell-back before graduation — buys
//! are one-way, and a launch is not a market. The logo is a URI whose length is checked and whose
//! contents are not; this contract does not fetch it and cannot vouch for it.
//!
//! ── WHAT IS NOT PRIVATE ──────────────────────────────────────────────────────────────────
//!
//! Amounts and the sale curve are PUBLIC. `Bought` carries the cost in the clear, and anyone can
//! reconstruct the whole order book of a launch. What they cannot do is say whose it is — the
//! buyer's address never appears, because the money arrives through the pool and leaves through
//! open notes. `sweep` is the one exception, and it is public by construction: the creator names
//! the address the raise goes to.

use starknet::ContractAddress;

/// A launch. Public so the web client can decode `get_launch` without a hand-written ABI.
///
/// `unit_tokens` (tokens per unit) is stored instead of the design's `tranche` (tokens per epoch):
/// `tranche == unit_tokens * UNITS_PER_EPOCH`, and the unit is what every other quantity here is
/// counted in, so it is the one that should not need a division to recover.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct LaunchInfo {
    /// What buyers pay in. Not in the design's `create_launch` signature, but custody has to know
    /// which balance to measure, and hard-coding STRK into a contract is worse than a parameter.
    pub stake_token: ContractAddress,
    /// The deployed ERC20. Zero until graduation.
    pub token: ContractAddress,
    /// Price of one unit in epoch 0, in stake base units.
    pub p0: u128,
    /// Added to the unit price with each epoch.
    pub dp: u128,
    pub unit_tokens: u128,
    pub epochs: u32,
    /// Units sold so far. `sold == epochs * UNITS_PER_EPOCH` is the graduation condition.
    pub sold: u32,
    pub raised: u128,
    pub deadline: u64,
    /// `poseidon(creator_secret)`. Creating can be relayer-sponsored precisely because the creator
    /// is never an address — whoever holds the secret sweeps, no matter who paid the gas.
    pub creator_commitment: felt252,
    pub state: u8,
    pub swept: bool,
}

/// A bearer claim on a launch, keyed by `poseidon(secret)`.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Position {
    pub launch_id: u64,
    pub units: u32,
    /// What was paid. The refund amount if the launch fails.
    pub cash_in: u128,
    pub state: u8,
}

#[starknet::interface]
pub trait ILaunch<TContractState> {
    /// Direct call, moves no money. Separate from `privacy_invoke` so a relayer can sponsor a
    /// creation for someone who has no funded address at all — the creator is a commitment, so
    /// sponsorship gives the relayer nothing to sweep.
    fn create_launch(
        ref self: TContractState,
        name: ByteArray,
        symbol: ByteArray,
        logo_uri: ByteArray,
        stake_token: ContractAddress,
        p0: u128,
        dp: u128,
        tranche: u128,
        epochs: u32,
        deadline: u64,
        creator_commitment: felt252,
    ) -> u64;

    fn privacy_invoke(
        ref self: TContractState, op: felt252, payload: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;

    fn graduate(ref self: TContractState, launch_id: u64);
    fn sweep(
        ref self: TContractState, launch_id: u64, secret: felt252, to_addr: ContractAddress,
    );

    fn quote_buy(self: @TContractState, launch_id: u64, units: u32) -> u128;
    fn preview_redeem(self: @TContractState, commitments: Span<felt252>) -> Span<u128>;
    fn preview_refund(self: @TContractState, commitments: Span<felt252>) -> Span<u128>;
    fn get_launch(self: @TContractState, launch_id: u64) -> LaunchInfo;
    fn get_position(self: @TContractState, commitment: felt252) -> Position;
    fn launch_count(self: @TContractState) -> u64;
    fn launch_name(self: @TContractState, launch_id: u64) -> ByteArray;
    fn launch_symbol(self: @TContractState, launch_id: u64) -> ByteArray;
    fn launch_logo(self: @TContractState, launch_id: u64) -> ByteArray;
    fn total_units(self: @TContractState, launch_id: u64) -> u32;
    fn pool(self: @TContractState) -> ContractAddress;
}

use strk20_app::pool_types::OpenNoteDeposit;

#[starknet::contract]
pub mod Launch {
    use core::num::traits::Zero;
    use core::poseidon::poseidon_hash_span;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::deploy_syscall;
    use starknet::{
        ClassHash, ContractAddress, SyscallResultTrait, get_block_timestamp, get_caller_address,
        get_contract_address,
    };
    use strk20_app::batch::{approve_batch_totals, first_occurrence_total, read_batch_len};
    use strk20_app::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use strk20_app::pool_types::OpenNoteDeposit;
    use super::{LaunchInfo, Position};

    pub const OP_BUY: felt252 = 1;
    pub const OP_REDEEM: felt252 = 2;
    pub const OP_REFUND: felt252 = 3;

    pub const LAUNCH_NONE: u8 = 0;
    pub const LAUNCH_ACTIVE: u8 = 1;
    pub const LAUNCH_GRADUATED: u8 = 2;
    pub const LAUNCH_FAILED: u8 = 3;

    pub const POS_NONE: u8 = 0;
    pub const POS_OPEN: u8 = 1;
    pub const POS_CLOSED: u8 = 2;

    /// Units in every epoch. Fixed at 16 so an epoch boundary always lands on a unit boundary —
    /// which is what lets a cross-epoch buy be summed per-epoch with no remainder anywhere.
    pub const UNITS_PER_EPOCH: u32 = 16;
    /// Bounds the per-epoch summation loop, and with it the worst-case gas of a buy.
    pub const MAX_EPOCHS: u32 = 64;
    /// The deployed token's decimals. Fixed rather than a parameter: 18 is what every wallet,
    /// explorer and router assumes, and a launch is not the place to be interesting.
    pub const TOKEN_DECIMALS: u8 = 18;

    pub const MAX_TEXT_LEN: u32 = 64;
    pub const MAX_URI_LEN: u32 = 256;

    #[storage]
    struct Storage {
        pool: ContractAddress,
        /// Declared once, deployed per graduation. Storing the class rather than an address is
        /// what makes every launch's token provably the same bytecode.
        token_class_hash: ClassHash,
        next_launch_id: u64,
        launches: Map<u64, LaunchInfo>,
        /// Kept out of `LaunchInfo` because a dynamic-length type inside a `Store`-derived struct
        /// is a needless hazard; these are only read at graduation and for display.
        names: Map<u64, ByteArray>,
        symbols: Map<u64, ByteArray>,
        logos: Map<u64, ByteArray>,
        positions: Map<felt252, Position>,
        /// Custody ledger, per token — see `take_custody`. It carries BOTH the stake token and,
        /// after graduation, the launch token's whole supply.
        accounted: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LaunchCreated: LaunchCreated,
        Bought: Bought,
        Graduated: Graduated,
        Failed: Failed,
        Redeemed: Redeemed,
        Refunded: Refunded,
        Swept: Swept,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LaunchCreated {
        #[key]
        pub launch_id: u64,
        pub stake_token: ContractAddress,
        pub p0: u128,
        pub dp: u128,
        pub unit_tokens: u128,
        pub epochs: u32,
        pub deadline: u64,
        pub creator_commitment: felt252,
    }

    /// The launch's whole public history. `epoch` is the epoch the buy STARTED in; a buy spanning
    /// a boundary paid more than that epoch's price for its tail, which `cost` already reflects.
    #[derive(Drop, starknet::Event)]
    pub struct Bought {
        #[key]
        pub launch_id: u64,
        pub epoch: u32,
        pub units: u32,
        pub cost: u128,
        pub sold_after: u32,
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Graduated {
        #[key]
        pub launch_id: u64,
        pub token: ContractAddress,
        pub total_supply: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Failed {
        #[key]
        pub launch_id: u64,
        pub sold: u32,
        pub raised: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Redeemed {
        #[key]
        pub commitment: felt252,
        pub launch_id: u64,
        pub units: u32,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Refunded {
        #[key]
        pub commitment: felt252,
        pub launch_id: u64,
        pub amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Swept {
        #[key]
        pub launch_id: u64,
        pub amount: u128,
        pub to_addr: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, pool: ContractAddress, token_class_hash: ClassHash,
    ) {
        assert(pool.is_non_zero(), 'ZERO_POOL');
        assert(token_class_hash.is_non_zero(), 'ZERO_CLASS_HASH');
        self.pool.write(pool);
        self.token_class_hash.write(token_class_hash);
    }

    #[abi(embed_v0)]
    impl LaunchImpl of super::ILaunch<ContractState> {
        fn create_launch(
            ref self: ContractState,
            name: ByteArray,
            symbol: ByteArray,
            logo_uri: ByteArray,
            stake_token: ContractAddress,
            p0: u128,
            dp: u128,
            tranche: u128,
            epochs: u32,
            deadline: u64,
            creator_commitment: felt252,
        ) -> u64 {
            assert(name.len() != 0 && name.len() <= MAX_TEXT_LEN, 'BAD_NAME');
            assert(symbol.len() != 0 && symbol.len() <= MAX_TEXT_LEN, 'BAD_SYMBOL');
            // Length only. This contract never fetches the URI and cannot vouch for what is
            // behind it; pretending otherwise would be the dishonest kind of validation.
            assert(logo_uri.len() <= MAX_URI_LEN, 'BAD_LOGO_URI');

            assert(stake_token.is_non_zero(), 'ZERO_STAKE_TOKEN');
            assert(p0 != 0, 'ZERO_PRICE');
            assert(epochs != 0 && epochs <= MAX_EPOCHS, 'BAD_EPOCHS');
            assert(creator_commitment != 0, 'ZERO_COMMITMENT');
            assert(deadline > get_block_timestamp(), 'DEADLINE_PASSED');

            let units_per_epoch: u128 = UNITS_PER_EPOCH.into();
            assert(tranche != 0, 'ZERO_TRANCHE');
            // Exact division or the unit is a lie and the last buyer of an epoch is short-changed.
            assert(tranche % units_per_epoch == 0, 'TRANCHE_NOT_DIVISIBLE');
            let unit_tokens = tranche / units_per_epoch;

            // Prove up front that nothing downstream can overflow, so no buyer ever discovers it
            // by having their transaction revert.
            assert_curve_fits(p0, dp, epochs, unit_tokens);

            let launch_id = self.next_launch_id.read();
            self
                .launches
                .write(
                    launch_id,
                    LaunchInfo {
                        stake_token,
                        token: Zero::zero(),
                        p0,
                        dp,
                        unit_tokens,
                        epochs,
                        sold: 0,
                        raised: 0,
                        deadline,
                        creator_commitment,
                        state: LAUNCH_ACTIVE,
                        swept: false,
                    },
                );
            self.next_launch_id.write(launch_id + 1);

            self.names.write(launch_id, name);
            self.symbols.write(launch_id, symbol);
            self.logos.write(launch_id, logo_uri);

            self
                .emit(
                    LaunchCreated {
                        launch_id,
                        stake_token,
                        p0,
                        dp,
                        unit_tokens,
                        epochs,
                        deadline,
                        creator_commitment,
                    },
                );

            launch_id
        }

        fn privacy_invoke(
            ref self: ContractState, op: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            if op == OP_BUY {
                self.op_buy(payload)
            } else if op == OP_REDEEM {
                self.op_redeem(payload)
            } else if op == OP_REFUND {
                self.op_refund(payload)
            } else {
                core::panic_with_felt252('UNKNOWN_OP')
            }
        }

        /// Permissionless, and with no deadline of its own: a launch that sold every unit has
        /// earned its token, and whether someone remembered to call this in time is not a reason
        /// to strand a completed sale.
        fn graduate(ref self: ContractState, launch_id: u64) {
            let mut launch = self.launches.read(launch_id);
            assert(launch.state == LAUNCH_ACTIVE, 'LAUNCH_NOT_ACTIVE');
            assert(launch.sold == total_units_of(launch), 'NOT_SOLD_OUT');

            let total_supply = total_supply_of(launch);

            // Mark graduated BEFORE deploying. Our own token's constructor calls nothing and the
            // class hash is fixed at construction, so this is belt-and-braces — but a constructor
            // that could call back would otherwise find a still-ACTIVE, still-sold-out launch and
            // deploy a second token over the first.
            launch.state = LAUNCH_GRADUATED;
            self.launches.write(launch_id, launch);

            let mut calldata: Array<felt252> = array![];
            self.names.read(launch_id).serialize(ref calldata);
            self.symbols.read(launch_id).serialize(ref calldata);
            TOKEN_DECIMALS.serialize(ref calldata);
            total_supply.serialize(ref calldata);
            get_contract_address().serialize(ref calldata);

            // `deploy_from_zero: false` makes the address depend on this contract, so `launch_id`
            // alone is a sufficient salt and every launch gets a distinct token.
            let (token, _) = deploy_syscall(
                self.token_class_hash.read(), launch_id.into(), calldata.span(), false,
            )
                .unwrap_syscall();

            launch.token = token;
            launch.state = LAUNCH_GRADUATED;
            self.launches.write(launch_id, launch);

            // Book the entire minted supply as spoken-for, immediately.
            //
            // This is load-bearing, not bookkeeping. `take_custody` recognises new funds as
            // `balance_of - accounted`, so an unbooked supply sitting here would read as free
            // money: someone could open a second launch whose STAKE token is this launch's token,
            // "buy" it with the supply we are holding for its real buyers, and sweep it away.
            // Booking it at the moment it is minted closes that off — the ledger then drains to
            // exactly zero as buyers redeem, because a launch only graduates fully sold.
            self.accounted.write(token, total_supply);

            self.emit(Graduated { launch_id, token, total_supply });
        }

        /// Pays the raise to an address the creator names, on proof of the creator secret.
        ///
        /// Only after graduation: if the launch failed, the stake is the buyers' money, not the
        /// creator's. This is the one deliberately public leg in the contract.
        fn sweep(
            ref self: ContractState, launch_id: u64, secret: felt252, to_addr: ContractAddress,
        ) {
            assert(to_addr.is_non_zero(), 'ZERO_RECIPIENT');

            let mut launch = self.launches.read(launch_id);
            assert(launch.state == LAUNCH_GRADUATED, 'NOT_GRADUATED');
            assert(!launch.swept, 'ALREADY_SWEPT');
            assert(
                poseidon_hash_span(array![secret].span()) == launch.creator_commitment,
                'BAD_CREATOR_SECRET',
            );

            let amount = launch.raised;
            assert(amount != 0, 'NOTHING_TO_SWEEP');

            launch.swept = true;
            self.launches.write(launch_id, launch);
            self.release_custody(launch.stake_token, amount);

            IERC20Dispatcher { contract_address: launch.stake_token }
                .transfer(to_addr, amount.into());

            self.emit(Swept { launch_id, amount, to_addr });
        }

        /// What `units` would cost right now. Total by construction — a quote that panics is a
        /// quote the UI cannot render, so anything unbuyable quotes as 0.
        fn quote_buy(self: @ContractState, launch_id: u64, units: u32) -> u128 {
            let launch = self.launches.read(launch_id);
            if launch.state != LAUNCH_ACTIVE {
                return 0;
            }
            if units == 0 {
                return 0;
            }
            // Written as a subtraction, not `sold + units > total`: `units` arrives from a felt
            // and can be near 2^32, so the addition would overflow and panic — inside a view
            // that is supposed to be total.
            if units > total_units_of(launch) - launch.sold {
                return 0;
            }
            cost_of(launch.p0, launch.dp, launch.sold, units)
        }

        /// Launch tokens each commitment would receive, 0 meaning "cannot redeem".
        ///
        /// The pool reverts on a zero-amount deposit, so the client filters against this before
        /// building a batch — same discipline as claiming a market.
        fn preview_redeem(self: @ContractState, commitments: Span<felt252>) -> Span<u128> {
            let mut out: Array<u128> = array![];
            let mut i: u32 = 0;
            let n = commitments.len();
            while i != n {
                out.append(self.redeemable_of(*commitments.at(i)));
                i += 1;
            };
            out.span()
        }

        /// Stake each commitment would take back, 0 meaning "cannot refund". Reports correctly
        /// for a launch that is failed-but-not-yet-flipped, because a view cannot write.
        fn preview_refund(self: @ContractState, commitments: Span<felt252>) -> Span<u128> {
            let mut out: Array<u128> = array![];
            let mut i: u32 = 0;
            let n = commitments.len();
            while i != n {
                out.append(self.refundable_of(*commitments.at(i)));
                i += 1;
            };
            out.span()
        }

        fn get_launch(self: @ContractState, launch_id: u64) -> LaunchInfo {
            self.launches.read(launch_id)
        }

        fn get_position(self: @ContractState, commitment: felt252) -> Position {
            self.positions.read(commitment)
        }

        fn launch_count(self: @ContractState) -> u64 {
            self.next_launch_id.read()
        }

        fn launch_name(self: @ContractState, launch_id: u64) -> ByteArray {
            self.names.read(launch_id)
        }

        fn launch_symbol(self: @ContractState, launch_id: u64) -> ByteArray {
            self.symbols.read(launch_id)
        }

        fn launch_logo(self: @ContractState, launch_id: u64) -> ByteArray {
            self.logos.read(launch_id)
        }

        fn total_units(self: @ContractState, launch_id: u64) -> u32 {
            total_units_of(self.launches.read(launch_id))
        }

        fn pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// `[n, (launch_id, units, commitment) × n]`
        ///
        /// Permissionless — the custody check is the only authorisation that matters. Buys are
        /// one-way: there is no sell-back before graduation, deliberately. Returns an empty span,
        /// because money is going IN.
        fn op_buy(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
            let n = read_batch_len(payload, 3);
            let now = get_block_timestamp();

            let mut tokens: Array<ContractAddress> = array![];
            let mut amounts: Array<u128> = array![];

            let mut i: u32 = 0;
            while i != n {
                let base = 1 + i * 3;
                let launch_id: u64 = (*payload.at(base)).try_into().expect('LAUNCH_NOT_U64');
                let units: u32 = (*payload.at(base + 1)).try_into().expect('UNITS_NOT_U32');
                let commitment = *payload.at(base + 2);

                let mut launch = self.launches.read(launch_id);
                assert(launch.state == LAUNCH_ACTIVE, 'LAUNCH_NOT_ACTIVE');
                assert(now < launch.deadline, 'SALE_CLOSED');
                assert(units != 0, 'ZERO_UNITS');
                // Subtraction rather than addition, so an absurd `units` is refused by name
                // instead of overflowing u32 into a generic arithmetic panic.
                assert(units <= total_units_of(launch) - launch.sold, 'NOT_ENOUGH_UNITS');
                assert(commitment != 0, 'ZERO_COMMITMENT');
                assert(self.positions.read(commitment).state == POS_NONE, 'COMMITMENT_USED');

                let epoch = launch.sold / UNITS_PER_EPOCH;
                let cost = cost_of(launch.p0, launch.dp, launch.sold, units);

                launch.sold += units;
                launch.raised += cost;
                // Written back inside the loop, so two buys of the same launch in one batch walk
                // the curve in order rather than both taking the opening price.
                self.launches.write(launch_id, launch);

                self
                    .positions
                    .write(
                        commitment,
                        Position { launch_id, units, cash_in: cost, state: POS_OPEN },
                    );

                tokens.append(launch.stake_token);
                amounts.append(cost);

                self
                    .emit(
                        Bought {
                            launch_id,
                            epoch,
                            units,
                            cost,
                            sold_after: launch.sold,
                            commitment,
                        },
                    );

                i += 1;
            };

            // Custody runs last only because the stake token is discovered per launch. Nothing
            // above transfers or calls out, so there is no reentrancy in the gap, and a failure
            // here reverts every write the loop just made.
            let tokens = tokens.span();
            let amounts = amounts.span();
            let mut i: u32 = 0;
            while i != n {
                let total = first_occurrence_total(tokens, amounts, i);
                if total != 0 {
                    self.take_custody(*tokens.at(i), total);
                }
                i += 1;
            };

            array![].span()
        }

        /// `[n, (secret, note_id) × n]` → exactly `n` deposits of the LAUNCH token.
        ///
        /// Pool-only: the tokens leave when the pool pulls them while crediting the open notes it
        /// created earlier in the same transaction. Day-0 verification says this is legal — the
        /// pool has no token allowlist anywhere in its deposit path (proven live against a
        /// phantom token), and the client emits an `OpenSubchannel` for the new token in the same
        /// transaction.
        fn op_redeem(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
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
                let mut position = self.positions.read(commitment);
                // Covers an unknown secret and a second redemption in one assertion.
                assert(position.state == POS_OPEN, 'POSITION_NOT_OPEN');

                let launch = self.launches.read(position.launch_id);
                assert(launch.state == LAUNCH_GRADUATED, 'NOT_GRADUATED');

                let amount = position.units.into() * launch.unit_tokens;
                assert(amount != 0, 'NOTHING_TO_REDEEM');

                position.state = POS_CLOSED;
                self.positions.write(commitment, position);
                self.release_custody(launch.token, amount);

                deposits.append(OpenNoteDeposit { note_id, token: launch.token, amount });
                tokens.append(launch.token);
                amounts.append(amount);

                self
                    .emit(
                        Redeemed {
                            commitment,
                            launch_id: position.launch_id,
                            units: position.units,
                            amount,
                        },
                    );

                i += 1;
            };

            approve_batch_totals(pool, tokens.span(), amounts.span());

            deposits.span()
        }

        /// `[n, (secret, note_id) × n]` → exactly `n` deposits of the STAKE token.
        ///
        /// The first refund after a missed deadline is what flips the launch to Failed, so no
        /// keeper needs to be alive for people to get their money back — the person who wants
        /// their refund is sufficient motivation.
        fn op_refund(ref self: ContractState, payload: Span<felt252>) -> Span<OpenNoteDeposit> {
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
                let mut position = self.positions.read(commitment);
                assert(position.state == POS_OPEN, 'POSITION_NOT_OPEN');

                let launch = self.mark_failed_if_due(position.launch_id);
                assert(launch.state == LAUNCH_FAILED, 'NOT_FAILED');

                let amount = position.cash_in;
                assert(amount != 0, 'NOTHING_TO_REFUND');

                position.state = POS_CLOSED;
                self.positions.write(commitment, position);
                self.release_custody(launch.stake_token, amount);

                deposits
                    .append(
                        OpenNoteDeposit { note_id, token: launch.stake_token, amount },
                    );
                tokens.append(launch.stake_token);
                amounts.append(amount);

                self
                    .emit(
                        Refunded { commitment, launch_id: position.launch_id, amount },
                    );

                i += 1;
            };

            approve_batch_totals(pool, tokens.span(), amounts.span());

            deposits.span()
        }

        /// Flips a launch that missed its deadline without selling out, emitting `Failed` once.
        /// Returns the launch either way, so callers assert on the state they got back.
        fn mark_failed_if_due(ref self: ContractState, launch_id: u64) -> LaunchInfo {
            let mut launch = self.launches.read(launch_id);
            if is_failed_now(launch) && launch.state != LAUNCH_FAILED {
                launch.state = LAUNCH_FAILED;
                self.launches.write(launch_id, launch);
                self.emit(Failed { launch_id, sold: launch.sold, raised: launch.raised });
            }
            launch
        }

        fn redeemable_of(self: @ContractState, commitment: felt252) -> u128 {
            let position = self.positions.read(commitment);
            if position.state != POS_OPEN {
                return 0;
            }
            let launch = self.launches.read(position.launch_id);
            if launch.state != LAUNCH_GRADUATED {
                return 0;
            }
            position.units.into() * launch.unit_tokens
        }

        fn refundable_of(self: @ContractState, commitment: felt252) -> u128 {
            let position = self.positions.read(commitment);
            if position.state != POS_OPEN {
                return 0;
            }
            if !is_failed_now(self.launches.read(position.launch_id)) {
                return 0;
            }
            position.cash_in
        }

        /// Recognise `amount` of `token` as having genuinely arrived.
        ///
        /// The pool withdraws to an arbitrary address in phase 6 and invokes us in phase 7, so
        /// funding and calling are one transaction and we are handed no proof of payment — we
        /// look. Anything above the ledger is new money; anything else is a caller claiming credit
        /// for someone else's deposit, or for nothing at all.
        ///
        /// The same caveats as `Markets::take_custody` apply: the ledger is per token, so a launch
        /// staked in a token whose `balance_of` lies can only defraud people who bought THAT
        /// launch; and tokens sent here by hand read as unbooked funds, so nothing should ever be
        /// sent to this address directly.
        fn take_custody(ref self: ContractState, token: ContractAddress, amount: u128) {
            let held = IERC20Dispatcher { contract_address: token }
                .balance_of(get_contract_address());
            let booked = self.accounted.read(token);
            assert(held >= booked, 'CUSTODY_LEDGER_BROKEN');
            assert(held - booked >= amount.into(), 'FUNDS_NOT_RECEIVED');
            self.accounted.write(token, booked + amount.into());
        }

        /// Drop `amount` from the ledger as it is approved or transferred out.
        fn release_custody(ref self: ContractState, token: ContractAddress, amount: u128) {
            let booked = self.accounted.read(token);
            assert(booked >= amount.into(), 'CUSTODY_LEDGER_BROKEN');
            self.accounted.write(token, booked - amount.into());
        }
    }

    /// Cost of `units` units bought when `sold` are already gone, summed per epoch.
    ///
    /// Everyone inside an epoch pays `p0 + epoch·dp` per unit — the price does not move between
    /// the first unit of an epoch and its sixteenth. A buy that crosses a boundary is split at the
    /// boundary and each slice pays its own epoch's price, so crossing costs exactly what buying
    /// the two pieces separately would have cost. There is no division here, and therefore no
    /// rounding: `Σ costs == raised` to the base unit.
    ///
    /// Worked: `p0 = 100`, `dp = 10`, `sold = 14`, `units = 4`. Two units remain in epoch 0 at 100
    /// each; the next two are epoch 1 at 110 each. Total 420 — not `4 × 100` and not `4 × 110`.
    fn cost_of(p0: u128, dp: u128, sold: u32, units: u32) -> u128 {
        let mut cursor = sold;
        let mut remaining = units;
        let mut total: u128 = 0;

        while remaining != 0 {
            let epoch = cursor / UNITS_PER_EPOCH;
            let left_in_epoch = UNITS_PER_EPOCH - (cursor % UNITS_PER_EPOCH);
            let take = if remaining < left_in_epoch {
                remaining
            } else {
                left_in_epoch
            };

            let unit_price = p0 + dp * epoch.into();
            total += unit_price * take.into();

            cursor += take;
            remaining -= take;
        };

        total
    }

    fn total_units_of(launch: LaunchInfo) -> u32 {
        launch.epochs * UNITS_PER_EPOCH
    }

    fn total_supply_of(launch: LaunchInfo) -> u256 {
        let units: u128 = total_units_of(launch).into();
        let units_u256: u256 = units.into();
        units_u256 * launch.unit_tokens.into()
    }

    /// A launch is failed once its deadline has passed with units left unsold. Written as a pure
    /// predicate so the refund path and the read-only preview cannot disagree about it.
    fn is_failed_now(launch: LaunchInfo) -> bool {
        if launch.state == LAUNCH_FAILED {
            return true;
        }
        launch.state == LAUNCH_ACTIVE
            && get_block_timestamp() >= launch.deadline
            && launch.sold < total_units_of(launch)
    }

    /// Refuse at creation any curve whose completed raise or token supply would not fit u128.
    ///
    /// Checked once, here, in u256 — so every later addition in `cost_of` is provably safe and no
    /// buyer ever finds the ceiling by having their own transaction revert.
    ///
    /// The full raise is `Σ over epochs of 16·(p0 + e·dp)`, i.e.
    /// `16·(epochs·p0 + dp·epochs·(epochs−1)/2)`.
    fn assert_curve_fits(p0: u128, dp: u128, epochs: u32, unit_tokens: u128) {
        let epochs_u128: u128 = epochs.into();
        let epochs_u256: u256 = epochs_u128.into();
        let units_u128: u128 = UNITS_PER_EPOCH.into();
        let units_per_epoch: u256 = units_u128.into();

        let steps = epochs_u256 * (epochs_u256 - 1) / 2;
        let raise = units_per_epoch * (epochs_u256 * p0.into() + dp.into() * steps);
        let max_u128: u256 = 0xffffffffffffffffffffffffffffffff;
        assert(raise <= max_u128, 'RAISE_EXCEEDS_U128');

        let supply = units_per_epoch * epochs_u256 * unit_tokens.into();
        assert(supply != 0, 'ZERO_SUPPLY');
        assert(supply <= max_u128, 'SUPPLY_EXCEEDS_U128');
    }
}
