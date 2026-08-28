//
// The one polling primitive every surface shares.
//
// Before this file the app held eight bespoke `setInterval` sites with four cadences and exactly
// one of them paused on a hidden tab (`use-pragma.ts`, which argued the rule and then kept it to
// itself). Yosuku's postmortem measured the cost of that shape — a backgrounded markets page
// burning ~130 RPC round-trips a minute for frames nobody paints — and replaced 85 raw intervals
// with one visibility-aware helper. This is that helper, in this app's idiom.
//
// THE RULES, ALL THREE: a hidden tab runs nothing; becoming visible fires immediately rather than
// waiting out an interval that elapsed in the background; the first call fires now, because a
// surface that mounts blank and stays blank for one full interval reads as broken.
//

/**
 * Run `fn` now and every `ms` while the tab is visible. Returns the stop function.
 *
 * `fn` is fired, not awaited — an async `fn` owns its own overlap discipline, the same contract
 * every existing tick already had.
 */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const tick = () => {
    if (document.visibilityState !== 'visible') return
    fn()
  }
  tick()
  const timer = window.setInterval(tick, ms)
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
