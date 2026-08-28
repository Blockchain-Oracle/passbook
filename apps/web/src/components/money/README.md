# components/money

Pure presentational money components on shadcn primitives. Props only — no queries, no mutations
inside. Boundary wording comes from `@/app/boundary` + `BoundaryBadge`; amounts from
`@strk20/protocol/amount`. Unknown money renders `—`, never `0`.

| Component | File | Props |
|---|---|---|
| `TokenLogo` | asset-identity.tsx | `logoUri?, symbol, name?, size?` — image or name-seeded disc (8-pair warm palette, `accentFor(seed)`) |
| `AssetIdentity` | asset-identity.tsx | `symbol, name?, logoUri?, boundary: 'shielded'\|'public', size?: 'sm'\|'md'\|'lg', chip?` — logo + ShieldCheck overlay (solid lime ring) or dashed amber ring + `SHIELDED`/`PUBLIC` chip + tooltip |
| `Amount` | amount.tsx | `wei: bigint\|null\|undefined, decimals: number\|null, symbol?, confidence?: 'dated'\|'unknown', size?: 'sm'\|'md'\|'lg'\|'hero', short?` — tabular mono via `formatTokenAmount` |
| `MoneyField` | money-field.tsx | `value, onChange, symbol, decimals, available: bigint\|null, boundary, onMax?, problem?, shieldDoor?: { shortfallWei, onShield }, label?, autoFocus?` — Field + InputGroup; says which balance it spends |
| `ShieldedCard` / `PublicCard` | balance-cards.tsx | `rows: BalanceRow[] { token, symbol, name?, logoUri?, wei, decimals, confidence? }, headline?, actions?, loading?` |
| `CrossingRail` | balance-cards.tsx | `actions` — the dashed "Cross the boundary" gutter between the two cards |
| `ReviewSheet` | review-sheet.tsx | `open, onOpenChange, title, description?, boundary: BoundaryKind, rows: { label, value }[], disclosure?: Disclosure, onWayOut?, confirmLabel, onConfirm, busy?, blocker?, children?` — CTA is `aria-disabled`, never `disabled` |
| `OperationPipeline` | operation-pipeline.tsx | `stages, reached, failedAt?, replaced?, startedAt?, notes?` — rows from `progress.stepsFor`, proving clock via `provingLabel` |
| `Receipt` | receipt.tsx | `title?, transactionHash, rows, boundary, explorerUrl` — copy hash (no optional chaining on the write), explorer link |
| `ShieldDialog` | shield-dialog.tsx | `open, onOpenChange, token, symbol, decimals, logoUri?, publicWei, publicStrkWei, feeWei?, onShield(ask: ShieldAsk), busy?, problem?` — MoneyField in a Dialog, then ReviewSheet; the mutation is the caller's |
| `TokenPicker` | token-picker.tsx | `tokens: PickableToken[], value: address\|null, onChange(address), placeholder?, loading?` — Command inside Popover |

Wallet home triptych: `<ShieldedCard/> <CrossingRail actions={…}/> <PublicCard/>` in a `md:flex-row` container.

Privacy views live beside these in `components/privacy/`: `DisclosurePanelView({ panel, onWayOut? })` and
`VisibilityMatrixView({ context })`.
