//
// The name directory, from the browser's side.
//
// ── THE WHOLE LIST, FETCHED ONCE, SEARCHED LOCALLY ───────────────────────────────────────
//
// `POST /directory/list` returns every entry, and the client matches against them in memory. That
// looks wasteful and is the point: a search endpoint would hand the relayer the one thing this
// design is trying not to give it — who you are looking for. At this protocol's scale the whole
// directory is a few kilobytes, and the relayer's own entry cap makes the assumption fail loudly
// rather than slowly if it stops being true.
//
// `DIRECTORY_SEARCH_IS_LOCAL` says this on screen. It is the kind of decision users assume was
// made the other way, so it is worth the sentence.
//
// ── AVATARS ARE FETCHED PER ADDRESS, NEVER IN BULK ───────────────────────────────────────
//
// `DirectoryEntry` carries `hasAvatar` rather than the image: shipping every picture in the list
// would turn a few kB into a few hundred, on a request made to type a name into a box. So a row
// that says it has one asks for it, and only for the peers actually on screen.
//
// ── ONE FETCH PER SESSION, SHARED ────────────────────────────────────────────────────────
//
// Module-scope promise, `use-token-list.ts`'s pattern and for its reason: the sidebar, the new-
// message dialog and every thread header want the same list, and three components mounting at once
// must not be three round trips. A FAILURE IS NOT CACHED — a directory that was unreachable once
// should be retried, because the app works without it and quietly better with it.
//
import { useEffect, useState } from 'react'

import type { DirectoryEntry } from '@strk20/protocol/directory-name'

/**
 * Where the relayer answers.
 *
 * The same-origin proxy path, not the Fly host: the browser never holds the relayer's auth token,
 * so every call goes through the app host, which injects it. `register.ts`'s `DEFAULT_RELAYER_URL`
 * is the same decision for the same reason.
 */
const DIRECTORY_BASE = '/api/directory'

export interface DirectoryState {
  entries: readonly DirectoryEntry[]
  loading: boolean
  /** Set when the list could not be read. The app works without it; nothing here is fatal. */
  problem: string | null
}

let pending: Promise<readonly DirectoryEntry[]> | null = null

async function load(): Promise<readonly DirectoryEntry[]> {
  const response = await fetch(`${DIRECTORY_BASE}/list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw new Error(`the directory answered HTTP ${response.status}`)
  const body = (await response.json()) as { entries?: unknown }
  if (!Array.isArray(body.entries)) throw new Error('the directory returned no entries list')
  // Validated on the way in rather than trusted: this list decides which name renders over which
  // address, so an entry with a missing address would put a name on `undefined`.
  return body.entries.filter(
    (e): e is DirectoryEntry =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as DirectoryEntry).name === 'string' &&
      typeof (e as DirectoryEntry).address === 'string',
  )
}

function directory(): Promise<readonly DirectoryEntry[]> {
  if (pending) return pending
  pending = load().catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}

export function useDirectory(): DirectoryState {
  const [state, setState] = useState<DirectoryState>({ entries: [], loading: true, problem: null })

  useEffect(() => {
    let live = true
    void directory().then(
      (entries) => {
        if (live) setState({ entries, loading: false, problem: null })
      },
      (error: unknown) => {
        if (!live) return
        setState({
          entries: [],
          loading: false,
          // Not a failure the user has to act on — names are a convenience over addresses, and
          // every address still works. The sentence says that rather than sounding like an outage.
          problem: `Names could not be loaded, so conversations show addresses: ${String(error)}`,
        })
      },
    )
    return () => {
      live = false
    }
  }, [])

  return state
}

/**
 * The entries whose name or address matches, best first.
 *
 * A PREFIX MATCH ON THE NAME, a substring match on the address. Typing `al` should find `alice`
 * before `general`, and typing the last six characters of an address someone pasted should find
 * it — those are different questions and one `includes` for both gets the first one wrong.
 */
export function searchDirectory(
  entries: readonly DirectoryEntry[],
  query: string,
): readonly DirectoryEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const starts: DirectoryEntry[] = []
  const contains: DirectoryEntry[] = []
  for (const entry of entries) {
    const name = entry.name.toLowerCase()
    if (name.startsWith(needle)) starts.push(entry)
    else if (name.includes(needle) || entry.address.toLowerCase().includes(needle)) {
      contains.push(entry)
    }
  }
  return [...starts, ...contains].slice(0, 20)
}

/** The directory's name for an address, or `null`. Compared as felts — spellings differ. */
export function nameFor(entries: readonly DirectoryEntry[], address: string): string | null {
  let target: bigint
  try {
    target = BigInt(address)
  } catch {
    return null
  }
  for (const entry of entries) {
    try {
      if (BigInt(entry.address) === target) return entry.name
    } catch {
      // An entry whose address is not a felt cannot match anything. Skip rather than throw — one
      // bad row in a public ledger must not break name resolution for every other row.
    }
  }
  return null
}

export type ClaimOutcome = { ok: true } | { ok: false; because: string }

/**
 * Claim a name for this account.
 *
 * The signature is built in the caller (it needs the viewing key, which this module never sees) and
 * the relayer verifies it against `get_public_key(address)` — so a name cannot be squatted onto an
 * address whose key the claimant does not hold.
 */
export async function claimName(request: unknown): Promise<ClaimOutcome> {
  let response: Response
  try {
    response = await fetch(`${DIRECTORY_BASE}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch (e) {
    return { ok: false, because: `The directory could not be reached: ${String(e)}` }
  }

  if (response.ok) {
    // The cached list is now stale by exactly one entry. Dropping it is cheaper than merging, and
    // the next reader re-fetches — which is also what makes a claim visible to the claimant.
    pending = null
    return { ok: true }
  }

  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  return {
    ok: false,
    because: typeof body?.error === 'string' ? body.error : `The directory refused it (HTTP ${response.status}).`,
  }
}

/**
 * The avatars for the peers on screen, by lowercased address.
 *
 * ── ONLY FOR ENTRIES THAT SAY THEY HAVE ONE, AND ONLY ONCE ──────────────────────────────
 *
 * `DirectoryEntry.hasAvatar` is in the list precisely so this can skip the peers with nothing to
 * fetch — which is nearly all of them. A resolved fetch is cached in module memory for the
 * session, so switching conversations does not re-download a picture the app already holds, and a
 * peer with no picture is never asked about twice.
 *
 * The map is only ever ADDED to, so its identity changes when a fetch lands and the sidebar
 * re-renders with the new face. Rows whose avatar has not arrived render the identicon, which is
 * what they would have rendered anyway.
 */
const avatarCache = new Map<string, string | null>()

export function useAvatars(entries: readonly DirectoryEntry[]): Readonly<Record<string, string>> {
  const [resolved, setResolved] = useState<Record<string, string>>({})

  // The addresses worth asking about, as a stable string so the effect does not re-run on every
  // render of an unchanged list.
  const wanted = entries
    .filter((entry) => entry.hasAvatar)
    .map((entry) => entry.address.toLowerCase())
    .sort()
    .join(',')

  useEffect(() => {
    if (wanted === '') return
    let live = true
    void (async () => {
      for (const address of wanted.split(',')) {
        if (!live) return
        const cached = avatarCache.get(address)
        if (cached !== undefined) {
          if (cached !== null) setResolved((held) => (held[address] ? held : { ...held, [address]: cached }))
          continue
        }
        const avatar = await fetchAvatar(address)
        avatarCache.set(address, avatar)
        if (!live) return
        if (avatar !== null) setResolved((held) => ({ ...held, [address]: avatar }))
      }
    })()
    return () => {
      live = false
    }
  }, [wanted])

  return resolved
}

/** One peer's avatar, or `null`. Fetched only for peers actually on screen — see the header. */
export async function fetchAvatar(address: string): Promise<string | null> {
  try {
    const response = await fetch(`${DIRECTORY_BASE}/avatar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { avatar?: unknown }
    return typeof body.avatar === 'string' ? body.avatar : null
  } catch {
    // A missing picture is not an error state. The identicon was always the fallback.
    return null
  }
}
