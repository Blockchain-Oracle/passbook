//
// The closed list of surfaces a transaction can originate from, in nav order. A leaf with no
// imports, so the public site can key its status table off it without pulling the transaction
// model — a tenth surface added here is a compile error there, not a row it never heard of.
//
// `mail` and `chat` are both here and are not the same thing. A mail is a pool transaction that
// pays the fee and posts a sealed memo to our Mailbox; a chat message is ciphertext over the
// relay and touches no chain at all. Two surfaces, two guarantees, two rows on the status table.
//

export const ACTIVITY_SURFACES = ['wallet', 'mail', 'chat', 'swap', 'earn', 'bridge', 'markets', 'launch', 'houses'] as const

export type ActivitySurface = (typeof ACTIVITY_SURFACES)[number]
