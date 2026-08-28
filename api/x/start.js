//
// `GET /api/x/start` — the door to X. Mints the PKCE verifier and the state, parks both in
// httpOnly cookies the callback will read, and sends the browser to X's authorize page.
//
// Yosuku's callback-origin lesson is inherited by CONSTRUCTION rather than by redirect: cookies
// here are written on the same origin the callback runs on, because both are `/api/x/*` on this
// deployment — there is no www/preview split to heal.
//
import { AUTHORIZE_URL, SCOPES, codeChallenge, cookie, genState, genVerifier, requestOrigin } from './_lib.js'

export default async function handler(req, res) {
  const clientId = process.env.X_CLIENT_ID
  if (!clientId || !process.env.X_SESSION_SECRET) {
    // The faucet's rule, spoken here: unconfigured is 404, not a broken button's 500.
    res.status(404).json({ error: 'X connect is not configured on this deployment' })
    return
  }

  const verifier = genVerifier()
  const state = genState()
  const returnTo = typeof req.query?.return === 'string' && req.query.return.startsWith('/') ? req.query.return : '/settings'

  const authorize = new URL(AUTHORIZE_URL)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('redirect_uri', `${requestOrigin(req)}/api/x/callback`)
  authorize.searchParams.set('scope', SCOPES)
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('code_challenge', codeChallenge(verifier))
  authorize.searchParams.set('code_challenge_method', 'S256')

  res.setHeader('Set-Cookie', [
    cookie('x_v', verifier, { maxAge: 600 }),
    cookie('x_s', state, { maxAge: 600 }),
    cookie('x_ret', returnTo, { maxAge: 600 }),
  ])
  res.redirect(302, authorize.toString())
}
