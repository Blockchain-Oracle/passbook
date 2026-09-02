/// <reference types="vite/client" />

// Deployment addresses, inlined by `define` in vite.config.ts from evidence/markets-launch-deployment.json.
interface ImportMetaEnv {
  readonly VITE_APP_MARKETS_ADDRESS?: string
  readonly VITE_APP_MARKETS_V1_ADDRESS?: string
  readonly VITE_APP_LAUNCH_ADDRESS?: string
  readonly VITE_APP_PRAGMA_ADDRESS?: string
  readonly VITE_APP_GOVERNANCE_ADDRESS?: string
  readonly VITE_APP_GOVERNANCE_CLASS_HASH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
