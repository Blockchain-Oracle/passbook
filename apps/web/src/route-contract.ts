//
// The route tree's degradation guard. Compile-time only — nothing imports this file at runtime;
// `npm run typecheck` is what runs it.
//
// WHY THIS EXISTS. The claim "typed route paths give us compile-time route coupling" is true only
// while codegen is healthy, and VACUOUS the moment it is not. Measured, on this exact stack: with a
// healthy tree, `<Link to="/THIS-ROUTE-DOES-NOT-EXIST">` fails tsc at exit 2; with the route tree
// degraded to `any`, the identical Link is completely silent at exit 0. The cause is upstream, in
// `@tanstack/router-core`'s `routeInfo.d.ts` — `RoutePaths<T> = unknown extends T ? string : …`,
// and `unknown extends any` is true. So an `any` tree widens every route path to `string` and every
// wrong link starts passing.
//
// Every OTHER way the tree can break is already loud: a deleted generated file is TS2307 on the
// import below, an `unknown` tree fails the widening assertion, and a stale tree fails the per-path
// pin. The `any` shape is the one silent failure, and the first two assertions are aimed at it.
//
// One case deliberately PASSES, checked rather than assumed: a tree generated without the trailing
// `._addFileTypes<FileRouteTypes>()` call. It still types every route correctly — with it removed,
// a `<Link to="/THIS-ROUTE-DOES-NOT-EXIST">` is still caught at exit 2 — so nothing the contract
// cares about has degraded and failing it would be noise. Under an `any` tree the same bogus Link
// is silent, which is the difference this file exists to make.
//
// `routeTree.gen.ts` is imported DIRECTLY rather than through the router so that deleting the
// generated file fails this file, here, by name — and note that the generated file carries
// `// @ts-nocheck` on line 3, which is why "tsc is green" never on its own means "the route tree
// is sound".
//
import type { RegisteredRouter } from '@tanstack/react-router'
import type { RoutePaths } from '@tanstack/router-core'

import type { ActivitySurface } from '@strk20/protocol/transaction'
import type {
  CONTEXT_SURFACE,
  SURFACE_CONTEXT,
  VisibilityContext,
} from '@strk20/protocol/visibility-matrix'

import type { ClassifiedPath, Mode } from './shell/modes'
import type { routeTree } from './routeTree.gen'

/** Fails to compile unless T is exactly `true`. TS2344 is the noise this guard makes. */
type Assert<T extends true> = T

/** `any` is the only type for which `0 extends (1 & T)` holds. */
type IsAny<T> = 0 extends 1 & T ? true : false

type Not<B extends boolean> = B extends true ? false : true

/** `true` when A is assignable to B. Reads as "A extends B". */
type Ext<A, B> = A extends B ? true : false

type Paths = RoutePaths<RegisteredRouter['routeTree']>

/** The generated tree must not have collapsed to `any`. */
export type RouteTreeIsNotAny = Assert<Not<IsAny<typeof routeTree>>>

/**
 * The path union must not have widened back to bare `string`. This is the assertion that actually
 * catches the vacuous-pass: if `string` is assignable to `Paths`, then `Paths` IS `string` and
 * every `<Link to>` in the app has stopped being checked.
 */
export type RoutePathsAreNotWidened = Assert<Not<Ext<string, Paths>>>

//
// ---- routes are modes: the coupling, in both directions ------------------------------------------
//
// `shell/modes.ts` says which routes are the six modes and which are ancillary. On its own that is
// half a contract — it can only be wrong about modes. These two assertions close the other half, and
// all three artifacts ship together or none of the coupling is sound.
//
// Direction (i), in modes.ts: a mode with no route is TS1360 on the `satisfies`.
// Direction (ii), here: a ROUTE that no mode and no ancillary entry names. Measured: a residue
// `/nfts` route built at exit 0 and reported "evaluated clean on 14 route(s)" — the build is exactly
// the wrong place to notice a route nobody decided on. This is TS2344 instead.
//
// DEGRADATION-SAFE, which is the whole reason it is written this way round. Under a widened tree
// `Paths` is `string`, `string extends ClassifiedPath` is false, and this goes RED. The failure mode
// of a vacuous guard is silence; this one gets louder.
//

/** Every route the tree declares is either one of the six modes or a named ancillary page. */
export type EveryRouteIsClassified = Assert<Ext<Paths, ClassifiedPath>>

/** And nothing in that vocabulary names a route that does not exist. */
export type EveryClassifiedPathIsARoute = Assert<Ext<ClassifiedPath, Paths>>

//
// Per-path pins. These catch the case the assertions above cannot see: a tree that is well-typed and
// narrow but STALE, generated before a route existed. `EveryClassifiedPathIsARoute` covers the same
// ground for classified paths as a union — these name them one at a time, so a stale tree fails with
// the missing route in the diagnostic rather than with "this union is not assignable to that one".
//
// Add a line here when a route is added; a route deleted on purpose fails here first, which is the
// point.
//
//
// ---- the six surfaces are the six modes -----------------------------------------------------
//
// `@strk20/protocol/transaction` declares `ActivitySurface` — which surface originated a
// transaction — and it has to be the same six as the router's modes. The list is duplicated rather
// than imported because the protocol package must not reach the router's types, and a duplicated
// list is a list that drifts. These two assertions are what make the duplication safe, and they
// live here for the reason the route coupling above does: this file is where cross-artifact
// agreement is asserted rather than hoped for.
//
// TYPE-ONLY, so this costs nothing at runtime and adds no edge to any bundle. Both directions,
// because each catches a different mistake: a seventh mode with no surface means the feed cannot
// attribute a transaction that surface produces, and a surface with no mode is a row that would
// link to a route that does not exist.
//

/** Every mode a user can act from can be recorded as the origin of a transaction. */
export type EveryModeIsASurface = Assert<Ext<Mode, ActivitySurface>>

/** And every surface the record can name is a mode of this app. */
export type EverySurfaceIsAMode = Assert<Ext<ActivitySurface, Mode>>

//
// ---- the review vocabulary belongs to the six surfaces ---------------------------------------
//
// `@strk20/protocol/visibility-matrix` declares the ten review contexts a disclosure panel can be
// asked for, and each of them has to live on one of the six modes — a context on a seventh surface
// is a panel with no screen to render on, and a surface with no context is a Review that would have
// to render an empty matrix, which is the one thing story 6.7 forbids.
//
// THE MAPS ARE WRITTEN AS PLAIN STRINGS IN THAT MODULE, on purpose: `render-privacy-matrix.mjs`
// loads it with plain `node` under type stripping and a single relative import would break the
// generator, so it cannot name `ActivitySurface` itself. This is where the duplication is made
// safe, exactly as `EveryModeIsASurface` above makes the duplicated `Mode` list safe — and both
// directions are asserted, because a context pointing at a surface that does not exist and a
// surface with no review context are different mistakes.
//
// `SURFACE_CONTEXT` is NOT derivable from `CONTEXT_SURFACE`: three surfaces name two contexts each,
// so the reverse direction is a decision (which action a bare surface means) rather than a lookup.
// Both are pinned because both are consumed — the receipt reads the reverse map to decide which
// matrix a settled row renders.
//

/** Every review context lives on a surface the record can name. */
export type EveryContextIsASurface = Assert<
  Ext<(typeof CONTEXT_SURFACE)[VisibilityContext], ActivitySurface>
>

/** And the reverse map is keyed by exactly the six surfaces — no more, no fewer. */
export type EverySurfaceHasAContext = Assert<Ext<ActivitySurface, keyof typeof SURFACE_CONTEXT>>
export type EveryContextKeyIsASurface = Assert<Ext<keyof typeof SURFACE_CONTEXT, ActivitySurface>>

/** And what it maps to is a real review context, not a string that looks like one. */
export type EverySurfaceContextIsAContext = Assert<
  Ext<(typeof SURFACE_CONTEXT)[keyof typeof SURFACE_CONTEXT], VisibilityContext>
>

//
// Per-context pins, for the reason the per-path pins below exist: a member deleted or renamed in
// `VISIBILITY_CONTEXTS` fails here NAMING ITSELF, rather than as "this union is not assignable to
// that one" with ten members on each side and no clue which one moved.
//
export type HasPoolSendContext = Assert<Ext<'pool-send', VisibilityContext>>
export type HasSelfSubmitContext = Assert<Ext<'self-submit', VisibilityContext>>
export type HasRegistrationContext = Assert<Ext<'registration', VisibilityContext>>
export type HasChatPaymentContext = Assert<Ext<'chat-payment', VisibilityContext>>
export type HasSwapContext = Assert<Ext<'swap', VisibilityContext>>
export type HasBridgeExitContext = Assert<Ext<'bridge-exit', VisibilityContext>>
export type HasMarketsBetContext = Assert<Ext<'markets-bet', VisibilityContext>>
export type HasMarketsExitContext = Assert<Ext<'markets-exit', VisibilityContext>>
export type HasLaunchBuyContext = Assert<Ext<'launch-buy', VisibilityContext>>
export type HasLaunchSellContext = Assert<Ext<'launch-sell', VisibilityContext>>

export type HasIndexRoute = Assert<Ext<'/', Paths>>
export type HasSettingsRoute = Assert<Ext<'/settings', Paths>>
export type HasWalletRoute = Assert<Ext<'/wallet', Paths>>
export type HasChatRoute = Assert<Ext<'/chat', Paths>>
export type HasChatPeerRoute = Assert<Ext<'/chat/$peer', Paths>>
export type HasChatIndexRoute = Assert<Ext<'/chat/', Paths>>
export type HasSwapRoute = Assert<Ext<'/swap', Paths>>
export type HasBridgeRoute = Assert<Ext<'/bridge', Paths>>
export type HasMarketsRoute = Assert<Ext<'/markets', Paths>>
export type HasLaunchRoute = Assert<Ext<'/launch', Paths>>
export type HasSendRoute = Assert<Ext<'/send', Paths>>
export type HasActivityRoute = Assert<Ext<'/activity/$id', Paths>>
export type HasPayRoute = Assert<Ext<'/pay/$address', Paths>>
export type HasLaunchDetailRoute = Assert<Ext<'/launch/$id', Paths>>
export type HasTokenRoute = Assert<Ext<'/token/$address', Paths>>
export type HasProfileRoute = Assert<Ext<'/u/$name', Paths>>
export type HasHousesRoute = Assert<Ext<'/houses', Paths>>
export type HasHouseRecordRoute = Assert<Ext<'/houses/$id', Paths>>
