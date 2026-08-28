/// <reference types="vite/client" />

// Deployment addresses, inlined by `define` in vite.config.ts from evidence/markets-launch-deployment.json.
interface ImportMetaEnv {
  readonly VITE_PASSBOOK_MARKETS_ADDRESS?: string
  readonly VITE_PASSBOOK_LAUNCH_ADDRESS?: string
  readonly VITE_PASSBOOK_PRAGMA_ADDRESS?: string
  readonly VITE_PASSBOOK_GOVERNANCE_ADDRESS?: string
  readonly VITE_PASSBOOK_GOVERNANCE_CLASS_HASH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
