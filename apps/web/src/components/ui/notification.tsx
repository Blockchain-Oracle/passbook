//
// The notification card. One shape for every thing the app has to tell you.
//
// It floats on an INVERTED surface (`data-surface="inverted"`, defined in `studio.css`), because a
// card painted `raised` on a `ground` page is a 6% luminance step and that is the whole reason
// notifications were invisible. The tone lives in a 4px rail and a tinted icon disc, never in the
// card's own colour: a wall of red is not more legible than one red stripe.
//
// A MONEY NOTIFICATION CARRIES ITS HASH. The old toasts formatted a sentence and threw the
// transaction away, so the one thing you might want to check was the one thing you could not.
//
import { ArrowUpRight, Check, CircleCheck, Copy, Info, OctagonX, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Spinner } from '@/components/ui/spinner'
import { useCopy } from '@/hooks/use-copy'
import { explorerTx, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'

export type NotificationTone = 'moving' | 'settled' | 'refused' | 'warned' | 'noted'

interface ToneSkin {
  rail: string
  disc: string
  icon: ReactNode
}

/** Accent scarcity applies here too: `moving` is the only one wearing the brand colour. */
const TONE: Record<NotificationTone, ToneSkin> = {
  moving: { rail: 'bg-accent1', disc: 'bg-accent2 text-accent1', icon: <Spinner className="size-4" /> },
  settled: { rail: 'bg-settled', disc: 'bg-settledTint text-settled', icon: <CircleCheck className="size-4" /> },
  refused: { rail: 'bg-irreversible', disc: 'bg-irreversibleTint text-irreversible', icon: <OctagonX className="size-4" /> },
  warned: { rail: 'bg-exposed', disc: 'bg-exposedTint text-exposed', icon: <TriangleAlert className="size-4" /> },
  noted: { rail: 'bg-neutral3', disc: 'bg-inset text-neutral2', icon: <Info className="size-4" /> },
}

export interface NotificationAction {
  label: string
  onClick: () => void
}

export interface NotificationProps {
  tone: NotificationTone
  title: ReactNode
  description?: ReactNode
  /** A transaction hash, rendered as the explorer link the old toasts discarded. */
  hash?: string | null
  action?: NotificationAction | null
  onDismiss?: () => void
  /** How long this card will live, for the timer rail. `null` = it stays until dismissed. */
  durationMs?: number | null
  /** Offered on refusals, so a failure sentence can leave the screen without being lost. */
  copyText?: string | null
  className?: string
}

/** The explorer link, plus the hash in mono — a claim you can go and check. */
function HashLink({ hash }: { hash: string }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-mono text-neutral2 underline decoration-surface3 underline-offset-4 transition-colors hover:text-neutral1"
    >
      {shortAddress(hash, 8, 6)}
      <ArrowUpRight className="size-3" aria-hidden />
    </a>
  )
}

function CopyDetails({ text }: { text: string }) {
  const { copied, copy } = useCopy()
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      className="inline-flex items-center gap-1 text-buttonLabel4 text-neutral2 transition-colors hover:text-neutral1"
    >
      {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      {copied ? 'Copied' : 'Copy details'}
    </button>
  )
}

export function Notification({
  tone,
  title,
  description,
  hash,
  action,
  onDismiss,
  durationMs,
  copyText,
  className,
}: NotificationProps) {
  const skin = TONE[tone]
  const timed = typeof durationMs === 'number' && durationMs > 0 && Number.isFinite(durationMs)
  return (
    <div
      data-surface="inverted"
      className={cn(
        'relative flex w-full gap-3 overflow-hidden rounded-xl bg-ground py-3 pl-4 pr-3 text-neutral1 shadow-large',
        className,
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', skin.rail)} aria-hidden />

      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-pill', skin.disc)} aria-hidden>
        {skin.icon}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body3 font-medium leading-snug">{title}</p>
        {description ? <p className="text-body4 text-neutral2">{description}</p> : null}
        {hash || action || copyText ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {hash ? <HashLink hash={hash} /> : null}
            {copyText ? <CopyDetails text={copyText} /> : null}
            {action ? (
              <button
                type="button"
                onClick={action.onClick}
                className="rounded-sm bg-inset px-2 py-1 text-buttonLabel4 text-neutral1 transition-colors hover:bg-raisedHovered"
              >
                {action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 size-6 shrink-0 rounded-sm text-neutral3 transition-colors hover:bg-raised hover:text-neutral1"
        >
          <X className="mx-auto size-3.5" aria-hidden />
        </button>
      ) : null}

      {timed ? (
        <span
          className={cn('absolute inset-x-0 bottom-0 h-0.5 origin-left animate-notification-timer', skin.rail)}
          style={{ animationDuration: `${durationMs}ms` }}
          aria-hidden
        />
      ) : null}
    </div>
  )
}
