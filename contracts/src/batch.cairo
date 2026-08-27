//! Batch discipline shared by every pool-facing contract here.
//!
//! Both `Markets` and `Launch` return `Span<OpenNoteDeposit>` to the privacy pool, and both hit
//! the same three traps. These helpers are the answer to them, in one place, so the answer cannot
//! drift between contracts:
//!
//! 1. **Approve the SUM once per token, never per deposit.** StarkWare's own
//!    shadow_account_anonymizer approves inside its deposit loop; because `approve` overwrites
//!    rather than accumulates, the second same-token pull in a batch finds too little allowance
//!    and the whole transaction reverts. Summing first is the entire reason batch settlement works
//!    here and does not there.
//! 2. **Exactly `n` deposits for `n` open notes.** The pool counts open notes created in the
//!    transaction and asserts none are left undeposited (`UNDEPOSITED_OPEN_NOTES`). Worse, its
//!    free `compile_actions` view CANNOT catch a mismatch — it no-ops the open-note emission — so
//!    a wrong count reverts on-chain *after* the 6 STRK fee is taken. Callers build one deposit
//!    per payload entry and the length assertion here is what keeps that honest.
//! 3. **Never a zero-amount deposit.** The pool reverts on one, so a batch carrying a losing
//!    ticket or an empty position burns the fee and settles nothing.
//!
//! The custody ledger itself (`take_custody` / `release_custody`) stays per-contract: it reads and
//! writes that contract's own storage, so it cannot be a free function, and at six lines apiece
//! the duplication is cheaper than a component.

use starknet::ContractAddress;
use strk20_app::erc20::{IERC20Dispatcher, IERC20DispatcherTrait};

/// Ceiling on entries in one batched op. The pool tops out at 100 open notes per invoke; this
/// sits under that and also bounds the quadratic duplicate-token scan below.
pub const MAX_BATCH: u32 = 64;

/// Reads and validates the `n` that opens a batched payload.
///
/// `stride` is the felts per entry, so the length check is exact rather than a lower bound — a
/// payload with a trailing felt is a client bug, and silently ignoring it settles the wrong batch.
/// The `MAX_BATCH` bound is asserted BEFORE `n * stride` so the multiplication cannot overflow.
pub fn read_batch_len(payload: Span<felt252>, stride: u32) -> u32 {
    assert(payload.len() >= 1, 'BAD_PAYLOAD');
    let n: u32 = (*payload.at(0)).try_into().expect('COUNT_NOT_U32');
    assert(n != 0, 'EMPTY_BATCH');
    assert(n <= MAX_BATCH, 'BATCH_TOO_LARGE');
    assert(payload.len() == 1 + n * stride, 'BAD_PAYLOAD');
    n
}

/// The batch total for the token at `i`, or 0 if an earlier index already covered it.
///
/// Callers read 0 as "skip", which is only safe because no individual amount in a batch is ever
/// zero — every call site asserts that before getting here.
///
/// Quadratic, deliberately. `MAX_BATCH` is 64 and a real ladder is three, so a scan is cheaper in
/// gas and far cheaper in review effort than carrying a dictionary through a loop.
pub fn first_occurrence_total(
    tokens: Span<ContractAddress>, amounts: Span<u128>, i: u32,
) -> u128 {
    let token = *tokens.at(i);

    let mut seen_earlier = false;
    let mut j: u32 = 0;
    while j != i {
        if *tokens.at(j) == token {
            seen_earlier = true;
        }
        j += 1;
    };
    if seen_earlier {
        return 0;
    }

    let mut total: u128 = 0;
    let mut m: u32 = i;
    let n = tokens.len();
    while m != n {
        if *tokens.at(m) == token {
            total += *amounts.at(m);
        }
        m += 1;
    };
    total
}

/// Approve `pool` ONCE per distinct token, for that token's whole batch total. See trap 1 above.
pub fn approve_batch_totals(
    pool: ContractAddress, tokens: Span<ContractAddress>, amounts: Span<u128>,
) {
    let n = tokens.len();
    let mut i: u32 = 0;
    while i != n {
        let total = first_occurrence_total(tokens, amounts, i);
        if total != 0 {
            IERC20Dispatcher { contract_address: *tokens.at(i) }.approve(pool, total.into());
        }
        i += 1;
    };
}

/// What the privacy pool calls, on whichever contract an action list names.
///
/// The pool invokes a FIXED selector — `privacy_invoke` — and deserialises whatever comes back
/// into `Span<OpenNoteDeposit>`. It has no idea whether it is talking to a prediction market or a
/// token launch, and neither does this interface; that is exactly why both contracts can share one
/// call shape and one test double.
#[starknet::interface]
pub trait IPrivacyInvoke<TContractState> {
    fn privacy_invoke(
        ref self: TContractState, op: felt252, payload: Span<felt252>,
    ) -> Span<strk20_app::pool_types::OpenNoteDeposit>;
}
