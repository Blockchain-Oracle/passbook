//! The slice of Pragma's oracle ABI that settlement actually calls.
//!
//! Pragma is the ONLY live price oracle on Starknet mainnet — Pyth's Starknet feed sunsets
//! 26 Aug 2026 and Chainlink is Sepolia-only — so this interface is not one option among
//! several, it is the whole settlement surface.
//!
//! Only `get_data_median` is declared. A fuller ABI would be dead weight that still has to
//! be kept honest against a contract we do not control.
//!
//! ── THE WIRE SHAPE IS EVIDENCE, NOT RECOLLECTION ────────────────────────────────────────
//!
//! `evidence/day0-markets-launch-checks.json` records a live mainnet read at block 13955303:
//! address `0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b`, selector
//! `get_data_median`, calldata `[0x0, pair_id]`. That leading `0x0` is the `DataType`
//! variant index, which is why `SpotEntry` MUST stay the first variant below — reordering
//! this enum silently starts asking the oracle for a futures price. `test_markets.cairo`
//! pins the serialisation against those recorded bytes so the ordering cannot drift.

/// Which feed to read. Variant ORDER is the wire format — see the module note above.
#[derive(Copy, Drop, Serde)]
pub enum DataType {
    SpotEntry: felt252,
    FutureEntry: (felt252, u64),
    GenericEntry: felt252,
}

/// Pragma's aggregated answer.
///
/// `last_updated_timestamp` is the load-bearing field, not `price`. The Day-0 measurement
/// caught two reads eleven minutes apart returning the SAME timestamp, so a price that
/// looks current can be minutes old; `Markets::resolve` refuses to settle on it rather
/// than pretending otherwise. (veilcast resolves on the raw price and their own source
/// comment admits observing a nine-minute-stale read — that is the mistake this field exists
/// to avoid.)
#[derive(Copy, Drop, Serde)]
pub struct PragmaPricesResponse {
    pub price: u128,
    pub decimals: u32,
    pub last_updated_timestamp: u64,
    pub num_sources_aggregated: u32,
    pub expiration_timestamp: Option<u64>,
}

#[starknet::interface]
pub trait IPragmaABI<TContractState> {
    fn get_data_median(self: @TContractState, data_type: DataType) -> PragmaPricesResponse;
}
