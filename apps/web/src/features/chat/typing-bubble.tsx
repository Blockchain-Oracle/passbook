// The three dots at the foot of a thread. Sits where their next message will, so the list does not
// jump when the ping turns into a bubble.
import { CHAT_TYPING_LABEL } from '@strk20/protocol/chat-copy'

/**
 * Motion is three staggered dots and nothing else.
 *
 * `animate-pulse` is Tailwind's own keyframe, so this adds no dependency and no custom CSS; the
 * stagger is a negative delay per dot, which starts each one part-way through the same cycle
 * rather than needing three of them. `motion-reduce` drops it to a static row — the label beside
 * it already carries the meaning, so nothing is lost when the animation is off.
 */
export function TypingBubble() {
  return (
    <div className="flex items-center gap-2 self-start" role="status" aria-live="polite">
      <div className="flex items-center gap-1 rounded-xl rounded-bl-sm border bg-surface px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
            style={{ animationDelay: `${i * -0.4}s` }}
          />
        ))}
      </div>
      <span className="text-body4 text-muted-foreground">{CHAT_TYPING_LABEL}</span>
    </div>
  )
}
