//
// The small branded door a shared payment request opens.
//
// This is intentionally not the wallet's Receive panel turned around. A recipient asked for a
// payment; the payer needs to verify who, what and why, then enter Send with those exact values.
// The route remains `/pay/$address` for backward compatibility, but the parameter now accepts an
// address or an explicit `@name`. Resolution is local against the downloaded directory.
//
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo } from 'react'

import {
  parsePayLinkSearch,
  parseRecipientReference,
  resolveRecipientReference,
} from '@strk20/protocol/pay-link'

import { IdentityDisc } from '../components/IdentityDisc'
import { Text } from '../components/ui/Text'
import { shortenFelt } from '../shell/session'
import { useDirectory } from '../shell/use-directory'
import { Surface } from '../shell/Surface'

interface RawPaySearch {
  asset?: string
  amount?: string
  note?: string
}

export const Route = createFileRoute('/pay/$address')({
  // Keep malformed scalar values long enough to render a refusal. Silently deleting `asset=ETH`
  // would turn a bad USDC/STRK request into an open-ended one, changing what the recipient asked.
  validateSearch: (search: Record<string, unknown>): RawPaySearch => ({
    ...(typeof search.asset === 'string' ? { asset: search.asset } : {}),
    ...(typeof search.amount === 'string' ? { amount: search.amount } : {}),
    ...(typeof search.note === 'string' ? { note: search.note } : {}),
  }),
  component: Pay,
})

function Pay() {
  const { address: rawRecipient } = Route.useParams()
  const rawSearch = Route.useSearch()
  const directory = useDirectory()
  const request = useMemo(() => parsePayLinkSearch(rawSearch), [rawSearch])
  const reference = useMemo(() => parseRecipientReference(rawRecipient), [rawRecipient])
  const resolved = useMemo(
    () => resolveRecipientReference(rawRecipient, directory.entries),
    [rawRecipient, directory.entries],
  )

  if (!request.ok) {
    return <PayRefusal title="This payment request is not valid" detail={request.because} />
  }

  if (!reference.ok) {
    return <PayRefusal title="This link does not name a recipient" detail={reference.because} />
  }

  if (reference.value.kind === 'name' && directory.loading) {
    return (
      <PayState
        title={`Finding ${reference.value.display}`}
        detail="Reading the public directory in this browser…"
      />
    )
  }

  if (reference.value.kind === 'name' && directory.problem) {
    return (
      <PayRefusal
        title={`Could not resolve ${reference.value.display}`}
        detail="The directory could not be loaded. Ask the recipient for their Starknet address rather than guessing."
      />
    )
  }

  if (!resolved.ok) {
    return <PayRefusal title="This recipient could not be resolved" detail={resolved.because} />
  }

  const display = resolved.name ? `@${resolved.name}` : shortenFelt(resolved.address, 12, 10)
  const requestRecipient = resolved.name ? `@${resolved.name}` : resolved.address

  return (
    <Surface routeId={Route.fullPath}>
      <main className="mx-auto flex min-h-[min(680px,calc(100dvh-180px))] w-full max-w-[720px] flex-col justify-center gap-s20">
        <header className="flex flex-col gap-s8 border-b-2 border-solid border-neutral1 pb-s16">
          <Text variant="kicker">Passbook · private payment</Text>
          <Text variant="display1" as="h1" className="max-w-[10ch] text-neutral1">
            {resolved.name ? `${display} requested a payment` : 'You received a payment request'}
          </Text>
        </header>

        <section className="grid min-w-0 grid-cols-1 overflow-hidden rounded-large border-2 border-solid border-neutral1 bg-raised sm:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-s16 p-s20 sm:p-s24">
            <div className="flex items-center gap-s12">
              <IdentityDisc address={resolved.address} size={48} />
              <div className="min-w-0">
                <Text variant="body2" className="truncate text-neutral1">
                  {display}
                </Text>
                <Text variant="mono" className="truncate text-neutral3">
                  {resolved.address}
                </Text>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-s8 border-y border-solid border-surface3 py-s16">
              <RequestFact label="Asset" value={request.value.asset ?? 'Choose in Send'} />
              <RequestFact label="Amount" value={request.value.amount ?? 'Open amount'} />
            </div>

            {request.value.note ? (
              <div className="flex flex-col gap-s4">
                <Text variant="kicker">Note · not on chain</Text>
                <Text variant="body2" className="break-words text-neutral1">
                  {request.value.note}
                </Text>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-center bg-accent1 p-s20 text-ground sm:w-[190px]">
            <span className="font-display text-[72px] leading-none" aria-hidden="true">
              ↗
            </span>
          </div>
        </section>

        <Text variant="body4" className="max-w-[62ch] text-neutral2">
          Continue to verify the resolved address, shielded balance and privacy boundary before
          signing. The request note is context only; it is not included in the chain transaction.
        </Text>

        <Link
          to="/send"
          search={{ to: requestRecipient, ...request.value }}
          className="cta focus-ring flex min-h-s56 w-full items-center justify-center rounded-control bg-accent1 px-s20 text-buttonLabel2 text-ground"
        >
          Review in Send
        </Link>
      </main>
    </Surface>
  )
}

function RequestFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-s4">
      <Text variant="kicker">{label}</Text>
      <Text variant="heading3" className="numeric truncate text-neutral1">
        {value}
      </Text>
    </div>
  )
}

function PayState({ title, detail }: { title: string; detail: string }) {
  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex min-h-[440px] w-full max-w-[640px] flex-col justify-center gap-s12">
        <Text variant="kicker">Passbook · payment request</Text>
        <Text variant="display2" as="h1" className="text-neutral1">
          {title}
        </Text>
        <Text variant="body3" className="max-w-[58ch] text-neutral2">
          {detail}
        </Text>
      </div>
    </Surface>
  )
}

function PayRefusal({ title, detail }: { title: string; detail: string }) {
  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex min-h-[440px] w-full max-w-[640px] flex-col justify-center gap-s12">
        <Text variant="kicker">Passbook · request refused</Text>
        <Text variant="display2" as="h1" className="text-neutral1">
          {title}
        </Text>
        <Text variant="body3" className="max-w-[58ch] text-neutral2">
          {detail}
        </Text>
        <Link
          to="/send"
          className="focus-ring mt-s8 w-fit rounded-control text-body3 text-accent1 underline underline-offset-2"
        >
          Enter a recipient by hand
        </Link>
      </div>
    </Surface>
  )
}
