# Passbook — rules for every Claude session

## Research first, with Context7
- **Before writing any code that touches a library, framework, SDK, CLI or build tool, look it up
  with the Context7 MCP tools** (`mcp__plugin_context7_context7__resolve-library-id` then
  `query-docs`). This applies to Vite, Tailwind, shadcn, TanStack Router/Query, Hono, zod, starknet.js,
  the privacy SDK — everything. Never answer an API question from memory. Reading the library's own
  `.d.ts`/README in `node_modules` is also acceptable evidence; guessing is not.
- Use the documented path. If a library has a plugin, option, CLI or recipe for the job, use it.
  Never write a custom script, build plugin, gate, generator or wrapper to do what a documented
  option does. There is no `scripts/` directory and there will not be one.

## Build rules
- **shadcn/ui for every UI primitive** (`pnpm dlx shadcn@latest add -c apps/web <name>`; Base UI
  variant — `render={<X/>}`, never `asChild`). lucide-react for icons. Never an emoji in UI.
- **TanStack Query for every chain/relayer read and write** in the app; no hand-rolled fetch+poll.
- **The privacy SDK builder composes transactions.** Never re-implement note selection, surplus,
  channels, open notes or invoke calldata.
- **Every file ≤ 400 lines** (aim ≤ 300). Split by responsibility.
- Short "why" comments only. No essays, no provenance notes.
- Copy is honest: never `end-to-end`, `e2ee`, `only you can`, `zero-knowledge`, `watch-only`,
  `view-only`, `read-only`, `your address never appears`, `amounts are private`,
  `unlinkable across surfaces` (`forbidden-claims.ts`).
- Two balances, never summed: shielded (pool notes) and public (ERC-20). Unknown renders as `—`, never `0`.

## Money rules (verified on mainnet — do not relearn them for 6 STRK each)
- `proofFacts` + `proof` ride as v3 transaction DETAILS, both or neither; explicit `resourceBounds` on
  value-moving proven txs (fee estimation cannot see the proof and reverts).
- `STRK.approve(pool, approveCeiling(liveFee))` in the same multicall as `apply_actions`; the fee is
  read at call time (`get_fee_amount`), never a constant.
- Prove at `latest − 10`; wait ≥ 10 blocks after a deploy or top-up before proving.
- One pipeline at a time per account; `confirmation-unknown` means the tx may have landed.
- Bearer position secrets are stored before the transaction is submitted.
- `SetViewingKey` is single-use; registration needs a deployed account.
- Bridge is a private-pool EXIT (shielded USDC → public address via CCTP), never inbound.

## Workflow
- Tests are not a deliverable. Verify with typecheck, build, live reads, and the real app.
- Commit only when Abu says so. Never push.
- `nvm use 24` before anything. `pnpm`, never `npm`.
