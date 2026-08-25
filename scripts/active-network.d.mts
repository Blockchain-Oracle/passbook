// Hand-written types for `active-network.mjs`, so `apps/web/vite.config.ts` — which IS typechecked
// (see `apps/web/tsconfig.json`'s include) — can import the shared matcher without the app project
// turning on `allowJs`.
export interface ActiveNetworkDeclaration {
  /** The network name captured from the declaration, e.g. `'mainnet'`. */
  readonly network: string
  /** Byte offset of the declaration in the source it was found in. */
  readonly index: number
  /** The full matched line. */
  readonly text: string
}

export declare function activeNetworkRegex(): RegExp
export declare function findActiveNetworkDeclarations(source: string): ActiveNetworkDeclaration[]
export declare function requireSingleActiveNetwork(
  source: string,
  opts?: { file?: string; prefix?: string },
): ActiveNetworkDeclaration
export declare function flipActiveNetwork(
  source: string,
  toNetwork: string,
  opts?: { file?: string },
): string
