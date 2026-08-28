//
// The toast viewport — mounted once in the chrome, painting whatever the bus holds.
//
// Dependency-free on purpose: the entrance is Tailwind v4's `starting:` variant (@starting-style
// under the hood) driving transform+opacity only, which is this app's standing motion rule. The
// exit is instant removal — a toast that lingers half-faded under a pointer reads as a hung UI,
// and the multi-toast reflow the removal causes is itself the exit animation.
//
// The container is pointer-transparent while items are pointer-opaque, so a toast never blocks a
// click on the page behind the empty parts of its column. Clicking anywhere on a toast dismisses
// it — the whole surface is the dismiss control, no 12px × on a 300ms deadline.
//
import { useSyncExternalStore } from 'react'

import { cn } from '../lib/cn'
import { dismissToast, getToasts, subscribeToasts, type Toast, type ToastKind } from './toast-store'
import { Text } from '../components/Text'

const KIND_STYLES: Record<ToastKind, { border: string; dot: string; label: string }> = {
  success: { border: 'border-settled/30', dot: 'bg-settled', label: 'Done' },
  error: { border: 'border-irreversible/30', dot: 'bg-irreversible', label: 'Problem' },
  info: { border: 'border-surface3', dot: 'bg-neutral3', label: 'Note' },
}

function ToastItem({ item }: { item: Toast }) {
  const style = KIND_STYLES[item.kind]
  return (
    <button
      type="button"
      onClick={() => dismissToast(item.id)}
      aria-label={`Dismiss: ${item.title}`}
      className={cn(
        'pointer-events-auto flex w-[320px] items-start gap-s12 rounded-card border border-solid',
        'bg-raised p-s12 text-left shadow-[var(--shadow-medium)]',
        'transition-[transform,opacity] duration-[var(--transition-duration-quick)]',
        'starting:translate-y-3 starting:opacity-0',
        style.border,
      )}
    >
      <span aria-hidden="true" className={cn('mt-s6 size-s8 shrink-0 rounded-pill', style.dot)} />
      <span className="flex min-w-0 flex-col gap-s2">
        <Text variant="body3" className="text-neutral1">
          {item.title}
        </Text>
        {item.detail ? (
          <Text variant="body4" className="text-neutral2">
            {item.detail}
          </Text>
        ) : null}
      </span>
    </button>
  )
}

export function ToastViewport() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  if (!items.length) return null
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-s16 bottom-s16 z-toast flex flex-col items-end gap-s8"
    >
      {items.map((item) => (
        <ToastItem key={item.id} item={item} />
      ))}
    </div>
  )
}
