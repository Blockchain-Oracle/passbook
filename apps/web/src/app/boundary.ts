// WHERE the money lives and where an operation takes it — the axis the old app never had.
// A surface picks a `BoundaryKind`; it never authors its own privacy wording.

export type BoundaryTone = 'shielded' | 'public' | 'exposed' | 'neutral'

export interface Boundary {
  readonly label: string
  readonly tone: BoundaryTone
  readonly hint: string
}

export const BOUNDARY = {
  shielded: { label: 'Shielded', tone: 'shielded', hint: 'Inside the pool. Amount and counterparty stay private.' },
  shieldedRound: { label: 'Shielded in → out', tone: 'shielded', hint: 'Starts and ends inside the pool.' },
  publicEntry: { label: 'Public boundary', tone: 'public', hint: 'Public money enters the pool. The deposit is visible; what happens next is not.' },
  revealsInfo: { label: 'Reveals info', tone: 'exposed', hint: 'This step publishes something linkable.' },
  publicExit: { label: 'Public exit', tone: 'exposed', hint: 'Leaves the pool. The destination and amount become public.' },
  bothPublic: { label: 'Both ends public', tone: 'exposed', hint: 'Nothing here is private.' },
  readOnly: { label: 'Proof only', tone: 'neutral', hint: 'Proves a fact without moving money.' },
  bearer: { label: 'Bearer position', tone: 'neutral', hint: 'Whoever holds the secret holds the position.' },
} as const satisfies Record<string, Boundary>

export type BoundaryKind = keyof typeof BOUNDARY
