//
// `GET /api/x/me` — who is signed in in THIS browser. Deliberately only the session's half of
// yosuku's two-source answer: the durable binding lives in the directory the app already fetches,
// and conflating "signed in here" with "bound on the ledger" is the bug their comment records.
//
import { readSession } from './_lib.js'

export default async function handler(req, res) {
  if (!process.env.X_SESSION_SECRET) {
    res.status(404).json({ error: 'X connect is not configured on this deployment' })
    return
  }
  const session = readSession(req)
  res.setHeader('cache-control', 'no-store')
  res.status(200).json(
    session
      ? { signedIn: true, handle: session.handle, id: session.id }
      : { signedIn: false },
  )
}
