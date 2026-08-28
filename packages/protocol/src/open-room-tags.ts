//
// The PURE half of open rooms — the tag grammar and the disclosure sentence, importable from the
// eager chunk. `open-room.ts` (the crypto half) re-exports these; the split is the
// `directory-name.ts` discipline: this file must import nothing, because the surfaces that print
// the sentence and build the tags render before any crypto loads.
//

export const OPEN_ROOM_DISCLOSURE =
  'An open thread: the last 50 messages, held in the relay’s memory, readable by anyone on this ' +
  'page. Names on posts are claimed, not proven.'

/** The Talk tag for a launch (and the token it becomes — one thread across both pages). */
export function launchTalkTag(launchId: number): string {
  return `talk:launch:${launchId}`
}

/** The Talk tag for a market. */
export function marketTalkTag(marketId: number): string {
  return `talk:market:${marketId}`
}
