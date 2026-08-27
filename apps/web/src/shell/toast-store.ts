//
// The toast bus — an imperative singleton, deliberately.
//
// A transaction handler three layers deep in a form must be able to say "tell the user" without
// threading a callback through every layer between itself and the chrome. That is the whole
// reason this is a module singleton with `useSyncExternalStore` on top (the `pool-health.ts`
// pattern) rather than context: context answers "who is my provider", and a settlement callback
// has no business knowing.
//
// CAPPED AT FIVE, OLDEST DROPPED. An unbounded stack during a burst (a batch claim settling five
// positions) walks off the top of the screen; five is what fits above the fold at the sizes the
// viewport renders. Every toast is dismissible by click, and auto-dismisses on a timer the
// CALLER can lengthen for consequential messages.
//

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  /** One optional supporting line. Toasts that need more than one are dialogs wearing a costume. */
  detail?: string
  /** ms until auto-dismiss. */
  duration: number
}

const MAX_VISIBLE = 5
const DEFAULT_DURATION = 5000

let nextId = 1
let toasts: readonly Toast[] = []
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  for (const l of listeners) l()
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getToasts(): readonly Toast[] {
  return toasts
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(id)
  }
  const next = toasts.filter((t) => t.id !== id)
  if (next.length !== toasts.length) {
    toasts = next
    emit()
  }
}

export function toast(input: { kind: ToastKind; title: string; detail?: string; duration?: number }): number {
  const id = nextId++
  const entry: Toast = {
    id,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    duration: input.duration ?? DEFAULT_DURATION,
  }

  const overflow = toasts.length + 1 - MAX_VISIBLE
  if (overflow > 0) {
    for (const dropped of toasts.slice(0, overflow)) {
      const timer = timers.get(dropped.id)
      if (timer !== undefined) clearTimeout(timer)
      timers.delete(dropped.id)
    }
    toasts = toasts.slice(overflow)
  }

  toasts = [...toasts, entry]
  emit()

  timers.set(
    id,
    setTimeout(() => dismissToast(id), entry.duration),
  )
  return id
}
