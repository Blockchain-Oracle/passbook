//
// Every user-facing sentence the session tier ships.
//
// One const per sentence, `backup-copy.ts`'s convention. It applies here too because the
// non-leader sentence travels a long way from where it is written: it is thrown by
// `makeAcquireSubmitLock`, stringified into `RegisterFailure`'s `lock-unavailable` reason by
// `register.ts`, and rendered by a component epic 6 has not written yet. Three hops, and at
// every one of them a hand-typed copy would be a sentence that drifts.
//
// THE SAME COPY RULE APPLIES HERE TOO. Ten bare claim substrings are forbidden in user-facing copy —
// substrings, in comments as well as in strings, because it is line-based over the whole
// file. Nothing here may quote one to explain it — see `backup-copy.ts`'s header, which
// states the rule in the one place it is safe to state.
//

/**
 * What a tab that is not the leader says when it is asked to submit. BYTE-EXACT.
 *
 * Two sentences, and the second one is the load-bearing half. "This account is open in
 * another tab" alone reads as a warning the user could dismiss or work around; adding what
 * the other tab is DOING explains why this one is refusing and implies the remedy — go back
 * to the tab that is working, or close it. A user who does not know a submission is already
 * running is a user who will hunt for a way to force this one.
 *
 * It DOES say to wait and retry now, and that changed with the lock underneath it. The lock used
 * to be held for a tab's whole lifetime, so "try again" was advice that would never come true —
 * the other tab had to be closed. It is now held only while a submission actually runs, so the
 * block clears on its own in seconds and retrying is the correct thing to tell someone to do.
 *
 * Delivered through the seam `register.ts` already has. That module turns a throwing
 * `acquireSubmitLock` into `{ kind: 'lock-unavailable', reason: String(e) }` — so this
 * sentence rides out as the reason, and the frozen file needs no edit for it to arrive.
 */
export const ACCOUNT_OPEN_IN_ANOTHER_TAB =
  'This account is open in another tab, and that tab is submitting. Wait for it to finish, then try again.'

/**
 * What THIS tab says when it is already submitting and is asked to submit again.
 *
 * The double-click, and it is by some distance the most common refusal this tier produces —
 * far more common than the two-tab case, because it takes one impatient person and one button.
 * It shipped carrying developer text ("a second acquire would produce two releases for one
 * hold"), which `register.ts` stringifies into `lock-unavailable`'s reason and epic 6 would put
 * on screen. That sentence is true and it is addressed to us, not to the person reading it.
 *
 * "in this tab" is the whole distinction from `ACCOUNT_OPEN_IN_ANOTHER_TAB`. Telling someone
 * their account is open in another tab when the other submission is the one they just started
 * here sends them hunting for a tab that does not exist. The developer detail is not thrown
 * away — it rides along behind this sentence, for the log.
 */
export const SUBMISSION_ALREADY_IN_PROGRESS = 'A submission is already in progress in this tab.'

/**
 * What a browser with no usable storage says.
 *
 * A real state, not a hypothetical one: Safari private mode, an origin whose storage the user
 * has blocked, and a full quota all produce it, and `probeLocalStorage` is what detects it.
 * The sentence has to make the stakes legible without being a dead end, because the honest
 * consequence is severe — this app cannot create an account it would immediately forget the
 * key to, since the pool writes a viewing key once and never lets it be replaced.
 *
 * It names the fix the user can actually perform (leave private browsing, or allow storage
 * for this site) rather than describing the failure in the app's own vocabulary.
 */
export const SESSION_STORAGE_UNAVAILABLE =
  "This browser won't let us save anything, so we can't create an account here — we'd lose " +
  'the key the moment you closed the tab. Leave private browsing, or allow storage for this ' +
  'site, and reload.'
