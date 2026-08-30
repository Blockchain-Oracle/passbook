//
// The one way this app speaks to you outside a surface.
//
// Every call-site used to hand-roll `toast.success(sentence, { description })`, which meant five
// spellings of "the money moved" and — worse — a REFUSAL that auto-dismissed after four seconds,
// taking its reason with it. The vocabulary here is the pipeline's, not the toast library's:
// something is MOVING, it SETTLED, or it was REFUSED. A refusal never expires on its own.
//
import { toast } from 'sonner'

import { Notification, type NotificationAction, type NotificationTone } from '@/components/ui/notification'
import { recordNotification } from '@/lib/notification-store'

export interface NotifyOptions {
  description?: string | null
  /** A transaction hash. Rendered as the explorer link, and kept in the log.  */
  hash?: string | null
  action?: NotificationAction | null
  /** Override the tone's default lifetime. `Infinity` keeps the card until it is dismissed. */
  duration?: number
  /** Replace an existing card in place, e.g. a `moving` card becoming its own outcome. */
  id?: string | number
}

/** A refusal stays. Everything else is a progress report, and progress reports expire. */
const LIFETIME: Record<NotificationTone, number> = {
  moving: 6_000,
  settled: 6_000,
  warned: 8_000,
  refused: Number.POSITIVE_INFINITY,
  noted: 5_000,
}

function raise(tone: NotificationTone, title: string, options: NotifyOptions = {}): string | number {
  const duration = options.duration ?? LIFETIME[tone]
  const timed = Number.isFinite(duration)
  const description = options.description ?? null
  const hash = options.hash ?? null
  // A refusal you cannot copy is a refusal you cannot report. The sentence and its reason travel.
  const copyText = tone === 'refused' ? [title, description, hash].filter(Boolean).join('\n') : null

  const id = toast.custom(
    (toastId) => (
      <Notification
        tone={tone}
        title={title}
        description={description ?? undefined}
        hash={hash}
        action={options.action ?? null}
        durationMs={timed ? duration : null}
        copyText={copyText}
        onDismiss={() => toast.dismiss(toastId)}
      />
    ),
    { duration, unstyled: true, ...(options.id === undefined ? {} : { id: options.id }) },
  )

  recordNotification({ id: String(id), tone, title, description, hash, at: Date.now() })
  return id
}

export const notify = {
  /** Value is in flight — submitted, proving, or away to the venue. */
  moving: (title: string, options?: NotifyOptions) => raise('moving', title, options),
  /** It landed. The only tone that should ever follow a `moving` card. */
  settled: (title: string, options?: NotifyOptions) => raise('settled', title, options),
  /** It did not happen, and the reason stays on screen until it is dismissed. */
  refused: (title: string, options?: NotifyOptions) => raise('refused', title, options),
  /** It happened, with something you should know about it. */
  warned: (title: string, options?: NotifyOptions) => raise('warned', title, options),
  /** Neither money nor failure — a plain acknowledgement. */
  noted: (title: string, options?: NotifyOptions) => raise('noted', title, options),
  dismiss: (id?: string | number) => toast.dismiss(id),
}
