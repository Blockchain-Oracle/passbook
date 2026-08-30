//
// The three steps of the boundary, one band each, each with the screen that does it.
//
// ── WHY EACH STEP NAMES WHAT BECOMES PUBLIC ──────────────────────────────────────────────
//
// Every privacy product draws this diagram and every one of them describes what is hidden. Saying
// what is VISIBLE, in the same breath and in the same type size, is the only version of this
// section worth shipping from a page whose next band is a list of sentences we refuse to write.
// It is also the harder half to write, which is roughly the point.
//
import { Band, Inner } from './Band'
import { MockScreen } from './MockScreen'

interface Step {
  readonly n: string
  readonly title: string
  readonly body: string
  readonly seen: string
  readonly src: string
  readonly w: number
  readonly h: number
  readonly tone: 'light' | 'dark'
}

const STEPS: readonly Step[] = [
  {
    n: '01',
    title: 'Shield in',
    body: 'Move public tokens into the pool. They stop being a balance at an address and become notes, spent with your key.',
    seen: 'Public: that this address deposited, and how much. The screen that does it says so before you do.',
    src: '/mock-wallet.html',
    w: 1180,
    h: 760,
    tone: 'light',
  },
  {
    n: '02',
    title: 'Act inside',
    body: 'Send, swap, bet, launch a token, vote in a House. All of it from notes rather than from an address, and all of it the same account.',
    seen: 'Public: that a transaction of this size happened, and when. Not public: which note paid, or that it was yours.',
    src: '/mock-market.html',
    w: 1180,
    h: 700,
    tone: 'dark',
  },
  {
    n: '03',
    title: 'Take it out',
    body: 'Unshield to an ordinary Starknet address, or bridge shielded USDC to another chain. The door out sits beside the door in.',
    seen: 'Public: the destination, the amount, the timing. Not public: which note funded it.',
    src: '/mock-unshield.html',
    w: 1180,
    h: 700,
    tone: 'light',
  },
]

function StepBand({ step }: { readonly step: Step }) {
  return (
    <Band tone={step.tone} className="py-s60">
      <Inner className="grid items-center gap-s40 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-s12">
          <span className="kicker text-[color:var(--ink3)]">Step {step.n}</span>
          <h2 className="display m-0 text-display2 xl:text-display1">{step.title}</h2>
          <p className="m-0 text-body2 text-[color:var(--ink2)]">{step.body}</p>
          {/*
            `--warn`, not `exposed`. It is the same warning in both bands and has to LOOK like the
            same warning, but the literal token is a bright yellow sized for near-black: measured
            against the light band it lands at 1.22:1, which is not a soft style, it is text nobody
            can read. The band publishes a darkened amber for that side at 6.32:1.
          */}
          <p className="m-0 border-l-2 border-[color:var(--warn)] pl-s12 text-body4 text-[color:var(--warn)]">
            {step.seen}
          </p>
        </div>
        <div className="overflow-hidden rounded-[12px] border border-[color:var(--line)] bg-ground shadow-[0_24px_64px_rgba(0,0,0,0.35)]">
          <MockScreen src={step.src} width={step.w} height={step.h} />
        </div>
      </Inner>
    </Band>
  )
}

export function Walkthrough() {
  return (
    <>
      <Band tone="dark" className="pb-s24 pt-s60">
        <Inner className="flex flex-col gap-s16">
          <span className="kicker">How the boundary works</span>
          <p className="display m-0 max-w-[20ch] text-display2 xl:text-display1">
            Public in. Private through. <span className="text-accent1">Public out.</span>
          </p>
          <p className="m-0 max-w-[62ch] text-body3 text-[color:var(--ink2)]">
            Three moments, and each one is drawn from this repository&rsquo;s own design tokens —
            not a screenshot, and not a live read. The balances are the ones a new account actually
            lands with.
          </p>
        </Inner>
      </Band>
      {STEPS.map((step) => (
        <StepBand key={step.n} step={step} />
      ))}
    </>
  )
}
