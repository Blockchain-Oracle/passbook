# strk20.run web

Vite + React 19 + TypeScript, scaffolded by `create-vite` and `shadcn init` — nothing hand-rolled
where a documented path exists.

| Layer | Library | Where |
|---|---|---|
| Routing | TanStack Router (file-based, `@tanstack/router-plugin`) | `src/routes/` |
| Chain / relayer state | TanStack Query | `src/queries/`, `src/mutations/` |
| UI primitives | shadcn/ui (`base-nova`, Base UI) | `src/components/ui/` (generated) |
| Styling | Tailwind v4, STUDIO tokens in `@theme` | `src/styles/studio.css` |
| Theme pin | next-themes (`data-theme` on `<html>`) | `src/app/theme-provider.tsx` |
| Icons | lucide-react | — |
| Protocol | `@strk20/protocol` (workspace) | `packages/protocol` |

```
src/
  main.tsx            providers + RouterProvider
  app/                query-client, theme-provider, navigation (the one nav list)
  routes/             thin route files: createFileRoute + search validation + composition
  features/<name>/    one folder per surface: wallet, send, swap, bridge, chat, markets,
                      launch, houses, settings, onboarding, account
  components/
    ui/               shadcn registry output — patch only with a comment saying why
    layout/           AppSidebar, MobileTabs, Page
    money/            AssetIdentity, BoundaryBadge, ShieldedCard, PublicCard, CrossingRail,
                      MoneyField, ReviewSheet, OperationPipeline, Receipt
    privacy/          VisibilityMatrix, Disclosure, LinkabilityMeter
  queries/            queryOptions() factories per domain
  mutations/          useMutation wrappers around protocol writes
  lib/                utils (cn), formatting, relayer fetch
  styles/             studio.css (tokens + shadcn contract)
```

Rules: files ≤ 400 lines; features never import each other; routes compose, never implement;
never sum STRK + USDC, never sum public + shielded, unknown never renders as `0`.

```bash
pnpm dev      # vite, proxies /api to RELAYER_ORIGIN (default http://127.0.0.1:8787)
pnpm build    # tsc -b && vite build — refuses an off-mainnet tree
```
