//
// The mail surface: threads on the left, the route's child (index or a thread) on the right.
// Below `@3xl` the two panes become one: the list is the page, and a thread replaces it.
// `min-h-0` and `min-w-0` at every level are what keep the message list scrolling inside itself
// and a long address from widening the phone. Nothing here holds a socket: there is none.
//
import { useMemo, type ReactNode } from 'react'
import { MAIL_COST_NOTE, MAIL_HISTORY_IS_CHAIN, MAIL_IS_A_TRANSACTION, MAIL_TITLE } from '@strk20/protocol/mail-copy'

import { useSession } from '@/app/session'
import { Page } from '@/components/layout/page'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useIdentities } from '@/queries/identity'

import { NewMailDialog } from './new-mail-dialog'
import { ThreadList } from './thread-list'
import { mailbox, useMail } from './use-mail'

export interface MailShellProps {
  /** The `$peer` param when a thread route is active; `null` on the index. */
  activePeer: string | null
  children: ReactNode
}

export function MailShell({ activePeer, children }: MailShellProps) {
  const session = useSession()
  const { ready, query } = useMail()
  const threads = query.data?.threads ?? []
  const peers = useMemo(() => threads.map((t) => t.peer), [threads])
  const identities = useIdentities(peers)
  const threadOpen = activePeer !== null
  const box = mailbox()

  return (
    <Page
      kicker="Venues"
      title={MAIL_TITLE}
      className="min-h-0 max-w-6xl flex-1 gap-4"
      headerClassName={cn(threadOpen && 'hidden @3xl:flex')}
      actions={ready && box ? <NewMailDialog address={ready.address} /> : null}
    >
      {!ready ? (
        <p className="text-body3 text-muted-foreground">
          {session.status === 'booting' ? 'Opening your account…' : 'Mail needs an open account. Unlock or create one first.'}
        </p>
      ) : !box ? (
        <p className="text-body3 text-muted-foreground">The Mailbox contract is not deployed for this build yet, so there is no mail to read or send.</p>
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 gap-4 @3xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <aside className={cn('flex min-h-0 min-w-0 flex-col', threadOpen && 'hidden @3xl:flex')}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
              {query.isPending ? (
                <p className="flex items-center gap-2 text-body3 text-muted-foreground">
                  <Spinner /> Reading the chain…
                </p>
              ) : query.isError ? (
                <p className="text-body3 text-irreversible">{query.error.message}</p>
              ) : (
                <ThreadList address={ready.address} threads={threads} identities={identities} activePeer={activePeer} />
              )}
              {/* The three sentences scroll WITH the list rather than under it — a fixed footer on a
                  640px phone is how copy gets cut. */}
              <div className="flex flex-col gap-2 pb-1 text-body4 text-muted-foreground">
                <p>{MAIL_IS_A_TRANSACTION}</p>
                <p>{MAIL_HISTORY_IS_CHAIN}</p>
                <p>{MAIL_COST_NOTE}</p>
              </div>
            </div>
          </aside>
          <div className={cn('flex min-h-0 min-w-0 flex-col', !threadOpen && 'hidden @3xl:flex')}>{children}</div>
        </div>
      )}
    </Page>
  )
}
