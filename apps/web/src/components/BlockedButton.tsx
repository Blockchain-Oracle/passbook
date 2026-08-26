//
// The blocker-chain CTA (DESIGN §7.10) — the button whose label IS the error message.
//
// One ordered chain of reasons per surface, and `label = blocker ?? action`. There is no banner
// stack above the form, because the sentence a user needs is on the thing they were about to press.
//
// ── NEVER DISABLED. THIS IS THE POINT OF THE COMPONENT. ───────────────────────────────────
//
// A disabled button answers "why not?" with silence. This one stays a real, focusable, pressable
// button; `aria-disabled` tells assistive technology it will not act, and pressing it explains why
// out loud.
//
// AND IT DOES NOT USE THE COMPONENT LIBRARY'S `focusableWhenDisabled`. That prop looks like exactly
// this behaviour and is not: it prevent-defaults Enter and Space, so a keyboard user presses the
// button, nothing happens, and nothing is announced — silently dead, which is the precise failure
// the never-disable rule exists to ban. A plain `<button>` with `aria-disabled` keeps the key
// handling the browser already gives us.
//
import { useCallback, useRef, useState } from 'react'

export interface BlockedButtonProps {
  /**
   * The first unmet requirement, or `null` when the action is ready.
   *
   * A whole sentence, not a code. It is rendered as the label AND announced on a blocked press, so
   * "Enter an amount" works and "AMOUNT_REQUIRED" does not.
   */
  blocker: string | null
  /** What the button says when nothing is in the way. */
  action: string
  onPress: () => void
}

export function BlockedButton({ blocker, action, onPress }: BlockedButtonProps) {
  // Bumped on every blocked press. It keys the live region's child, so pressing twice against the
  // SAME blocker still announces — a live region only speaks when its content changes, and the
  // second press against an unchanged sentence would otherwise be met with silence, which is the
  // exact failure this component is about.
  const [presses, setPresses] = useState(0)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // An empty string is not `null`, and `??` does not fall through on it. A caller computing a
  // blocker chain by string concatenation can produce `''`, which would render an `aria-disabled`
  // button with no label at all — announced as "button" and nothing else.
  const stated = blocker !== null && blocker.trim() !== '' ? blocker : null

  const press = useCallback(() => {
    if (stated === null) {
      onPress()
      return
    }
    setPresses((n) => n + 1)

    //
    // THE SHAKE IS RESTARTED THROUGH THE DOM, deliberately, and this is the one place in the app
    // that reaches past React to do it.
    //
    // A second blocked press inside 300ms is the common case — a user presses, nothing happens,
    // they press again harder. Re-adding an animation class that is already present does nothing,
    // so the second press produced no movement: the button looked broken in exactly the moment it
    // was trying to explain itself. Remounting to restart it (the trick the balance line uses)
    // would destroy a focused button and drop the keyboard user to `<body>`.
    //
    // Remove, force a style flush by reading a layout property, re-add. The read is not
    // superstition — without it the browser coalesces both mutations into one frame and sees no
    // change at all.
    //
    const element = buttonRef.current
    if (element) {
      element.classList.remove('shake')
      void element.offsetWidth
      element.classList.add('shake')
    }
  }, [stated, onPress])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        // `shake` is absent here ON PURPOSE — it is owned by the handler above, and listing it in
        // React's className too would give one class two owners that disagree on the next render.
        className="cta focus-ring"
        // `aria-disabled`, never `disabled`. The real attribute removes the element from the tab
        // order and swallows the press, and then there is nothing left to explain itself with.
        aria-disabled={stated !== null}
        // NO `aria-describedby`. While blocked the button's accessible NAME is already the blocker
        // sentence, so pointing a description at the same words made a screen reader announce it
        // three times over: as the name, as the description, and again as the live-region update.
        onClick={press}
        onAnimationEnd={() => buttonRef.current?.classList.remove('shake')}
      >
        {stated ?? action}
      </button>

      {/*
        The announcement. `role="status"` is polite — it waits for a gap rather than interrupting,
        which is right for a consequence the user just triggered themselves. It is rendered
        unconditionally: a live region that mounts at the same moment its text appears is missed
        entirely by several screen readers, because there was no region there to be watching.
      */}
      <p className="sr-only" role="status">
        {stated === null ? '' : <span key={presses}>{stated}</span>}
      </p>
    </>
  )
}
