//
// The closed list of surfaces a transaction can originate from, in nav order. A leaf with no
// imports, so the public site can key its status table off it without pulling the transaction
// model — a seventh surface added here is a compile error there, not a row it never heard of.
//

export const ACTIVITY_SURFACES = ['wallet', 'chat', 'swap', 'bridge', 'markets', 'launch', 'houses'] as const

export type ActivitySurface = (typeof ACTIVITY_SURFACES)[number]
