//
// The public half of a vault, and its strict reader. The header is the half an attacker can edit
// without breaking the GCM tag, so every field is checked. A leaf — no imports.
//

/** Rendered by the locked screen; never secret. */
export interface VaultHeader {
  readonly active: string
  readonly accounts: readonly {
    readonly address: string
    readonly label: string | null
    readonly addedAt: number
  }[]
}

export function readHeader(value: unknown): VaultHeader | null {
  if (!value || typeof value !== 'object') return null
  const header = value as Partial<VaultHeader>
  if (typeof header.active !== 'string' || header.active === '') return null
  if (!Array.isArray(header.accounts) || header.accounts.length === 0) return null
  const accounts: VaultHeader['accounts'][number][] = []
  for (const entry of header.accounts) {
    if (!entry || typeof entry !== 'object') return null
    const account = entry as Partial<VaultHeader['accounts'][number]>
    if (typeof account.address !== 'string' || account.address === '') return null
    if (account.label !== null && typeof account.label !== 'string') return null
    if (typeof account.addedAt !== 'number' || !Number.isFinite(account.addedAt)) return null
    accounts.push({ address: account.address, label: account.label, addedAt: account.addedAt })
  }
  if (!accounts.some((a) => a.address === header.active)) return null
  return { active: header.active, accounts }
}
