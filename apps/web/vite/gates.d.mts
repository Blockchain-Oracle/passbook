// Hand-written types for `gates.mjs`, so `vite.config.ts` — which IS typechecked (see
// tsconfig.json's include) — can import the plugin without the app project turning on `allowJs`.
// Same arrangement as `scripts/active-network.d.mts`.
import type { Plugin } from 'vite'

export declare function passbookGates(options: {
  /** Repository root. The frozen-money manifest is resolved against it. */
  readonly repoRoot: string
  /** The directory the build writes to. Read in `closeBundle`, after the artifact exists. */
  readonly outDir: string
}): Plugin
