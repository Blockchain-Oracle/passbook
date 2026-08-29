//
// The privacy model, per party.
//
// PROSE, DELIBERATELY, and worth saying why when everything else on this site is computed. There is
// a machine-readable visibility matrix in the app — `@strk20/protocol/visibility-matrix`, four
// actors by five facts, consumed by the disclosure panel and the receipt. It answers "for THIS
// action, what does each party learn", which is a different question from the one a reader of the
// documentation is asking, which is "who are these parties and why do they exist at all".
//
// Deriving these five paragraphs from that matrix would mean inventing a summarizer whose output
// nobody has read. They are written instead, and the per-action matrix stays where it is consumed.
//
export interface Actor {
  readonly who: string
  readonly what: string
}

export const WHO_SEES_WHAT: readonly Actor[] = [
  {
    who: 'Your counterparty',
    what: 'The recipient of a private transfer sees the sender. Private does not mean anonymous to your counterparty — it never has here.',
  },
  {
    who: 'Our relayer',
    what: 'Your IP and the timing of your request. It exists so that its address, not yours, is the visible submitter on the public record.',
  },
  {
    who: 'Everyone',
    what: 'Deposits: depositor and amount. Amounts on any leg that touches an open note — a swap, a launch buy, a market bet all publish their size. What is hidden is who.',
  },
  {
    who: 'The auditor',
    what: 'Your viewing private key, escrowed on-chain at registration. Readable by anyone via get_enc_private_key(address). No rotation, no opt-out.',
  },
  {
    who: 'The pool operator’s screener',
    what: 'Deposits are mandatorily screened by a third-party provider. A refusal is silent — it will look like our bug.',
  },
]
