//
// Leaving the pool for another chain (RFP idea 22, scoped to OUTBOUND only).
//
// ZERO CAIRO: `OutboundAnonymizer` is the sponsor's own contract, live on mainnet with 432+
// successful burns. The pool reaches it through `InvokeExternal`, the same mechanism a swap
// already proved, so a crossing is a swap with one leg removed — withdraw to the helper, invoke
// it. We did not write, audit or deploy the Cairo that burns the USDC, and the product says so.
//
// This is the barrel. The pieces are browser-safe leaves with no `starknet` import:
//   - `bridge-calldata.ts`     the helper's pinned addresses and the eight `BuyParams` felts
//   - `bridge-destinations.ts` where a crossing can land, and address parsing
//   - `bridge-fee.ts`          Circle's live fee quote and what is delivered
//
export * from './bridge-calldata.js'
export * from './bridge-destinations.js'
export * from './bridge-fee.js'
