import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { StageKey } from '@strk20/protocol/onboarding-copy'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Stage, StageStrip } from './stage'

export type Step = 'fork' | 'import' | 'teach' | 'name' | 'custody' | 'backup' | 'fund' | 'register'

/** The numbered steps; `fork`/`import` sit before the count starts. */
export const NUMBERED: readonly Step[] = ['teach', 'name', 'custody', 'backup', 'fund', 'register']
export const KEYED: readonly Step[] = ['backup', 'fund', 'register']

interface FrameProps {
  screen: StageKey
  step: Step | null
  address?: string | null
  onBack?: () => void
  onSkip?: () => void
  children: ReactNode
}

const PANEL = {
  enter: { opacity: 0, x: 28 },
  shown: { opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.17, 0.67, 0.45, 1] as const } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.16 } },
}

/**
 * Two halves. The stage (dark, the mark counting steps) performs; the card (paper) asks. Base UI's
 * Dialog owns role, aria-modal, the focus trap and the scroll lock; this only fills the screen.
 */
export function Frame({ screen, step, address = null, onBack, onSkip, children }: FrameProps) {
  const index = step ? NUMBERED.indexOf(step) : -1
  const done = index < 0 ? 0 : index
  const still = useReducedMotion()

  return (
    <Dialog open modal disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 z-[60] grid h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 grid-cols-1 gap-0 overflow-hidden rounded-none border-0 p-0 ring-0 sm:max-w-none lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      >
        <DialogTitle className="sr-only">Set up your wallet</DialogTitle>

        <div className="hidden min-h-0 lg:block">
          <Stage screen={screen} done={done} address={address} />
        </div>

        <section className="flex min-h-0 flex-col overflow-y-auto border-border bg-card text-foreground lg:border-l">
          <div className="lg:hidden">
            <StageStrip screen={screen} done={done} />
          </div>
          <header className="flex items-center justify-between gap-3 px-4 pt-4 md:px-8 md:pt-6">
            <span className="font-display text-display4 lg:invisible">
              strk20<span className="text-primary">.run</span>
            </span>
            <div className="flex items-center gap-2">
              {onBack ? (
                <Button variant="ghost" size="sm" onClick={onBack}>
                  <ArrowLeft data-icon="inline-start" />
                  Back
                </Button>
              ) : null}
              {onSkip ? (
                <Button variant="ghost" size="sm" onClick={onSkip}>
                  Skip for now
                </Button>
              ) : null}
            </div>
          </header>

          {/* `my-auto`, not `justify-center`: a centred flex child that overflows clips its top; auto margins do not */}
          <div className="mx-auto my-auto w-full max-w-xl px-4 py-8 md:px-8 md:py-12">
            {index >= 0 ? (
              <p className="mb-6 font-mono text-kicker uppercase tracking-[0.16em] text-muted-foreground">
                Step {index + 1} of {NUMBERED.length}
              </p>
            ) : null}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={screen}
                variants={PANEL}
                initial={still ? false : 'enter'}
                animate="shown"
                exit={still ? undefined : 'exit'}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
