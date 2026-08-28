//
// `POST /api/x/unlink` — forget the browser session. The directory binding stays: it is a public
// record the holder made with a signature, and un-signing-in is not un-claiming.
//
import { cookie } from './_lib.js'

export default async function handler(req, res) {
  res.setHeader('Set-Cookie', [cookie('x_sess', '', { clear: true })])
  res.status(200).json({ signedIn: false })
}
