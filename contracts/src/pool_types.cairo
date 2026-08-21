//! Types shared with the StarkWare privacy pool.
//!
//! `OpenNoteDeposit` is transcribed VERBATIM (including field order) from the
//! sponsor's source at the tag deployed to mainnet. Do not edit it from memory or
//! from documentation: the pool deserializes an invoked contract's return data
//! directly into `Span<OpenNoteDeposit>`, so a wrong field layout reverts on
//! mainnet and a reverted deployment costs real STRK.
//!
//! Source:   https://github.com/starkware-libs/starknet-privacy
//! Tag:      CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08
//! Commit:   74841caf0466d122117945e28ed983e2864c8fc1
//! Path:     packages/privacy/src/objects.cairo (lines 102-111)

use starknet::ContractAddress;

/// Input for depositing to an open note (returned by invoked contract).
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    /// The identifier of the open note to deposit to.
    pub note_id: felt252,
    /// The ERC20 token contract to deposit.
    pub token: ContractAddress,
    /// The amount of tokens to deposit.
    pub amount: u128,
}
