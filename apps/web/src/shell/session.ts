//
// THE APP'S FRONT DOOR — the call `session.ts` was written for and never had.
//
// `packages/protocol/src/session.ts:1-8` says it outright: *"Epic 6 boots the browser app from
// here: build a store, get the account key… The call that builds a store at app boot is epic 6's."*
// Every piece below it — the storage boundary, the key, the leader lock, the cadence store — has
// been built and tested for weeks with zero callers. This is the caller.
//
// ── LOGIN-FREE BY CONSTRUCTION, WHICH IS A PRODUCT DECISION AND A GATE REQUIREMENT ────────
//
// AD-4/AD-7: the account is derived in the browser on first load. There is no wallet to connect,
// no email, no seed phrase to paste before anything works. Opening the page IS having an account.
// That is also what makes the hosted demo satisfy "works without login" — not a waiver, a
// consequence.
//
// ── THE SDK LOADS LAZILY, AND THE GATE ENFORCES IT ───────────────────────────────────────
//
// `identity.ts` reaches `starknet` for its CSPRNG and curve arithmetic, so importing it statically
// would put the crypto graph in the entry chunk and `build:web` would refuse the build by name.
// Everything here is behind `import()`, and the session arrives a beat after first paint —
// which is why `SessionState` has a `loading` arm rather than pretending an account exists
// synchronously.
//
// ── A BROWSER THAT CANNOT SAVE GETS NO ACCOUNT, AND THAT IS DELIBERATE ───────────────────
//
// `browserSessionStore` has NO in-memory fallback, and its own header explains why: an account
// that vanishes on reload is one a user could fund and then lose, and registering from it would
// orphan it on the pool — where the viewing key is written once and `WriteOnce` refuses every
// replacement. So the honest outcome is a refusal that says so.
//
// Verified rather than assumed: run the boot with no `localStorage` and `loadOrCreateAccountKey`
// returns `{ ok: false }` carrying that sentence. This file renders it as the `failed` arm, and
// the page still works — you can browse, and quotes still price. What you cannot do is hold value
// somewhere that will forget you.
//
// (The first version of this file claimed an in-memory fallback and carried a `durable` flag for
// it. Both were wrong: the flag could never be false on a ready session, because a session only
// becomes ready when storage worked.)
//
import { useEffect, useState } from 'react'

// STATIC, and correct precisely because this module has no SDK edge: `account-address.ts` takes the
// Pedersen hasher as an argument rather than importing one, which is the whole reason it was
// written that way. Importing it dynamically here while `submit.ts` imports it statically also
// defeated both splits — the bundler said so, and the warning contract refused the build.
import { accountAddressFor } from '@strk20/protocol/account-address'

/** What the app knows about its own account. */
export type SessionState =
  /** Before the first answer. NOT "no account" — nothing has been read yet. */
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      /** The root key. Never rendered, never logged — held so callers can sign. */
      readonly accountKey: string
      /**
       * Derived, never stored: a second copy of a secret with nothing gained.
       *
       * BOUND TO THE CHAIN AND THE POOL, which is a privacy property rather than a parameter list.
       * The same account key against a different pool yields an unrelated viewing key, so one
       * pool's indexer cannot read another's notes.
       */
      readonly viewingKey: bigint
      /**
       * Where this account WILL live — its counterfactual address.
       *
       * Starknet has no EOAs: an account is a contract, and its address is a hash of what it will
       * be deployed from. So this is exact and usable before anything is deployed — funds sent
       * here wait for the deployment. It is also what discovery looks the account up by.
       */
      readonly address: string
      /** True on the load that created it, so a first run can say something a return visit must not. */
      readonly created: boolean
    }
  /** The account could not be established. `because` is a whole sentence, safe to render. */
  | { readonly status: 'failed'; readonly because: string }

/**
 * Build or load this browser's account.
 *
 * NEVER THROWS. A failure here is the app having no account, which is a state to render — not an
 * exception on the way to a blank page.
 */
export async function bootSession(): Promise<SessionState> {
  try {
    // One dynamic import for the whole tier; the bundler gives it a single chunk. `constants` is
    // already eager, so naming it here costs nothing and keeps the pool binding explicit.
    const [
      { browserSessionStore, loadOrCreateAccountKey },
      { deriveViewingKey },
      { NET },
      { ec, hash },
    ] = await Promise.all([
      import('@strk20/protocol/session'),
      import('@strk20/protocol/identity'),
      import('@strk20/protocol/constants'),
      // The SDK is already in this chunk because of `identity`, so naming it costs nothing here —
      // and `account-address.ts` deliberately takes the hasher rather than importing it, so that
      // module stays loadable by anything.
      import('starknet'),
    ])

    // `browserSessionStore` refuses outright where nothing can be saved, and `loadOrCreateAccountKey`
    // turns that into a typed failure carrying the sentence. Nothing here needs to check first.
    const key = loadOrCreateAccountKey(browserSessionStore())
    if (!key.ok) return { status: 'failed', because: key.reason }

    return {
      status: 'ready',
      accountKey: key.accountKey,
      viewingKey: deriveViewingKey(key.accountKey, NET.chainId, NET.pool),
      address: accountAddressFor(ec.starkCurve.getStarkKey(key.accountKey), (a, b) =>
        hash.computePedersenHash(a, b),
      ),
      created: key.created,
    }
  } catch (error) {
    // A failed chunk load lands here too — a different failure with the same honest answer.
    return {
      status: 'failed',
      because:
        error instanceof Error && error.message
          ? `This browser could not open an account: ${error.message}`
          : 'This browser could not open an account.',
    }
  }
}

//
// ── ONE SESSION PER TAB, SHARED BY EVERY SURFACE ─────────────────────────────────────────
//
// Module-scope promise, for `use-token-list.ts`'s reason: several surfaces want the account and
// deriving it twice would mean two key generations racing for the same storage slot on a first
// run. A failure is NOT cached — a chunk that failed to load once should be retried.
//
let booting: Promise<SessionState> | null = null

function session(): Promise<SessionState> {
  if (booting) return booting
  booting = bootSession().then((state) => {
    if (state.status === 'failed') booting = null
    return state
  })
  return booting
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    void session().then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
  }, [])

  return state
}

/**
 * A felt shortened for display: `0x1234…abcd`.
 *
 * The ELLIPSIS IS ONE CHARACTER (U+2026), not three dots — three periods in a monospace address is
 * three more characters that look like part of the value.
 */
export function shortenFelt(felt: string, lead = 6, tail = 4): string {
  if (felt.length <= lead + tail + 1) return felt
  return `${felt.slice(0, lead)}…${felt.slice(-tail)}`
}
