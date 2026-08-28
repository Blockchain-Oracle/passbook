# Passbook Studio rebuild status

This is the maintained implementation ledger for the authenticated Passbook application. It
supersedes the dated prototype-gap report as the place to check current product status. Historical
handoffs and prototype files remain evidence, not runtime authority.

Authority remains, in order: `Passbook Studio.dc.html` for visual language, `Passbook.dc.html` for
the wider screen inventory, deployed protocol behavior for factual and security claims, and the
existing application architecture for implementation constraints.

## Shipped in the current working tree

| Area | Current result |
|---|---|
| Shell | Studio top-pill navigation on desktop, mobile header and bottom navigation, Houses on mobile, and seven-surface copy. `/` still redirects to `/wallet`; public Landing and Docs are unchanged. |
| Transaction lifecycle | One `Prepare → Prove → Sign & broadcast → Pool accepts → Confirm` model, shared progress/receipt anatomy, operation identity, origin, submitter, stage timing, transaction hash and explorer URL. In-flight dialogs cannot be dismissed. Post-broadcast uncertainty points to Activity before retry. |
| Activity | Operations are recorded at start and updated through submission, confirmation, failure or unknown confirmation. The global pipeline survives route changes and reloads. Successful writes refresh the relevant balances and chain records. |
| Onboarding | A global route gate prevents deep-link bypass. It preserves the original destination and runs optional name/public-claim choice, compact encrypted-file plus separate-code recovery, automatic one-time drip/deploy/register/confirm ladder, receipt and explicit entry into Passbook. |
| Account safety | The embedded address is copyable and described as plaintext browser storage until a password is set. Lock wording is limited to this browser session. Existing password, recovery export/import, account switching, avatar, theme and sound controls remain. |
| Settings | Studio-shaped account/network card exposes the embedded account, connected public-funding wallet, chain id, pool and recorded app contracts with Voyager links. Governance is visibly read-only on the currently recorded class. |
| Wallet | Shielded holdings remain the only large headline balance. Public STRK and USDC rows always render loading, zero, loaded or failed states. Public funding and shielding are separate doors. Receive supports address/QR and request-link modes. |
| Shielding | Typed request/plan/result models validate token, amount, public balance, pool health and STRK fees; compile deposit plus encrypted note to self; compose token-specific allowances; assert the SDK action span/class suffix; wait for confirmation and maturity; then refresh both balance domains and Activity. |
| Connected funding | A connected Starknet wallet can publicly fund the embedded address in STRK or USDC. The public boundary is shown before signing; the connected wallet never becomes Passbook identity and never performs shielding. |
| Pay links | Typed `/pay/$recipient?asset=STRK|USDC&amount=<decimal>&note=<text>` parsing, legacy empty-query compatibility, address or `@name` resolution, onboarding preservation, token refusal and a minimal branded handoff into Send. |
| Directory | One grammar—lowercase letters, numbers, underscores and hyphens, 3–20 characters—is shared by protocol parsing, relayer validation, claims, search, chat, profiles and pay links. |
| Markets | Real Pragma state and the existing stream/fallback/staleness model remain. Live bearer-position reads expose cash-out before deadline and claim/refund after resolution or voiding, with the shared transaction machine and receipts. No fake price movement is introduced. |
| Launch | Live buyer positions expose redeem after graduation and refund after failure or a missed deadline. Create/buy and settlement copy distinguishes a bearer commitment from the still-public transaction submitter. |
| Houses records | Board and record reads, House parameters, proposal state, activity, provenance and verification remain live. Invite secrets remain one-time browser-held material. Existing records remain readable while unsafe writes are gated. |
| Privacy language | Chat makes no end-to-end-encryption claim. Markets, Launch and Houses say only that their contract records use handles or bearer commitments instead of account addresses; the public submitter and relayer metadata remain disclosed. |
| Governance source | `publish_key` is bound to the proposal tally key and duplicate/mismatched exclusions are rejected before subtraction, with Cairo negative tests. |
| Accessibility | Visible focus treatment is restored, unjustified password autofocus is removed, onboarding traps focus and makes the underlying route inert, and the deterministic UI audit has no error-level findings. |

## Deliberately retained

| Item | Reason |
|---|---|
| Strong recovery ceremony | The encrypted file and separate recovery code are both required. Losing either permanently orphans the embedded account. |
| Shielded-only headline | Public and shielded balances describe different privacy states and are never added into a false total. |
| Outbound-only bridge claim | Broadcast and source confirmation can be observed; destination arrival is not claimed unless a destination read proves it. |
| Real empty/error states | Missing data, stale oracle reads, absent contracts and failed RPC calls remain named states rather than fixtures. |
| Existing Vitest approach | No jsdom or React Testing Library dependency is added. Pure models carry the new behavior tests. |

## Blocked by deployment

The Governance source is corrected, but the recorded mainnet Governance address still points to the
older class that predates the tally-key and exclusion fixes. All Houses writes therefore fail
closed: create, join, fund, propose, vote, delegate, reclaim, revoke, tally publication, key
publication, execute and void. Existing Houses and proposal records remain readable.

Re-enabling those doors requires a separately authorized corrected deployment and updated verified
evidence. This rebuild does not deploy, upgrade, rotate secrets or spend funds.

## Out of scope

- Public Landing and Docs redesign.
- Mainnet or testnet deployment, contract upgrade, funded transaction or faucet execution during
  review.
- Database migration or a new public service.
- Destructive removal of historical prototypes, handoffs or evidence.

## Verification gates

The release gate is:

```text
pnpm test
pnpm run typecheck
pnpm run build:web
scarb test
21st review apps/web --json
```

Runtime review covers the global onboarding modal and a navigation/overflow sweep of every
top-level authenticated route plus representative record, pay, profile and chat routes at
1440×900, 768×1024 and 390×844. It does not submit the faucet/deployment ladder. Transaction-producing
states are verified through their pure models, unit suites and guarded production build unless a
separately authorized funded runtime session is provided.
