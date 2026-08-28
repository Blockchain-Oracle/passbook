import { createFileRoute } from '@tanstack/react-router'

import {
  LAUNCH_BUYER_HIDDEN,
  LAUNCH_EPOCH_FACT,
  LAUNCH_GRADUATION,
  LAUNCH_NONE_OPEN,
  LAUNCH_NOT_DEPLOYED,
  LAUNCH_REFUND,
  LAUNCH_STANDING_LINE,
  LAUNCH_TITLE,
} from '@strk20/protocol/markets-copy'

import { Text } from '../components/ui/Text'
import { cn } from '../lib/cn'
import { LAUNCH_DEPLOYED } from '../shell/app-contracts'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/launch')({
  component: Launch,
})

//
// LAUNCH — the surface, and the three contract facts it exists to teach.
//
// ── WHY THIS SHOWS RULES AND NOT A FAKE SALE ─────────────────────────────────────────────
//
// `launch.cairo` is written, tested and committed; it is not deployed. A card grid of invented
// tokens with plausible progress bars would look exactly like a working product in a screenshot,
// which is precisely why it is not here. What IS here is the mechanism — because the mechanism is
// the differentiator, it is true before any deployment, and it is the part a reader most needs
// explained before the first real launch appears.
//
// ── THE EPOCH RULE IS THE HEADLINE, AND IT CONTRADICTS EVERY OTHER LAUNCH ────────────────
//
// Everyone inside an epoch pays the same price, so being first inside one is worth NOTHING. Every
// other launch mechanism a reader has met rewards racing — bots, gas auctions, sniping — so this
// has to be said in the words that contradict that expectation rather than in the language of a
// pricing curve, which reads as the same thing with extra steps.
//
function Launch() {
  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s16">
        <header className="flex flex-col gap-s8 border-b border-solid border-surface3 pb-s12">
          <Text variant="kicker">06 — issuance</Text>
          <Text variant="display2" as="h1" className="text-neutral1 lg:text-display1">
            {LAUNCH_TITLE}
          </Text>
          <Text variant="body3" className="max-w-[70ch] text-neutral2">
            {LAUNCH_STANDING_LINE}
          </Text>
        </header>

        {/*
          THE ABSENCE, FIRST AND PLAINLY. It leads rather than sitting under the explanation
          because a reader arriving at an empty grid deserves to know why before they are taught
          how it works — the alternative reads as a product hiding its own emptiness behind copy.
        */}
        <section className="rounded-large border border-solid border-surface3 p-s16">
          <Text variant="subheading2" as="h2">
            {LAUNCH_DEPLOYED ? 'Nothing open' : 'Not open yet'}
          </Text>
          <Text variant="body3" className="mt-s4 max-w-[70ch] text-neutral2">
            {LAUNCH_DEPLOYED ? LAUNCH_NONE_OPEN : LAUNCH_NOT_DEPLOYED}
          </Text>
        </section>

        {/*
          The card grid the launches will fill. Rendered as the RULES today — same geometry, real
          content — so the layout is proven against real text rather than against a placeholder
          that turns out to be the wrong shape the day it holds a token.
        */}
        <div className="grid gap-s12 md:grid-cols-2 lg:grid-cols-3">
          <RuleCard
            title="Being early inside an epoch is worth nothing"
            body={LAUNCH_EPOCH_FACT}
            mark={<EpochLadder />}
          />
          <RuleCard title="The price is public, the buyers are not" body={LAUNCH_BUYER_HIDDEN} />
          <RuleCard
            title="It graduates, or it refunds"
            body={`${LAUNCH_GRADUATION} ${LAUNCH_REFUND}`}
          />
        </div>
      </div>
    </Surface>
  )
}

function RuleCard({
  title,
  body,
  mark,
}: {
  title: string
  body: string
  mark?: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16',
        'transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide',
        'hover:bg-inset',
      )}
    >
      {mark}
      <Text variant="body2" className="font-medium">
        {title}
      </Text>
      <Text variant="body3" className="text-neutral2">
        {body}
      </Text>
    </section>
  )
}

/**
 * The epoch ladder, drawn.
 *
 * A STAIRCASE AND NOT A CURVE, which is the entire point: a smooth line would say "the price rises
 * as people buy", which is what every bonding curve does and what makes racing pay. Flat treads
 * with hard risers say the true thing — inside a step the price does not move at all, so there is
 * nothing to win by being first into one.
 *
 * Illustrative geometry, carrying no numbers. It is a diagram of a rule, not a chart of a sale, and
 * putting axis values on it would be inventing a launch that does not exist.
 */
function EpochLadder() {
  const steps = [0, 1, 2, 3, 4]
  return (
    <svg
      viewBox="0 0 120 48"
      className="h-[48px] w-full text-accent1"
      fill="none"
      role="img"
      aria-label="A staircase: the price is flat within each epoch and steps up between them"
    >
      {steps.map((i) => {
        const x = 4 + i * 23
        const y = 40 - i * 8
        return (
          <g key={i}>
            {/* The tread — flat, and it is the part that matters. */}
            <path
              d={`M${x} ${y} h20`}
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            {/* The riser, dashed so the eye reads the treads as the price and the jump as an event. */}
            {i < steps.length - 1 ? (
              <path
                d={`M${x + 20} ${y} V${y - 8}`}
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.5"
              />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
