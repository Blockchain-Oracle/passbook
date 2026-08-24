//
// The `POST /submit` wire contract.
//
// ONE DEFINITION, both ends. The browser builds this body (`register.ts`) and the server
// parses it (`relayer/src/server.ts`); before this existed, each side described the shape
// in its own words and the only thing keeping them agreed was that one person had written
// both. It lives in `protocol` because that is the package both halves already depend on
// — putting it in the relayer would make the browser import server code.
//
// It is a WIRE type, so everything here has to survive `JSON.stringify`: felts are
// strings, never bigints.
//

import type { Call } from 'starknet'

/** The body `POST /submit` accepts. */
export interface SubmitBody {
  /** The calls to sign, in order. The relayer's allowlist decides which are permitted. */
  calls: Call[]
  /**
   * Prover facts for a proven pool submission (story 1.12). OPTIONAL and additive: a
   * body without it is an ordinary submission and behaves exactly as it did before this
   * field existed. When present it must be a non-empty array of felt strings — the
   * server validates it, because these ride in the V3 transaction details rather than in
   * any call's calldata and so never pass the allowlist.
   */
  proofFacts?: string[]
}

/** What `POST /submit` answers, whatever the status. */
export interface SubmitResponseBody {
  /** Present, and non-empty, only on a 200. */
  transactionHash?: string
  error?: string
  /** `'sponsorship-paused'` on the 403 that means the daily budget is spent. */
  reason?: string
  /** Operator-authored copy the client shows verbatim rather than paraphrasing. */
  notice?: string
}
