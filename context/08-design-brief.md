# STRK20 Design Quality Brief

Sources: Uniswap/interface `packages/ui/src` (source-read + live-verified against app.uniswap.org's shipped CSS), 0xbow Privacy Pools (full repo read), Railway wallet (full repo read), Signal Desktop stylesheets, live censuses of Hyperliquid and Polymarket. Every value is tagged: **[UNI]** Uniswap verbatim, **[PP]** Privacy Pools, **[RW]** Railway, **[SIG]** Signal, **[ADAPTED]** modified for this product, **[PROPOSAL]** invented here — no prior art, treat as design direction not evidence.

---

## 1. The feel in one paragraph

This app should feel like a ledger operated by a calm machine: dense, quiet, exact. Almost nothing is colored, so the two moments that matter — "this action leaks" and "this note is now spendable" — are the loudest things the user ever sees. The chrome is instant (80–200ms, transform/opacity only) precisely because the protocol is slow; the user must always be able to distinguish "the app is fast and the chain is working" from "something is stuck." Numbers never jitter, layouts never jump, waits are named in the domain's own words, and every privacy statement is specific enough to be checked. It must never feel like: a marketing site, a casino, a template (gradient heroes, glass cards, glowing shadows), or an app that shouts warnings so often that its one real red means nothing.

---

## 2. The token sheet

### 2.1 Surfaces — [UNI], verified in source and shipped CSS

Only surface1 and surface2 are solid; 3+ are alpha so nesting composites correctly at any depth. Do not invent a sixth surface.

| Token | Light | Dark |
|---|---|---|
| surface1 | `#FFFFFF` | `#131313` |
| surface1Hovered | `#FCFCFC` | `#1A1A1A` |
| surface2 | `#F9F9F9` | `#1F1F1F` |
| surface2Hovered | `#F2F2F2` | `#242424` |
| surface3 (alpha) | `rgba(19,19,19,0.08)` | `rgba(255,255,255,0.12)` |
| surface3Hovered | `rgba(19,19,19,0.10)` | `rgba(255,255,255,0.16)` |
| surface3Solid | `#F2F2F2` | `#393939` |
| surface4 | `rgba(255,255,255,0.64)` | `rgba(255,255,255,0.20)` |
| surface5 | `rgba(0,0,0,0.04)` | `rgba(0,0,0,0.04)` |
| scrim | `rgba(0,0,0,0.60)` rendered at opacity 0.5 → effective ~30% black | same |

**[ADAPTED]** Consider a 2–4 point cool hue shift on the dark surfaces (Hyperliquid's `#0F1A1F`/`#1B2429`/`#273035` are blue-green, not neutral — verified live). A cool near-black reads cryptographic. If you shift, shift the entire text ramp with it. Decide once, hold everywhere.

### 2.2 Text — [UNI]. Three levels, one ink, alpha only. Never a second grey hex.

| Token | Light | Dark |
|---|---|---|
| neutral1 | `#131313` (never `#000`) | `#FFFFFF` |
| neutral1Hovered | `rgba(19,19,19,0.83)` | `rgba(255,255,255,0.85)` |
| neutral2 | `rgba(19,19,19,0.63)` | `rgba(255,255,255,0.65)` |
| neutral2Hovered | `rgba(19,19,19,0.83)` (= neutral1Hovered — hover promotes secondary text) | `rgba(255,255,255,0.85)` |
| neutral3 | `rgba(19,19,19,0.35)` | `rgba(255,255,255,0.38)` |
| neutral3Hovered | `rgba(19,19,19,0.55)` | `rgba(255,255,255,0.58)` |

Semantic mapping **[ADAPTED]**: neutral1 = confirmed and private; neutral2 = context, disclosure copy, fiat equivalents; neutral3 = not yet real (immature notes, timestamps, block counts, indicative values). This ladder IS the app's confidence encoding — a value's color travels with the value in one object (Uniswap's `PanelTextDisplay` pattern, verified).

### 2.3 Semantic colors — [UNI]. Each ships as a triple: solid / hovered / low-alpha tint. Hand-picked per mode — these are the ONLY colors that flip between themes (the accent does not).

| | Light solid / tint | Dark solid / tint |
|---|---|---|
| success | `#0C8911` / `rgba(15,194,68,0.06)` | `#21C95E` / `rgba(33,201,94,0.12)` |
| warning | `#996F01` / `rgba(255,191,23,0.10)` | `#FFBF17` / `rgba(255,191,23,0.08)` |
| critical | `#E10F0F` / `rgba(255,0,0,0.05)` | `#FF593C` / `rgba(255,89,60,0.12)` |

Hovered: success `#06742C`/`#15863C`, warning `#7A5801`/`#FFDD0D`, critical `#BF0D0D`/`#FF401F`. Note the tints use a **brighter, more saturated hue** than the foreground (e.g. light success text is forest `#0C8911` but its tint base is `rgb(15,194,68)`) — a dark hue at 6% alpha composites to mud. Copy that trick.

**Severity discipline** (verified in Uniswap's warning system): five levels, only two ever colored. `None` and `Low` render pure neutral; `Blocked` — the most severe — renders **grey** (`neutral1` on `surface3`), not red. Insufficient balance, the most common error, has zero color: it just disables and relabels the button. Model severity and blocking as two independent enums with gap-numbered values: `None=0, Low=1, Medium=5, High=10, Blocked=11` × `{None, DisableReview, WarnBeforeSubmit, DisableSubmit}`. **[ADAPTED]** for privacy: critical = "this deanonymizes you / proof expired"; warning = "anonymity set too small"; everything routine = neutral2. **There is no pending color anywhere.** Waiting gets motion and neutral fills, never amber — otherwise this app, which is 90% waiting, becomes an amber app.

### 2.4 Accent — structure [UNI], hue is yours

One accent, **identical in light and dark** (Uniswap's `#FF37C7` is; verified). Ship it as: `accent1`, `accent1Hovered`, `accent2` = accent at 8% alpha, `accent2Hovered` at 12%, `accent2Solid` (opaque tint per mode), `accent3` = alias of ink (`#222222` light / `#FFFFFF` dark — most CTAs are **ink, not brand**; brand is reserved for the one branded moment per screen). Do not copy the pink. Pick the hue in Q1 of section 8.

### 2.5 Type — [UNI] structure, license your own face

One grotesque, **two weights only**, at variable-axis positions **485 and 535** (Uniswap ships these on web, verified live on 2,781 and 229 elements; 400/500 is their native-app pair). Web scale (rem @16px, line heights snapped to the 4px grid):

```
heading1  52/50  -0.02em     body1  18/24        buttonLabel1  18/24 @535
heading2  36/40  -0.01em     body2  16/24        buttonLabel2  16/24 @535
heading3  24/28  -0.005em    body3  14/20        buttonLabel3  14/20 @535
subheading1 18/24            body4  12/16        buttonLabel4  12/16 @535
subheading2 16/24            mono   12/16
```

Rules: negative tracking at 24px and above only, zero below. `text-wrap: pretty` on body, `balance` on headings, antialiased — one global block **[UNI]**. Mono is the system stack (`ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, "Cascadia Mono", "Segoe UI Mono", "Roboto Mono", "Courier New", monospace`) at 12/16, used ONLY for hashes, commitments, nullifiers, addresses — **never balances**. Balances are the sans at heading sizes with `tabular-nums`. Put `font-variant-numeric: tabular-nums` on the base numeric text primitive and opt OUT for prose (Hyperliquid: 436 elements tabular; the amateur tell is zero). Cap accessibility scaling per role: ×1.2 headings/buttons/mono, ×1.4 body **[UNI]**.

### 2.6 Spacing, radii, icons — [UNI]

- Spacing: `0, 1, 2, 4, 6, 8, 12, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60`. No 10, 14, 44, 52, 56, 64. 1 and 2 exist for hairlines only.
- Padding vocabulary: `6, 8, 12, 16, 20, 24, 36`. Gap vocabulary: `4, 8, 12, 16, 20, 24, 32, 36`. **Honesty note:** Uniswap declares these subsets but does NOT enforce them (verified — they're merged aliases). Enforce yours with a lint rule; the discipline is the value.
- Radii: `0, 4, 6, 8, 12, 16, 20, 24, 32, 9999`. Radius ladders with component size, never per-type: small controls r12, medium r16, large r20; every card, sheet, and modal r16; badges r6; pills and grab handles full. Text inputs: r12 with medium padding (16/12) — verified.
- Icons: `8–100` closed ramp (12, 14, 16, 18, 20, 24, 28…); icon size is a token, not a magic number.
- Borders OFF by default (transparent at theme level); every visible border is a decision. Every interactive frame carries `borderWidth: 1` transparent so variant switches never shift the box by 2px **[UNI, verbatim source comment]**.

### 2.7 Elevation — [UNI], exactly three shadows

Light mode elevation = fill step + 1px surface3 border; shadows are nearly invisible. Dark mode shadows do 4–12× more work because `#1F1F1F` on `#131313` is too weak alone.

```
short  L: 0 1px 6px 2px rgba(0,0,0,0.03), 0 1px 2px 0 rgba(0,0,0,0.02)
       D: 0 1px 3px 0 rgba(0,0,0,0.12),  0 1px 2px 0 rgba(0,0,0,0.24)
medium L: 0 6px 12px -3px rgba(19,19,19,0.04), 0 2px 5px -2px rgba(19,19,19,0.03)
       D: 0 10px 15px -3px rgba(19,19,19,0.54), 0 4px 6px -2px rgba(19,19,19,0.40)
large  L: 0 10px 20px -5px rgba(19,19,19,0.05), 0 4px 12px -3px rgba(19,19,19,0.04)
       D: 0 16px 24px -6px rgba(0,0,0,0.60),   0 8px 12px -4px rgba(0,0,0,0.48)
```

Three depth levels in the whole app: flat, short (tappable card), medium (sheet/modal). `large` reserved for the proof overlay if it ever floats. Modal geometry **[UNI]**: maxWidth 420, width `calc(100vw − 32px)`, maxHeight `calc(100vh − 32px)`, margin 16, r16, 1px surface3 border, px24 py16; becomes a bottom sheet at ≤640px (same component, top corners r16, grab handle 4×32 full-radius neutral3). Breakpoints max-width: 360/380/450/640/768/1024/1280/1536.

---

## 3. The component bar

**Amount input** (swap, bridge, bet size, deposit) — reference: Uniswap `CurrencyInputPanel`, all verified.
- Font shrinks continuously 36px → floor 24px, lineHeight = size × 1.2, using a per-glyph width table (`'1': 0.62`, `'.': 0.52`, biased slightly wide so long decimals never overflow — source comment). Essential for 18-decimal amounts.
- Row reserves height before anything is typed (minHeight 60 = 24 + 36); the balance line stays mounted at opacity 0 to hold layout. Nothing jumps, ever.
- Focus **inverts the container**: unfocused `surface2` + transparent border → focused `surface1` + `surface3` border, always 1px, r20. No glow, no ring, zero layout shift. Color snaps; only transform/opacity get the 80ms.
- Insufficient balance = three elements turn critical (typed number, symbol, balance line). No banner, no icon, no reflow. The 300ms ±5px shake is reserved for pressing something disabled — an invisible overlay catches the tap and refuses audibly. **[ADAPTED]** shake also for: submit during proving, submit after 450-block expiry.
- Value + confidence travel as one object: `{ value, color }`. Indicative → neutral3, confirmed → neutral1. Refetch of an *unchanged* value pulses the existing number (opacity 1 → 0.4 → 1, 800ms ease-in-out infinite) — never skeleton a number that's about to come back the same.

**Asset/note selector** — reference: Uniswap `OptionItem`.
- One row anatomy for every list in the app (tokens, notes, contacts, markets, launches, routes): `image | title (+suffix, +badge) | subtitle | tag | right`. Outer px12, inner p8, r16, gap12 logo↔text. Title body1 neutral1 ellipsis; subtitle body3 (symbol neutral2, address/count neutral3). Disabled = opacity 0.5.
- Hover background (`surface1Hovered`) on the inner rounded flex, and **mouse hover and keyboard arrow-focus are the same state variable**. Enter activates the focused row while the search field still holds focus.
- Search debounce 200ms from one shared constant. Empty query renders suggested content, never blank. No results = a left-aligned neutral3 sentence with the user's query inlined in neutral1 — no card, no illustration. **[ADAPTED]** sections your selector needs that Uniswap's doesn't: "In your shielded pool" / "Public balance (will reveal)" — the public section header gets the warning tint, not just a label. Put the note status chip (§5) in the badge slot.

**Review screen** — reference: `TransactionAmountsReview` + `TransactionDetails`.
- Deliberately anticlimactic: amounts at heading3 neutral1, fiat at body2 neutral2, 40px asset logo, the two sides joined only by a 20px neutral3 arrow. No card, no border, no emphasis on the primary number. The ONLY loud element on this screen is the disclosure block (§5) — that's where the judge's eye goes.
- Dim ladder in two lines: amount = indicative ? neutral2 : stale ? neutral3 : neutral1. A number about to be signed visibly loses authority the moment it goes stale.
- Terms changed under the user (quote moved, **proof expired**, anonymity set shrank below what was shown) → the bordered inline re-consent row, not a modal: r16, 1px surface3 border, pl12 pr8 py8; label body3 neutral2, new value neutral1, signed delta `(+1.24%)` in neutral2, small secondary Accept button. Verbatim shape for "Proof expired at block N — regenerate."
- Secondary detail (relayer identity, fee split, exact on-chain-visible fields) collapses behind a centered label between two hairline separators; expansion animates opacity only, 100ms. Fee/cost rows: body3, label neutral2 left, value neutral1 right — and steal Privacy Pools' tooltip that shows the **arithmetic** (`Formula: 8 bps of 1.2 ETH · Calculation: 8/10000 × 1.2 = …`), `cursor: help` **[PP]**.
- Severity routes to the CTA itself: High → critical button, Medium → warning button. The thing the thumb is on carries the risk.

**Progress indicator** — reference: `StepRowSkeleton`/`ProgressIndicator`, fully specified in §6.

**Activity row** — reference: `TransactionSummaryLayout`.
- Row: surface1, r16, py8, gap12, 40px leading icon, hover surface2. Pending vs confirmed is a **slot swap at the right edge**: confirmed shows the timestamp (body3 neutral3); pending shows a 20px accent spinner; queued/maturing shows a **static** neutral3 ring — a still ring means "the clock runs, nothing is stuck." No pending section, no colored left border, no pulsing background; when a note matures the row gains a timestamp, it does not reflow. **[ADAPTED]** maturing rows add a body3 caption "6 of 10 blocks."
- Failed = **amber** triangle + inline accent "Retry" text link in the row. Red is reserved for the genuinely irreversible. A recoverable failure that renders red makes the demo look broken.
- Loading list: rows fade down `opacity = (length − i) / length`.

**Chat thread** — reference: Signal, all values source-verified. Copy the geometry literally: bubble radius 18px, padding 8px/12px, gap between runs 6px collapsing to **1px** within a run, and the corner facing the previous message in a run flattens to 4px. Timestamps 9/11px. Jump-to-message highlight: 1.2s `cubic-bezier(0.17, 0.17, 0, 1)` — the one long curve in the app, meaning "here is the thing you were looking for" (also correct for "your note matured while you were scrolled away"). Failed send: 0.2s linear shake. Key change = full centered trust-boundary modal (§5), never a corner lock icon. Spend the invention budget on the crypto-native part: an inline note-transfer bubble and a per-conversation "what the relayer sees" line.

**Market card / launch card** — no direct Uniswap equivalent; composed from verified parts.
- Card: surface1 (or surface2 on surface1), r16, 1px surface3 border, p16, shadow `short` at most.
- Per-item identity color (market artwork, launched-token brand) is confined to **one zone** — the chart/graphic — as a solid + one 0.2-alpha companion. It never touches CTAs, semantics, or the privacy grammar. Ship Uniswap's contrast machinery with it: extraction guard (reject #000/#FFF, contrast ≥ threshold vs surface, grey → neutral1), `getContrastPassingTextColor` (white if ≥3:1 else black), a deterministic 8-color fallback for logoless items, and a hand-curated override table for your top assets **[UNI, all source-verified]**.
- Odds/price delta: one function, zero is neutral2, direction carried by a 16px caret with magnitude printed unsigned — survives colorblindness. Odds format: whole-or-2-decimals ("5%", never "5.00%").
- Numbers: tabular; pot sizes compact via `Intl notation:'compact'` pinned to 2 decimals; caps as literal strings (`>999T`), floors as `<0.001`; sub-cent dust as subscript notation (`0.0₅1024`), never a wall of zeros and **never a false "0"** — a privacy pool showing dust as zero is overclaiming.

**Buttons** (all surfaces) — reference: Uniswap's 4 variants × 4 emphases × 5 sizes matrix.
- Sizes bind padding AND radius: small px12 py8 r12 gap8 · medium px16 py12 r16 gap8 · large px20 py16 r20 gap12. Primary pipeline actions are `large`.
- Default primary is **ink** (`accent3`), not brand. Brand for the one branded moment. Critical/warning variants exist with matching tint secondaries.
- Disabled = flat `surface2` + neutral2 label, all 16 combos collapse to it. **But prefer two better states:** (a) emphasis downgrade within the family (branded/primary → branded/secondary: accent at 8% alpha, label stays accent — "your action, not ready yet"); (b) `onDisabledPress` — looks disabled, stays interactive, tapping it explains WHY (proof generating / set too small / note immature / expired / relayer down — each reason gets its own sentence + the shake). Verified pattern; the single best affordance for an app where the CTA is blocked for five different legitimate reasons.
- Focus: 1px solid outline at 2px offset, colored by the variant's own **Hovered** token (critical button focuses red — the danger reads via keyboard), plus scale-down to 0.98 × 0.905 (Y squashes more; press shares the same 0.98). Small buttons use 0.93/0.93 so the ring doesn't spill. Judges tab through demos; this is cheap and visible.
- Hover: paired `Hovered` tokens for everything designed; `brightness()` filter only for runtime colors (copy the function `isDark ? 1+d : 1−d`, NOT Uniswap's call site — it has a verified bug that brightens in light mode).
- Loading: label stays, spinner joins it, button goes to the disabled look; label↔spinner crossfades at 200ms with 4px translate + 4px blur, spinner delayed 50ms so they never overlap. The same idiom crossfades spinner→success check (`.button-state-*`, verified) — use it for each pipeline step completing.
- Touch targets: compute hitSlop at runtime to 44/48px minimums rather than padding the visual — lets info "i" buttons and copy-address affordances stay visually tiny.

---

## 4. Motion

Named palette — forbid raw ms in component code (Uniswap doesn't enforce this mechanically; you should, via lint):

```
simple        80ms  ease-in-out              (focus inversion, micro-state)
fastExit      80ms  cubic-bezier(0.17,0.67,0.45,1)
fast         100ms  cubic-bezier(0.17,0.67,0.45,1)   (buttons, modal enter)
fastExitHeavy 100ms same curve                       (large-surface exit)
fastHeavy    120ms  same curve                       (large-surface enter)
stiff        150ms  same curve
quicker      180ms  cubic-bezier(0.25,0.46,0.45,0.94) (copy crossfades)
quick        200ms  same curve                        (privacy-state changes, warnings)
quickLong    300ms  same curve                        (backdrop, spatial moves)
lazy         500ms  cubic-bezier(0.25,0.1,0.25,1)     (sheet scrim)
attention   1200ms  cubic-bezier(0.17,0.17,0,1)  [SIG] (jump-to / "it matured")
```

Rules, all source-verified:
- **Exits always faster than entrances** (100 in / 80 out; 120 / 100), and exit travel is shorter (enter y:12, exit y:10; heavy 20/10). A closing sheet is not the opening played backwards.
- Modals move 12px, nothing slides across the screen. Backdrop 300ms in / 200ms out.
- Stagger is a token: 40ms steps (0/40/80/120/160/200/240 at 200ms ease-out) for glyphs and step rows; entry staggered, **exit flat** — reveals are choreographed, dismissals instant. Hover-revealed controls enter from `translateY(-8) scale(0.95)`.
- Digit roll: 180ms per digit, 40ms stagger, 50% travel, **only digits after the first changed one animate**, roll direction encodes sign (falling balance rolls down). Balance-change flash: 250ms in / 50ms hold / 310ms out — decays, doesn't snap. Reserve the odometer for exactly two numbers: anonymity-set size and the block counter.
- Spinner vocabulary (three meanings, three motions): local effortful work (proving) = 1s `cubic-bezier(0.83,0,0.17,1)` rotation — easeInOutQuint, visibly strains each revolution; machine executing elsewhere (relayer) = 750ms **linear** ring around the step icon; queued/maturing = a **static** neutral3 ring. Attention ripple: 1px ring, scale 1→1.5, opacity 1→0, 1s linear.
- Long-wait copy escalation: swap the label, not the visuals — 10px down-in/down-out crossfade at `quicker` (§6).

**Do NOT animate:** color (status transitions crossfade the icon, never tween the hue — Uniswap excludes color with a bug-reference comment); layout/height of the step list (it's engineered to constant height); anything on every data poll; the honesty banners (they appear at `quick` opacity and then hold still); page transitions; more than one attention cue at a time. Ship `prefers-reduced-motion`: kill the shimmer, ripple, and digit roll (Uniswap kills the roll — verified), replace with the static ring + live text status. The five-channel step encoding (§6) carries state without motion; that's why it's built that way.

---

## 5. The privacy UX language — [PROPOSAL] throughout, built from verified parts

Verified gap: no shipped privacy product renders anonymity or leakage visually. Privacy Pools' entire grammar is a dollar list; Railway ships zero set visualization (full repo grepped). This section is winnable territory. Principle: **disclosure is furniture, not alarm**. A warning implies a choice; most of this is fact. Facts render calm.

**5.1 The disclosure block ("what leaks").** One component, `<Disclosure>`, required on every Review screen — a surface must render one or explicitly assert none. Recipe from Uniswap's InlineCard (verified): surface2, r16, p12, gap12, icon chip r12 p8; **headline takes the semantic color, body is forced neutral2 body3** — colored claim, neutral explanation. Contents: one line per visible field, verb-first, specific:
- `Visible on-chain: amount tier (10 STRK), recipient pool entry` — neutral, always present
- `The relayer sees: your IP, the withdrawal address — not the source note` — neutral
- `This action links two addresses publicly` — critical headline, and the CTA goes critical with it
Severity of the block = max severity of its lines, via one `getPrivacyColor()` function so two shades of "bad" can never coexist. The exit-without-privacy case gets Privacy Pools' verified pattern verbatim: affirmative title ("You're exiting the pool"), consequence, **named alternative** ("Use Withdraw for untraceability"), amber border + amber tint, at the decision point.

**5.2 Who can see it — the visibility matrix.** In the collapsible detail of every Review: three columns — **You / Relayer / Everyone** — rows for amount, sender, recipient, timing, IP. Cells are the compact status dot (below), not text. One glance answers the sponsor's question structurally. Copy register from Railway's shipped relayer disclosure (verified): name the actor, state what it *cannot* see, disclaim your relationship to it.

**5.3 Anonymity set.** Three tiers:
- The number: exact integer, always — "1,247 notes", never "~1.2K". Tabular, odometer-animated, with the caret-delta pattern: "▲ +32 since your deposit."
- The sentence: "Your withdrawal is one of 1,247 possible sources." When small: "12 notes is not enough to hide you. Wait, or split the amount." (severity Medium, CTA goes amber, WarnBeforeSubmit).
- The picture **[PROPOSAL]**: the note field — one small node per note in the set, yours highlighted — which is *the same picture* as the waiting screen (§6). Buildable: Privacy Pools ships a 9-node SVG lit by setInterval; yours is N real nodes from indexer data. The privacy explanation and the wait screen being one image is the product's signature move.
- Also steal **[PP]**: the pool list keeps $0 pools visible at the bottom in the same type — disclosure by ranking — and a **Global | Personal** activity feed as a first-class tab. Six surfaces feeding one pool makes the global feed your strongest anonymity argument; it's the best demo screen you have.

**5.4 Trust boundary.** One `<TrustBoundary>` modal, Signal's verified shape: centered 24px glyph, centered bold title, centered body at *lower* contrast than the title (confidence whispers), one verification action. Instances: chat counterparty key change; first use of a relayer; bridge exit to a transparent chain; viewing-key requests. Never scrim the viewing-key request — anchored, dismissible panel over a visible product (Uniswap's connect flow, verified: no scrim, page stays interactive). Coercion at the most sensitive moment is the wrong register.

**5.5 Auditor escrow (non-optional).** Because it cannot be opted out of, it must NOT look like a warning — warnings imply choice, and an unavoidable thing styled as alarming reads as an apology. Render it as **structure**: a permanent row in every Review's fee/detail area, same anatomy as the network-fee row — label neutral2, value neutral1, a small `Blocked`-style grey chip (neutral1 on surface3 — the "most severe state renders calmest" move, verified in Uniswap's getAlertColor):
> `Auditor escrow — encrypted to [named auditor key]. Can decrypt: amount, counterparty. Cannot decrypt: your other notes. [view key ↗]`
Tooltip shows the mechanism arithmetic (FeeBreakdown pattern). In the visibility matrix it's a fourth column, **Auditor**, with its dots filled honestly. Treating the escrow as a named, bounded, inspectable fact — like Privacy Pools naming "0xBow ASP" with a 7-day ceiling — is the anti-overclaiming answer: the UI states exactly who can see what, including the party the user didn't choose.

**5.6 Note lifecycle chip.** Steal Railway's 7-state grammar over Privacy Pools' 5-state chip, because Railway pairs each state with an instruction (verified): your states — `pending proof` / `maturing (6/10)` / `spendable` / `spent` / `expiring (amber, <50 blocks left)` / `expired` — each with a one-sentence next action. Chip styling **[PP verified]**: 1px border in status.main, status.light background, **label always at full text contrast, never the status color** (passes contrast in both themes for free), plus a compact 10px circle variant for dense lists.

---

## 6. The waiting problem

The pipeline screen: **Build → Prove → Relay → Mature → Confirmed.** Built almost entirely from verified parts.

**The step list** (Uniswap StepStatus grammar, verbatim):
- Six statuses: `Preview, Active, InProgress, Complete, Failed, Replaced`. Closed TS union — the string set for phase copy is closed at the type level so no surface invents a fourth string **[PP]**.
- Per state: Preview/Complete/Replaced → blank 24px neutral3 circle (icon withheld — the future is not yet real); Active → real icon + 1px attention ripple; InProgress → real icon in the 750ms linear ring; Failed → real icon + `Failed` badge (critical on critical-tint, r6). Failed steps keep active emphasis; Replaced keeps the failed attempt on screen, greyed — **history is not rewritten**, which is exactly right for an expired-and-regenerated proof.
- Five redundant channels (icon treatment, slot height 24→40, title body3 neutral2 → body2 neutral1, right-side content, connector) so state reads in greyscale. **Total row height is constant at 40px** (inactive py8 compensates the active icon growth): the user stares at this list for minutes; any reflow reads as instability.
- Connector: 2px vertical **dotted** line, neutral3, negative z — dots read as "path not yet travelled." Right side: Complete → success check; Active/InProgress → "Step 3 of 5" body4 neutral3, plus the countdown slot (mm:ss at 14px/500 — **[ADAPTED]** blocks: "6 / 10 blocks", never a percentage for block waits).
- Only the Active step shows a contextual accent link ("What does proving reveal? ↗") — help exactly where the user is stuck, verified pattern.
- Header: hairline — "Continue in wallet"-style caption, centered, body3 neutral2 — hairline; whole block enters at `quicker`, opacity only.

**The honest progress split** [PP, verified]: **determinate while you own the computation** (build, prove — you own the prover and know its phases): the in-button `accent2` fill, clamped to **0.5%–99.5%** ("started" / "refuses to claim done"), two-phase per step — 500ms jump to the step's floor, then crawl to its ceiling over the step's real estimated duration, with pre-computed percentage ranges so maturity gets its true ~80% share of the bar and it never sprints to 90% and stalls. **Indeterminate once handed off** (relayer, chain): the visual switches to the linear ring + block counter. The mode switch at "submitted" is itself the honesty signal. Progress is **monotonically clamped** — three lines, may only increase, one exception for exactly 1.0 **[PP verbatim]** — five async sources feed this bar and it must be physically incapable of retreating.

**Copy escalation** (Uniswap DelayedSubmissionText + Railway thresholds, verified): the button label is the narrator; swaps via 10px crossfade at `quicker`, zero layout change. Ladder: 0s "Generating proof…" → 3s "Generating proof — about 20s" → 20s "Still proving. Don't close this tab." → "Submitted via relayer" → "Maturing — 4 of 10 blocks" → done. Quote durations with a buffer so waits end early, not late (Railway hardcodes +60s on every estimate — **[ADAPTED]**: quote 12 blocks, deliver in 10). Countdown degrades instead of going negative: at zero, "Available shortly," never "-0:12" **[RW]**. Third tier **[RW]**: at an abnormal threshold (Railway: 10 min) switch to "This is taking longer than normal" + a link to the explorer/status — silence past the ceiling is indistinguishable from broken.

**Numbers during the wait:** never blank a known value. Skeleton (unknown) uses the invisible-placeholder-string pill: the real Text component renders a shape-matched placeholder (`'0.00000 STRK'`, `'0x0000…0000'`, `'1,024 notes'`) at opacity 0 with a full-radius surface3 bar inset 5% top/bottom, shimmered by the −75° mask sweep at 1s linear. **Honesty note:** the anti-reflow property is per-callsite work — you must supply the placeholder shape per field; it is not automatic. Stale-but-refreshing (the maturity window's constant state) uses `warmLoading` — the shimmer over the **real digits**, verified as a distinct Uniswap state — three states of knowing: unknown (skeleton), stale (warm shimmer), settled (static). `no-shimmer` variant for long waits where an infinite 1s sweep would punish.

**Proof expiry (450 blocks):** from 400 blocks the note chip goes `expiring` (amber) and the review shows a quiet countdown row. At expiry: the **re-consent row** (§3 Review) — "Proof expired at block 1,204,556 — Regenerate," bordered r16, secondary button, no modal, and the Failed→Replaced step treatment preserves the dead attempt in the list.

**Pool paused:** the disclaimer-bar pattern **[PP verified]**: full-width strip on the page background (not a red bar), 1px bottom hairline, ≤80 characters ("Deposits are paused by the pool operator. Withdrawals continue. Learn more"), and it **reflows layout via a CSS height variable** rather than overlaying content. Every blocked CTA switches to `onDisabledPress` and explains the pause on tap. Warm the proving circuits 2s after shell mount, once, app-wide **[PP]** — the biggest cold-start cost paid while the user reads.

**The wait visual [PROPOSAL]:** the note-field SVG from §5.3, with real pool nodes filling/lighting during prove and the user's note pulsing during maturity. Animate the mechanism, not a spinner — thirty seconds of a spinner is nothing; thirty seconds of the anonymity set drawing itself teaches the user what they bought.

---

## 7. What would make this look generic

Each is a verified anti-pattern from the field (Ekubo measured as the negative reference) or the known AI-slop register:

1. Purple-to-blue gradients, glassmorphism, glowing shadows, decorative blur. This palette has three shadows and they're near-invisible in light mode.
2. Hero type. In-app maximum is heading2/36. 48–64px display type is a marketing surface (Ekubo: 64px × 20 elements, zero tabular figures — the wrong bar).
3. A second grey hex, a fourth text level, a sixth surface. If it's not in §2 it doesn't exist.
4. Amber/spinner "pending" everywhere. Pending has no hue here. If the user sees amber for 90% of a session, your real warning is dead.
5. One spinner for every wait. Three motions, three meanings (§4) — or the spinner carries no information.
6. 300ms ease on hover. Chrome feedback is 80–100ms; slow chrome on a slow protocol reads as broken.
7. Symmetric enter/exit. Exits are faster and travel less, always.
8. Red for recoverable failure. Relayer hiccups and expired proofs are amber + inline Retry. Red = irreversible only.
9. Percentage bars for block waits, bars that touch 100% before the note is spendable, progress that moves backwards. Clamped, honest, or a counter.
10. Walls of identical skeleton rows (ramp the opacity down), skeletons for values you already have (pulse or warm-shimmer instead), banners that push the CTA down (warnings replace a fixed slot, same height).
11. Colored text on colored chips (labels stay at text contrast), monospace balances (mono is for hashes), proportional digits in any column.
12. Scrimmed connect/key prompts, empty states with sad illustrations and desperate filled CTAs (100px neutral3 line icon + text link; empty *portfolio* gets 2–3 action cards; disconnected gets a labeled **Demo** view — which, labeled, is also your anti-overclaiming demo mode for judges).
13. Lock and shield iconography sprinkled as decoration. The trust boundary is a modal; privacy is carried by the grammar in §5, not by padlocks.
14. Toast confirmations for the moment a note matures. Use the 1.2s attention highlight on the row itself.

---

## 8. Open questions for the designer

1. **Accent hue.** Structure is fixed (§2.4: one hue, both modes, triple + ink-primary CTAs). What is it? Constraint: must never collide with success green, warning amber, critical red/coral, or read as "another pink Uniswap fork."
2. **Dark-mode hue shift.** Neutral `#131313` family [UNI-verbatim] or a cool-shifted ramp à la Hyperliquid? If shifted: pick the hue, re-derive every surface + text alpha against it, and re-check the two semantic colors for contrast.
3. **Typeface.** Basel is licensed to Uniswap. Candidates: a variable grotesque with real 485/535 axis positions and good tabular figures (Inter tuned to 490/540 is the Polymarket-verified fallback; Suisse Intl is the field's premium register but LIKELY-only evidence). Decide, and confirm the mono pairing stays the system stack or matches the face.
4. **The note-field visualization** (§5.3/§6): node size, density cap (what does 10,000 notes look like?), degraded form for reduced-motion and mobile, and whether the user's note is highlighted by fill, ring, or position. This is the signature screen — prototype it first.
5. **Auditor escrow row**: is the grey-chip-as-structure treatment (§5.5) calm enough to be honest without looking like fine print? Alternative: a fourth matrix column only. Pick one, apply everywhere.
6. **Six surfaces, one shell**: does each surface get any identity marker at all (an icon, a neutral label) or nothing but the nav? Recommendation is nothing — the shared material IS the brand — but this is a taste call.
7. **Chat identity**: avatar treatment for pseudonymous counterparties (deterministic geometric marks from the key? the 8-color logoless fallback?), and how a key-change event renders inside the thread itself, not just as the modal.
8. **Unverified items you should treat as direction, not fact**: everything tagged [PROPOSAL]; the composed feel of the step list in motion (specified from source, never watched); the 12px/10px modal travel asymmetry's rationale; "Suisse = 2026." Everything else in this brief was read in source or measured on a live surface.
