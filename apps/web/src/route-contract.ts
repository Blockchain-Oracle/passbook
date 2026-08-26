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

import type { ClassifiedPath } from './shell/modes'
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
export type HasIndexRoute = Assert<Ext<'/', Paths>>
export type HasSettingsRoute = Assert<Ext<'/settings', Paths>>
export type HasWalletRoute = Assert<Ext<'/wallet', Paths>>
export type HasChatRoute = Assert<Ext<'/chat', Paths>>
export type HasSwapRoute = Assert<Ext<'/swap', Paths>>
export type HasBridgeRoute = Assert<Ext<'/bridge', Paths>>
export type HasMarketsRoute = Assert<Ext<'/markets', Paths>>
export type HasLaunchRoute = Assert<Ext<'/launch', Paths>>
export type HasActivityRoute = Assert<Ext<'/activity/$id', Paths>>
export type HasPayRoute = Assert<Ext<'/pay/$address', Paths>>
