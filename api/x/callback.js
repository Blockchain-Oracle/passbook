//
// `GET /api/x/callback` — X sends the browser back here. Verify the state, trade the code for a
// token, ask who signed in, and fold the answer into an HMAC-signed session cookie. Then back to
// the app: the ephemeral OAuth material is cleared in the same response that uses it.
//
import { ME_URL, cookie, exchangeCode, readCookies, requestOrigin, signSession } from './_lib.js'

export default async function handler(req, res) {
  const cookies = readCookies(req)
  const clearTemp = [cookie('x_v', '', { clear: true }), cookie('x_s', '', { clear: true }), cookie('x_ret', '', { clear: true })]
  const back = (path, extra = []) => {
    res.setHeader('Set-Cookie', [...clearTemp, ...extra])
    res.redirect(302, path)
  }
  const returnTo = typeof cookies.x_ret === 'string' && cookies.x_ret.startsWith('/') ? cookies.x_ret : '/settings'

  const code = typeof req.query?.code === 'string' ? req.query.code : null
  const state = typeof req.query?.state === 'string' ? req.query.state : null
  if (!code || !state || !cookies.x_v || state !== cookies.x_s) {
    // A denied consent screen, a replay, or cookies written on an origin this is not — all land
    // here, and all get the app back with a marker it can render a sentence for.
    back(`${returnTo}?x=failed`)
    return
  }

  try {
    const token = await exchangeCode(code, cookies.x_v, `${requestOrigin(req)}/api/x/callback`)
    const me = await fetch(ME_URL, { headers: { authorization: `Bearer ${token.access_token}` } })
    if (!me.ok) throw new Error(`users/me answered ${me.status}`)
    const answer = await me.json()
    const id = answer?.data?.id
    const handle = answer?.data?.username
    const avatarUrl = answer?.data?.profile_image_url
    if (typeof id !== 'string' || typeof handle !== 'string') throw new Error('users/me answered without an identity')

    // The session carries id + handle + the avatar URL for `link.js` to fetch SERVER-SIDE — the
    // browser never loads pbs.twimg.com itself, so X never sees the visitor render their own face.
    const session = signSession({ id, handle, avatarUrl: typeof avatarUrl === 'string' ? avatarUrl : null })
    back(`${returnTo}?x=connected`, [cookie('x_sess', session, { maxAge: 30 * 24 * 3600 })])
  } catch (e) {
    console.warn(`x callback failed: ${String(e)}`)
    back(`${returnTo}?x=failed`)
  }
}
