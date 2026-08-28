import { createFileRoute, Link } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { getActivity, subscribe } from '@strk20/protocol/activity-store'
import { receiptFor } from '@strk20/protocol/transaction'
import { FEED_UNREAD, RECEIPT_NOT_FOUND } from '@strk20/protocol/activity-copy'

import { ActivityReceipt } from '../components/ActivityReceipt'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/activity/$id')({
  component: Activity,
})

//
// THE DEEP LINK to one receipt. The feed itself opens the same `ActivityReceipt` in a modal
// ([STUDIO] — the detail is a sheet over the record, not a page turn), so this route exists for
// the cases a modal cannot serve: a bookmarked receipt, a pasted link, a refresh.
//
// NO LOADER, DELIBERATELY. `loader: ({ params }) => ({ id: params.id })` read as caution about the
// literal `$id` the build gate visits, but it does nothing `useParams()` does not already do — and
// it costs something: `loader` is one of the router's default code-split groupings, so a loader that
// only forwards a param buys the route an extra chunk to say the same word.
//
// THE RULE IT WAS STANDING IN FOR IS LIVE, and it is the one thing this file must not get wrong:
// an id that does not resolve REPORTS ITSELF IN THE UI and never throws. The gate names
// `/activity/$id` verbatim, so `params.id` really can be the three-character string `"$id"`, and a
// surface that threw on it would ship wearing `__error__`. The resolution is `receiptFor` in
// `packages/protocol` rather than a `find` typed out here, because `vitest.config.ts` collects
// `packages/*/test/**` only — a lookup written in this file is a lookup no runner executes, and
// this is the branch that most needs one.
//
function Activity() {
  const { id } = Route.useParams()
  const { transactions, initialized } = useSyncExternalStore(subscribe, getActivity)
  const view = receiptFor(transactions, id, initialized)

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-s12">
        {view.state === 'found' ? (
          <ActivityReceipt transaction={view.transaction} />
        ) : (
          <>
            <h1 className="display text-display3 text-neutral1">The record</h1>
            {/*
              TWO SENTENCES FOR TWO FACTS, and they must not be merged. Before a read has run, an id
              we cannot find has not been looked for — saying "no such entry" would be a claim about
              the record. After a read, it genuinely is not in the range that was loaded, which is a
              different thing again from not existing.
            */}
            <p className="text-body3 text-neutral2">
              {view.state === 'not-found' ? RECEIPT_NOT_FOUND : FEED_UNREAD}
            </p>
            <p className="text-body4 font-mono text-neutral3">{id}</p>
          </>
        )}

        <p className="text-body4">
          <Link to="/wallet" className="focus-ring">
            Back to the record
          </Link>
        </p>
      </div>
    </Surface>
  )
}
