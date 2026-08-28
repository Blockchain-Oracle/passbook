//! The Governor under test: the accumulator that refuses a wrong tally (the Cairo half of
//! PROBE-2's cross-test — the SAME pinned points live in
//! `packages/protocol/test/governance-commitment.test.ts`), the replace rule, custody, invite
//! rolls, delegation locks, execution, and the void escape.
use core::poseidon::poseidon_hash_span;
use snforge_std::{
    declare, start_cheat_block_timestamp_global, ContractClassTrait, DeclareResultTrait,
};
use strk20_app::governance::{Governance, IGovernanceDispatcher, IGovernanceDispatcherTrait};
use strk20_app::mocks::{
    IMockERC20Dispatcher, IMockERC20DispatcherTrait, IMockPoolDispatcher, IMockPoolDispatcherTrait,
};

const NOW: u64 = 1_700_000_000;
const DAY: u64 = 86_400;

/// Two anonymous voter handles. In production only the pool can mint these; the mock's
/// `compute` lets the test be the pool.
const IDA: felt252 = 'identity-a';
const IDB: felt252 = 'identity-b';

// ── The pinned cross-test vectors (PROBE-2). Ballot A: weight 5, choice 1 (FOR), blinds
//    [7, 11]. Ballot B: weight 3, choice 0 (AGAINST), blinds [13, 17]. Sums [3, 5], blind
//    sums [20, 28]. `governance-commitment.test.ts` derives these; this file asserts the
//    contract accepts exactly them and nothing shifted. ─────────────────────────────────
const CA0_X: felt252 = 0x255dbef2704eb3b2473ce8ce869cc7373dabb6a4e625b1809837dac747a456f;
const CA0_Y: felt252 = 0x16ed49a136a06d31ef7b207f7b28041f8452b2ccf6716a173c4f24291d69734;
const CA1_X: felt252 = 0x2ccb2f29a988ccdfaeec39efc329a3bd8ee223350ab163706bc1ed3a6715fbf;
const CA1_Y: felt252 = 0x2ecf4bd76d3ae8924bca0cd5fac4a4c47ec9fd8816a5a6cb6a5400c50553458;
const CB0_X: felt252 = 0x10f527d992189074bf182b29728ce4472993011e2f57c7f913b2449952d1f34;
const CB0_Y: felt252 = 0x4159f756a1da986f6806b0fe262c36321214b01468ba6673ce4e2b54f10ca33;
const CB1_X: felt252 = 0x33a7c2b825892b3b1f7f4b4104ee865657f22bbefee8fe891ffb82273c54893;
const CB1_Y: felt252 = 0xc4f5aced7642ab10876ddf5fabcaeb66b7a66e538ef16250d0d0b1a9ff785e;
// A's re-vote: choice 0, same weight 5, blinds [19, 29].
const CA2_0_X: felt252 = 0x6e86f108ec11fefb8563343e919bc8e01ba5ba91ab881dec16fdd267cf32207;
const CA2_0_Y: felt252 = 0x4268064c36c72bb8c9c9756e36dafb4ef248ce5f3480367415dc32830d92933;
const CA2_1_X: felt252 = 0x1ac244111404b1411a9f3f9b3546fd2b3cc55d9e0c7edd43400d6bb4caa02f8;
const CA2_1_Y: felt252 = 0x1cbca44ea880978435c6faf81f8e73f3b8a88621ea929a03e0be15b7451a4cb;

#[derive(Copy, Drop)]
struct Ctx {
    gov: IGovernanceDispatcher,
    pool: IMockPoolDispatcher,
    token: IMockERC20Dispatcher,
}

fn setup() -> Ctx {
    let (token_addr, _) = declare("MockERC20")
        .unwrap()
        .contract_class()
        .deploy(@array![])
        .unwrap();
    let (pool_addr, _) = declare("MockPool").unwrap().contract_class().deploy(@array![]).unwrap();
    let (gov_addr, _) = declare("Governance")
        .unwrap()
        .contract_class()
        .deploy(@array![pool_addr.into()])
        .unwrap();
    start_cheat_block_timestamp_global(NOW);
    Ctx {
        gov: IGovernanceDispatcher { contract_address: gov_addr },
        pool: IMockPoolDispatcher { contract_address: pool_addr },
        token: IMockERC20Dispatcher { contract_address: token_addr },
    }
}

fn commit(secret: felt252) -> felt252 {
    poseidon_hash_span(array![secret].span())
}

/// The pool's phase-6 withdrawal: money lands BEFORE the invoke that claims it.
fn fund(ctx: Ctx, amount: u128) {
    ctx.token.mint(ctx.gov.contract_address, amount.into());
}

fn open_house(ctx: Ctx) -> u64 {
    ctx
        .gov
        .create_house(
            ctx.token.contract_address,
            8, // quorum: eight base units — the cross-test electorate exactly
            5000, // simple majority
            Governance::COUNT_WEIGHTED,
            Governance::MEMBERS_OPEN,
            0,
            "ipfs://house-metadata",
            commit('creator'),
        )
}

fn open_proposal(ctx: Ctx, house_id: u64) -> u64 {
    ctx
        .gov
        .propose(
            house_id,
            Governance::MODE_SECRET_UNTIL_CLOSE,
            2,
            NOW + DAY,
            'teller-pubkey',
            Governance::ACTION_TEXT,
            0,
            0.try_into().unwrap(),
            "ipfs://proposal-metadata",
        )
}

/// Ballot payload: `[house, proposal, new_total, reclaim_commitment, draw_pot, points…, sealed…]`.
fn ballot_payload(
    house_id: u64,
    proposal_id: u64,
    weight: u128,
    reclaim: felt252,
    c0x: felt252,
    c0y: felt252,
    c1x: felt252,
    c1y: felt252,
) -> Array<felt252> {
    array![
        house_id.into(),
        proposal_id.into(),
        weight.into(),
        reclaim,
        0,
        c0x,
        c0y,
        c1x,
        c1y,
        'sealed-blob',
    ]
}

fn cast_pinned_ballots(ctx: Ctx, house_id: u64, proposal_id: u64) {
    fund(ctx, 5);
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDA,
            Governance::OP_BALLOT,
            ballot_payload(house_id, proposal_id, 5, commit('escrow-a'), CA0_X, CA0_Y, CA1_X, CA1_Y)
                .span(),
        );
    fund(ctx, 3);
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDB,
            Governance::OP_BALLOT,
            ballot_payload(house_id, proposal_id, 3, commit('escrow-b'), CB0_X, CB0_Y, CB1_X, CB1_Y)
                .span(),
        );
}

// ── The equation ─────────────────────────────────────────────────────────────────────────

#[test]
fn the_pinned_tally_is_accepted_and_the_proposal_passes() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    cast_pinned_ballots(ctx, house_id, proposal_id);

    let live = ctx.gov.get_proposal(proposal_id);
    assert(live.total_weight == 8, 'LIVE_QUORUM_WRONG');
    assert(live.ballot_count == 2, 'BALLOT_COUNT_WRONG');

    start_cheat_block_timestamp_global(NOW + DAY + 1);
    ctx
        .gov
        .publish_tally(
            proposal_id, array![3, 5].span(), array![20, 28].span(), array![].span(),
        );

    let settled = ctx.gov.get_proposal(proposal_id);
    assert(settled.state == Governance::PROPOSAL_SUCCEEDED, 'SHOULD_PASS');
    assert(settled.tally_for == 5, 'FOR_WRONG');
    assert(settled.tally_against == 3, 'AGAINST_WRONG');
}

#[test]
#[should_panic(expected: 'TALLY_REJECTED')]
fn a_shifted_tally_is_unpublishable() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    cast_pinned_ballots(ctx, house_id, proposal_id);
    start_cheat_block_timestamp_global(NOW + DAY + 1);
    // One unit of weight moved between options; the blind sums still "work". The curve refuses.
    ctx
        .gov
        .publish_tally(
            proposal_id, array![4, 4].span(), array![20, 28].span(), array![].span(),
        );
}

#[test]
#[should_panic(expected: 'TALLY_REJECTED')]
fn a_tally_cannot_drop_a_lane() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    cast_pinned_ballots(ctx, house_id, proposal_id);
    start_cheat_block_timestamp_global(NOW + DAY + 1);
    // Dropping the FOR lane dies on that lane's own equation — a zeroed claim against a
    // non-identity accumulator — before conservation even runs. The `WEIGHT_MISMATCH` line
    // stays as the independent second lock behind it.
    ctx
        .gov
        .publish_tally(
            proposal_id, array![3, 0].span(), array![20, 0].span(), array![].span(),
        );
}

#[test]
fn a_revote_replaces_the_vector_and_the_tally_follows_the_final_ballot() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    cast_pinned_ballots(ctx, house_id, proposal_id);

    // A changes their mind: same weight, choice flips to AGAINST. Zero new value, no new secret.
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDA,
            Governance::OP_BALLOT,
            ballot_payload(house_id, proposal_id, 5, 0, CA2_0_X, CA2_0_Y, CA2_1_X, CA2_1_Y).span(),
        );

    let live = ctx.gov.get_proposal(proposal_id);
    assert(live.total_weight == 8, 'REPLACE_KEPT_TOTAL');
    assert(ctx.gov.get_ballot(proposal_id, IDA).seq == 2, 'SEQ_SHOULD_BE_2');

    start_cheat_block_timestamp_global(NOW + DAY + 1);
    // Sums now [8, 0]: blinds [19+13, 29+17] = [32, 46]. AGAINST carries everything.
    ctx
        .gov
        .publish_tally(
            proposal_id, array![8, 0].span(), array![32, 46].span(), array![].span(),
        );
    assert(
        ctx.gov.get_proposal(proposal_id).state == Governance::PROPOSAL_DEFEATED, 'SHOULD_FAIL',
    );
}

#[test]
#[should_panic(expected: 'FUNDS_NOT_RECEIVED')]
fn a_ballot_cannot_claim_weight_that_never_arrived() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    // No `fund` — the custody check is the authorisation, and it refuses.
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDA,
            Governance::OP_BALLOT,
            ballot_payload(house_id, proposal_id, 5, commit('escrow-a'), CA0_X, CA0_Y, CA1_X, CA1_Y)
                .span(),
        );
}

#[test]
#[should_panic(expected: 'ONLY_POOL')]
fn nobody_but_the_pool_can_mint_a_voter() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    // A direct call with a chosen identity_key — the exact thing pool-only forbids.
    ctx
        .gov
        .privacy_compute(
            IDA,
            Governance::OP_BALLOT,
            ballot_payload(house_id, proposal_id, 5, commit('x'), CA0_X, CA0_Y, CA1_X, CA1_Y)
                .span(),
        );
}

// ── Escrow: locked while open, bearer out after ──────────────────────────────────────────

#[test]
fn escrow_reclaims_after_close_to_whoever_knows_the_secret() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    cast_pinned_ballots(ctx, house_id, proposal_id);

    start_cheat_block_timestamp_global(NOW + DAY + 1);
    ctx
        .gov
        .publish_tally(
            proposal_id, array![3, 5].span(), array![20, 28].span(), array![].span(),
        );

    ctx
        .pool
        .invoke(
            ctx.gov.contract_address,
            Governance::OP_RECLAIM,
            array![1, 'escrow-a', 'note-1'].span(),
        );
    assert(ctx.pool.pulled(ctx.token.contract_address) == 5, 'RECLAIM_WRONG_AMOUNT');
    assert(
        ctx.gov.get_escrow(commit('escrow-a')).state == Governance::ESCROW_CLAIMED,
        'ESCROW_SHOULD_CLOSE',
    );
}

#[test]
#[should_panic(expected: 'VOTE_STILL_OPEN')]
fn escrow_is_locked_while_the_vote_is() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    cast_pinned_ballots(ctx, house_id, proposal_id);
    ctx
        .pool
        .invoke(
            ctx.gov.contract_address,
            Governance::OP_RECLAIM,
            array![1, 'escrow-a', 'note-1'].span(),
        );
}

#[test]
fn a_stranded_vote_voids_and_the_exit_opens() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    cast_pinned_ballots(ctx, house_id, proposal_id);

    // The Teller never shows up. Past VOID_AFTER anyone pulls the escape.
    start_cheat_block_timestamp_global(NOW + DAY + Governance::VOID_AFTER + 2);
    ctx.gov.void_proposal(proposal_id);
    ctx
        .pool
        .invoke(
            ctx.gov.contract_address,
            Governance::OP_RECLAIM,
            array![2, 'escrow-a', 'note-1', 'escrow-b', 'note-2'].span(),
        );
    assert(ctx.pool.pulled(ctx.token.contract_address) == 8, 'VOID_SHOULD_FREE_ALL');
}

// ── Delegation (§8) ──────────────────────────────────────────────────────────────────────

#[test]
fn delegation_grows_a_pot_the_delegate_votes_with_and_revocation_drains_it() {
    let ctx = setup();
    let house_id = open_house(ctx);

    fund(ctx, 4);
    ctx
        .pool
        .invoke(
            ctx.gov.contract_address,
            Governance::OP_DELEGATE,
            array![house_id.into(), IDA, 4, commit('holder-secret')].span(),
        );
    assert(ctx.gov.pot_of(IDA) == 4, 'POT_SHOULD_GROW');

    // Nothing bound: revocation is immediate.
    ctx
        .pool
        .invoke(
            ctx.gov.contract_address,
            Governance::OP_REVOKE,
            array![1, 'holder-secret', 'note-9'].span(),
        );
    assert(ctx.gov.pot_of(IDA) == 0, 'POT_SHOULD_DRAIN');
    assert(ctx.pool.pulled(ctx.token.contract_address) == 4, 'REVOKE_WRONG_AMOUNT');
}

#[test]
#[should_panic(expected: 'POT_BOUND_IN_A_VOTE')]
fn a_pot_drawn_into_an_open_ballot_cannot_be_revoked_out_from_under_it() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);

    fund(ctx, 4);
    ctx
        .pool
        .invoke(
            ctx.gov.contract_address,
            Governance::OP_DELEGATE,
            array![house_id.into(), IDA, 4, commit('holder-secret')].span(),
        );

    // The delegate votes drawing the pot: own weight 1 + pot 4 = 5, the pinned A vector.
    fund(ctx, 1);
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDA,
            Governance::OP_BALLOT,
            array![
                house_id.into(),
                proposal_id.into(),
                5,
                commit('own-escrow'),
                1, // draw_pot
                CA0_X,
                CA0_Y,
                CA1_X,
                CA1_Y,
                'sealed',
            ]
                .span(),
        );

    // The holder tries to leave mid-vote. The lock holds until the deadline.
    ctx
        .pool
        .invoke(
            ctx.gov.contract_address,
            Governance::OP_REVOKE,
            array![1, 'holder-secret', 'note-9'].span(),
        );
}

// ── Invite Houses and one-member-one-vote (§9.4–9.5) ─────────────────────────────────────

fn invite_house(ctx: Ctx) -> u64 {
    ctx
        .gov
        .create_house(
            ctx.token.contract_address,
            2, // quorum: two members' voices
            5000,
            Governance::COUNT_MEMBER,
            Governance::MEMBERS_INVITE,
            commit('invite-secret'),
            "ipfs://club",
            commit('creator'),
        )
}

#[test]
fn members_join_by_invite_and_vote_once_each_with_no_escrow() {
    let ctx = setup();
    let house_id = invite_house(ctx);

    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDA,
            Governance::OP_JOIN,
            array![house_id.into(), 'invite-secret'].span(),
        );
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDB,
            Governance::OP_JOIN,
            array![house_id.into(), 'invite-secret'].span(),
        );
    assert(ctx.gov.get_house(house_id).member_count == 2, 'ROLL_SHOULD_BE_2');

    let proposal_id = open_proposal(ctx, house_id);
    // Member ballots: weight fixed at 1, no reclaim commitment, no custody. The pinned vectors
    // for weight-1 ballots would differ; here the equation is exercised with the two live
    // handles voting the SAME pinned shapes is not possible — so this test stops at the public
    // half: both ballots land, each counts once.
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDA,
            Governance::OP_BALLOT,
            array![
                house_id.into(), proposal_id.into(), 1, 0, 0, CA0_X, CA0_Y, CA1_X, CA1_Y, 's',
            ]
                .span(),
        );
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDB,
            Governance::OP_BALLOT,
            array![
                house_id.into(), proposal_id.into(), 1, 0, 0, CB0_X, CB0_Y, CB1_X, CB1_Y, 's',
            ]
                .span(),
        );
    let live = ctx.gov.get_proposal(proposal_id);
    assert(live.total_weight == 2, 'ONE_EACH');
    assert(live.ballot_count == 2, 'TWO_BALLOTS');
}

#[test]
#[should_panic(expected: 'WRONG_INVITE')]
fn the_wrong_invite_does_not_open_the_door() {
    let ctx = setup();
    let house_id = invite_house(ctx);
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDA,
            Governance::OP_JOIN,
            array![house_id.into(), 'a-guess'].span(),
        );
}

#[test]
#[should_panic(expected: 'NOT_A_MEMBER')]
fn an_invite_house_votes_from_its_roll() {
    let ctx = setup();
    let house_id = invite_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    ctx
        .pool
        .compute(
            ctx.gov.contract_address,
            IDA,
            Governance::OP_BALLOT,
            array![
                house_id.into(), proposal_id.into(), 1, 0, 0, CA0_X, CA0_Y, CA1_X, CA1_Y, 's',
            ]
                .span(),
        );
}

// ── Treasury and execution (§7) ──────────────────────────────────────────────────────────

#[test]
fn a_passed_spend_pays_its_named_recipient_and_only_once() {
    let ctx = setup();
    let house_id = open_house(ctx);

    fund(ctx, 100);
    ctx
        .pool
        .invoke(
            ctx.gov.contract_address, Governance::OP_FUND, array![house_id.into(), 100].span(),
        );
    assert(ctx.gov.get_house(house_id).treasury == 100, 'TREASURY_SHOULD_FILL');

    let recipient: starknet::ContractAddress = 'grantee'.try_into().unwrap();
    let proposal_id = ctx
        .gov
        .propose(
            house_id,
            Governance::MODE_SECRET_UNTIL_CLOSE,
            2,
            NOW + DAY,
            'teller-pubkey',
            Governance::ACTION_SPEND,
            40,
            recipient,
            "ipfs://grant",
        );
    cast_pinned_ballots(ctx, house_id, proposal_id);

    start_cheat_block_timestamp_global(NOW + DAY + 1);
    ctx
        .gov
        .publish_tally(
            proposal_id, array![3, 5].span(), array![20, 28].span(), array![].span(),
        );
    ctx.gov.execute(proposal_id);

    assert(ctx.token.balance_of(recipient) == 40, 'GRANT_SHOULD_PAY');
    assert(ctx.gov.get_house(house_id).treasury == 60, 'TREASURY_SHOULD_DROP');
    assert(
        ctx.gov.get_proposal(proposal_id).state == Governance::PROPOSAL_EXECUTED, 'SHOULD_EXECUTE',
    );
}

#[test]
#[should_panic(expected: 'NOT_SUCCEEDED')]
fn execute_cannot_run_twice() {
    let ctx = setup();
    let house_id = open_house(ctx);
    fund(ctx, 100);
    ctx
        .pool
        .invoke(
            ctx.gov.contract_address, Governance::OP_FUND, array![house_id.into(), 100].span(),
        );
    let recipient: starknet::ContractAddress = 'grantee'.try_into().unwrap();
    let proposal_id = ctx
        .gov
        .propose(
            house_id,
            Governance::MODE_SECRET_UNTIL_CLOSE,
            2,
            NOW + DAY,
            'teller-pubkey',
            Governance::ACTION_SPEND,
            40,
            recipient,
            "ipfs://grant",
        );
    cast_pinned_ballots(ctx, house_id, proposal_id);
    start_cheat_block_timestamp_global(NOW + DAY + 1);
    ctx
        .gov
        .publish_tally(
            proposal_id, array![3, 5].span(), array![20, 28].span(), array![].span(),
        );
    ctx.gov.execute(proposal_id);
    ctx.gov.execute(proposal_id);
}

// ── Modes (§6) ───────────────────────────────────────────────────────────────────────────

#[test]
fn the_key_publishes_once_after_close_in_secret_until_close_mode() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = open_proposal(ctx, house_id);
    start_cheat_block_timestamp_global(NOW + DAY + 1);
    ctx.gov.publish_key(proposal_id, 'the-tally-key');
    assert(ctx.gov.get_proposal(proposal_id).published_key == 'the-tally-key', 'KEY_STORED');
}

#[test]
#[should_panic(expected: 'MODE_FORBIDS_KEY')]
fn permanently_private_never_publishes_a_key() {
    let ctx = setup();
    let house_id = open_house(ctx);
    let proposal_id = ctx
        .gov
        .propose(
            house_id,
            Governance::MODE_PERMANENT,
            2,
            NOW + DAY,
            'teller-pubkey',
            Governance::ACTION_TEXT,
            0,
            0.try_into().unwrap(),
            "ipfs://sensitive",
        );
    start_cheat_block_timestamp_global(NOW + DAY + 1);
    ctx.gov.publish_key(proposal_id, 'the-tally-key');
}
