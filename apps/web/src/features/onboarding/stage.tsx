import { useIsMutating } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { STAGE_LINES, STAGE_TICK, type StageKey } from '@strk20/protocol/onboarding-copy'

import { StageBits } from './stage-bits'

// The stage is the brand's own ground in either theme, so these are artwork colours, not tokens.
const GROUND = '#0A0A0A'
const INK = '#F1F0EB'
const INK3 = '#6D6C67'
const ACCENT = '#E04708'
const DIM = 'rgba(241,240,235,0.14)'

/** Five plain arms in step order, then the arrow arm — six arms for six steps. */
const ARMS = [180, 240, 300, 60, 120] as const
const R = 160
const RA = 196
const C = 256
const point = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.cos(a), C - r * Math.sin(a)]
}

const DRAW = { duration: 0.55, ease: [0.17, 0.67, 0.45, 1] as const }

/**
 * The mark as a progress meter: every completed step lights one arm orange; the arrow arm is the
 * last. While a transaction is in flight the arrow runs in place.
 */
export function StageMark({ done, running, className }: { done: number; running: boolean; className?: string }) {
  const still = useReducedMotion()
  const lit = (i: number) => i < done
  const arm = (i: number, deg: number) => {
    const [x, y] = point(R, deg)
    return { x1: C, y1: C, x2: x, y2: y, key: i }
  }
  const [ax, ay] = point(RA, 0)
  const arrowLit = lit(5)

  return (
    <svg viewBox="0 0 512 512" aria-hidden className={className}>
      <g transform="translate(-18 0)" fill="none" strokeWidth="68" strokeLinecap="round" strokeLinejoin="round">
        {/* the whole asterisk, faint, so the shape is there before any step is — one path, so the
            translucent arms do not stack into a bright dot where they meet */}
        <path
          stroke={DIM}
          d={[
            ...ARMS.map((deg, i) => {
              const a = arm(i, deg)
              return `M ${a.x1} ${a.y1} L ${a.x2} ${a.y2}`
            }),
            `M ${C} ${C} L ${ax} ${ay}`,
            `M ${ax - 58} ${ay - 58} L ${ax} ${ay} L ${ax - 58} ${ay + 58}`,
          ].join(' ')}
        />
        {/* the arms earned so far, drawn from the centre outward */}
        <g stroke={ACCENT}>
          {ARMS.map((deg, i) =>
            lit(i) ? (
              <motion.line
                key={i}
                x1={C}
                y1={C}
                x2={arm(i, deg).x2}
                y2={arm(i, deg).y2}
                initial={still ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={DRAW}
              />
            ) : null,
          )}
          <motion.g
            animate={running && !still ? { x: [0, 14, 0] } : { x: 0 }}
            transition={running ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
          >
            {arrowLit ? (
              <>
                <motion.line x1={C} y1={C} x2={ax} y2={ay} initial={still ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={DRAW} />
                <motion.path
                  d={`M ${ax - 58} ${ay - 58} L ${ax} ${ay} L ${ax - 58} ${ay + 58}`}
                  initial={still ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ ...DRAW, delay: 0.35 }}
                />
              </>
            ) : running ? (
              <path d={`M ${ax - 58} ${ay - 58} L ${ax} ${ay} L ${ax - 58} ${ay + 58}`} stroke={ACCENT} opacity={0.6} />
            ) : null}
          </motion.g>
        </g>
      </g>
    </svg>
  )
}

/** The phone's stage: the mark and the line side by side in a dark strip above the card. */
export function StageStrip({ screen, done }: { screen: StageKey; done: number }) {
  // Three hooks, always all three — `a || useX()` would skip hooks and break React's order.
  const minting = useIsMutating({ mutationKey: ['generate-key'] }) > 0
  const deploying = useIsMutating({ mutationKey: ['deploy-account'] }) > 0
  const registering = useIsMutating({ mutationKey: ['register'] }) > 0
  const running = minting || deploying || registering
  const lines = STAGE_LINES[screen]
  return (
    <div className="relative flex items-center gap-4 overflow-hidden px-4 py-4" style={{ background: GROUND, color: INK }}>
      <StageBits active={minting} color={ACCENT} />
      <StageMark done={done} running={running} className="relative size-20 shrink-0" />
      <AnimatePresence mode="wait" initial={false}>
        <motion.h2
          key={screen}
          className="relative m-0 font-display text-display3 leading-[0.95]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
        >
          {lines.map((line, i) =>
            line ? (
              <span key={i} className={i === 1 ? 'block' : 'inline'} style={i === 1 ? { color: ACCENT } : undefined}>
                {line}{i === 0 ? ' ' : ''}
              </span>
            ) : null,
          )}
        </motion.h2>
      </AnimatePresence>
    </div>
  )
}

const LINE = {
  hidden: { opacity: 0, y: 18 },
  shown: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.07, duration: 0.4, ease: [0.17, 0.67, 0.45, 1] as const } }),
  gone: { opacity: 0, y: -12, transition: { duration: 0.18 } },
}

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

interface StageProps {
  screen: StageKey
  done: number
  address: string | null
}

/** The dark half of the onboarding: the mark as progress, the line for this screen, the tick. */
export function Stage({ screen, done, address }: StageProps) {
  // Three hooks, always all three — `a || useX()` would skip hooks and break React's order.
  const minting = useIsMutating({ mutationKey: ['generate-key'] }) > 0
  const deploying = useIsMutating({ mutationKey: ['deploy-account'] }) > 0
  const registering = useIsMutating({ mutationKey: ['register'] }) > 0
  const running = minting || deploying || registering
  const lines = STAGE_LINES[screen]
  const still = useReducedMotion()

  return (
    <aside
      className="relative flex h-full flex-col justify-between overflow-hidden p-8 lg:p-12"
      style={{ background: GROUND, color: INK }}
    >
      <StageBits active={minting && !still} color={ACCENT} />

      <div className="relative flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md" style={{ background: '#C53603' }}>
          <StageMark done={6} running={false} className="size-5" />
        </span>
        <span className="font-display text-display4">
          strk20<span style={{ color: ACCENT }}>.run</span>
        </span>
      </div>

      {/* sized off the viewport height so a short window shrinks the stage instead of clipping it */}
      <div className="relative flex min-h-0 flex-col gap-[3vh]">
        <StageMark done={done} running={running} className="size-[clamp(88px,24vh,208px)]" />
        <AnimatePresence mode="wait" initial={false}>
          <motion.h2 key={screen} className="m-0 font-display text-[clamp(28px,5.4vh,62px)] leading-[0.92]" aria-live="polite">
            {lines.map((line, i) =>
              line ? (
                <motion.span
                  key={`${screen}-${i}`}
                  custom={i}
                  variants={LINE}
                  initial={still ? false : 'hidden'}
                  animate="shown"
                  exit="gone"
                  className="block"
                  style={i === 1 ? { color: ACCENT, paddingLeft: '0.35em' } : undefined}
                >
                  {line}
                </motion.span>
              ) : null,
            )}
          </motion.h2>
        </AnimatePresence>
      </div>

      <div className="relative flex items-center justify-between gap-4 font-mono text-mono" style={{ color: INK3 }}>
        <span className="uppercase tracking-[0.12em]">No login · No seed phrase</span>
        <span className="flex items-center gap-2">
          {address ? (
            <span style={{ color: INK }}>{truncate(address)}</span>
          ) : (
            <>
              <span>{STAGE_TICK[0]}</span>
              <span aria-hidden style={{ color: ACCENT }}>
                →
              </span>
              <span style={{ color: INK }}>{STAGE_TICK[1]}</span>
            </>
          )}
        </span>
      </div>
    </aside>
  )
}
