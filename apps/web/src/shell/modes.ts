//
// The closed mode enum, and the two directions of coupling that make it mean something.
//
// Routes are MODES of one shell. There are six, they are coequal, and adding a seventh is a
// compile error until the enum grows — that is the whole product rule, expressed as types.
//
// READ THIS BEFORE TRUSTING THE `satisfies` LINE BELOW. On its own it is half-vacuous. Measured, in
// this app rather than in an isolated file: under a route tree that has degraded to `any`,
// `RoutePaths<…>` widens to `string` and `MODE_ROUTES` pointing at '/THIS-ROUTE-DOES-NOT-EXIST'
// compiles at exit 0. The `satisfies` catches a mode with no entry and nothing else. What makes the
// coupling sound is the three assertions in `route-contract.ts` shipping WITH it:
//
//   RouteTreeIsNotAny / RoutePathsAreNotWidened   the tree has not degraded, so `Paths` is narrow
//   EveryRouteIsClassified                        no route exists outside this file's vocabulary
//   EveryClassifiedPathIsARoute                   nothing here names a route that does not exist
//
// All four artifacts ship together or none of the coupling is real.
//
import type { RegisteredRouter } from '@tanstack/react-router'
import type { RoutePaths } from '@tanstack/router-core'

/** Every path the generated route tree declares. Narrow while codegen is healthy; `string` if not. */
type Paths = RoutePaths<RegisteredRouter['routeTree']>

/**
 * The six modes, in nav order.
 *
 * A seventh entry with no route below is TS1360 + TS7053 — four diagnostics, exit 2. The order here
 * is the order the header renders, so this list is the nav's source of truth as well as the enum's.
 */
export const MODES = ['wallet', 'chat', 'swap', 'bridge', 'markets', 'launch'] as const

export type Mode = (typeof MODES)[number]

/**
 * Mode -> the route it is. Direction (i) of the coupling.
 *
 * `as const` keeps the values as literals so `Link to={MODE_ROUTES[mode]}` is checked against the
 * route tree rather than against `string`; `satisfies` is what fails when one of them is not a real
 * path. Both halves are load-bearing — `as const satisfies` is not a stylistic pair here.
 */
export const MODE_ROUTES = {
  wallet: '/wallet',
  chat: '/chat',
  swap: '/swap',
  bridge: '/bridge',
  markets: '/markets',
  launch: '/launch',
} as const satisfies Record<Mode, Paths>

/**
 * What the nav calls each mode.
 *
 * Written out rather than derived by capitalising the key: the enum member is an identifier and the
 * label is user-facing copy, and the day those two need to differ must not be the day someone
 * discovers they were the same string all along.
 */
export const MODE_LABELS = {
  wallet: 'Wallet',
  chat: 'Chat',
  swap: 'Swap',
  bridge: 'Bridge',
  markets: 'Markets',
  launch: 'Launch',
} as const satisfies Record<Mode, string>

/**
 * Every route that is NOT a mode, and is deliberately not one.
 *
 * `/` redirects and paints nothing of its own; `/settings` is chrome; the two param routes are
 * destinations reached from a surface, never from the nav. A route that belongs in neither list
 * fails `EveryRouteIsClassified` — which is the point: "is this a seventh mode or an ancillary
 * page?" is a decision, and this file is where it is recorded rather than defaulted.
 *
 * `/send` is the decision worth writing down. A send is not a seventh mode: it is what the WALLET
 * does, and it is reached from the wallet's own Send tile rather than from the nav. Giving it a
 * route instead of a dialog is about the form's size — a 480px column with an asset picker, a
 * recipient field and a review does not belong stacked inside another surface's modal — not about
 * its rank.
 */
export const ANCILLARY_PATHS = [
  '/',
  '/settings',
  '/send',
  '/activity/$id',
  '/pay/$address',
] as const satisfies readonly Paths[]

/** Every route path this file accounts for. Compared against the tree in `route-contract.ts`. */
export type ClassifiedPath = (typeof MODE_ROUTES)[Mode] | (typeof ANCILLARY_PATHS)[number]
