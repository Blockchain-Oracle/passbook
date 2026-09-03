//
// Mail's reads: the threads this account can rebuild from the chain, and nothing else.
//
// Dependent on `shieldedQuery` through the client, so the walk that prices the balance is the
// walk that names the notes memos ride with — one moment, both views. Keyed under `['shielded']`
// so `invalidateMoney` after a send refreshes it without a second list to remember.
//
import { queryOptions, skipToken, useQuery } from '@tanstack/react-query'
import { NET } from '@strk20/protocol/constants'
import type { MailItem, MailThread } from '@strk20/protocol/mail-discover'
import { sameAddress } from '@strk20/protocol/address'

import { queryClient } from '@/app/query-client'
import { useSession } from '@/app/session'
import { appContracts } from '@/queries/app'
import { shieldedQuery } from '@/queries/shielded'

const MAIL_MS = 20_000

export interface MailRead {
  items: MailItem[]
  threads: MailThread[]
  /** The height the walk and the scan were read beside. */
  blockNumber: number
  /** False when the scan hit its page cap: the newest memos may be missing, and the list says so. */
  complete: boolean
}

/** The Mailbox this build posts to, or `null` before it is deployed — Mail refuses to compose then. */
export function mailbox(): { address: string; fromBlock: number } | null {
  const { mailbox, mailboxBlock } = appContracts()
  return mailbox ? { address: mailbox, fromBlock: mailboxBlock ?? 0 } : null
}

export function mailQuery(address: string | undefined, accountKey: string | undefined) {
  const box = mailbox()
  return queryOptions({
    queryKey: ['shielded', address ?? null, 'mail', box?.address ?? null],
    queryFn:
      address && accountKey && box
        ? async (): Promise<MailRead> => {
            const read = await queryClient.fetchQuery(shieldedQuery(address, accountKey))
            if (read.state !== 'walked') throw new Error(`Mail could not be read: ${read.reason}`)
            const [{ readMailEvents }, { discoverMail, mailThreads }] = await Promise.all([
              import('@strk20/protocol/mail-events'),
              import('@strk20/protocol/mail-discover'),
            ])
            const page = await readMailEvents({ mailbox: box.address, fromBlock: box.fromBlock, toBlock: read.blockNumber })
            const items = await discoverMail({
              context: { chainId: NET.chainId, pool: NET.pool, mailbox: box.address },
              registry: read.registry,
              held: read.notes,
              posted: page.posted,
            })
            return { items, threads: mailThreads(items), blockNumber: read.blockNumber, complete: page.complete }
          }
        : skipToken,
    staleTime: MAIL_MS,
    refetchInterval: MAIL_MS,
  })
}

/** The session's mail, or an idle query when there is no open account. */
export function useMail() {
  const session = useSession()
  const ready = session.status === 'ready' && session.address && session.accountKey ? { address: session.address, accountKey: session.accountKey } : null
  const query = useQuery(mailQuery(ready?.address, ready?.accountKey))
  return { ready, query }
}

/** One peer's thread out of the read — empty, not absent, for a peer nothing has passed with yet. */
export function threadFor(read: MailRead | undefined, peer: string): MailThread {
  return read?.threads.find((t) => sameAddress(t.peer, peer)) ?? { peer, items: [], lastBlock: 0 }
}
