//
// The composer's state: the words, the money, one optional attachment, and the review that turns
// them into a transaction. Money is reviewed before it moves, here as everywhere else in the app.
//
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { mailBodyBytes, type MailBody } from '@strk20/protocol/mail-body'
import { MAIL_PEER_SELF, MAIL_PEER_UNREGISTERED, MAIL_REVIEW_TITLE, MAIL_SEND_CTA, MAIL_TOO_LONG } from '@strk20/protocol/mail-copy'
import { MAX_MAIL_PLAINTEXT_BYTES } from '@strk20/protocol/mail-envelope'
import { mailPostageWei } from '@strk20/protocol/send-mail'
import type { PositionShare } from '@strk20/protocol/position-share'
import type { PayAsset } from '@strk20/protocol/pay-link'

import { Amount } from '@/components/money/amount'
import { OperationPipeline } from '@/components/money/operation-pipeline'
import { useRefusal } from '@/components/money/refusal'
import { ReviewSheet } from '@/components/money/review-sheet'
import { recipientRouteQuery } from '@/features/send/queries'
import { handleLabel } from '@/lib/format'
import { usePipeline } from '@/mutations'
import { useIdentity } from '@/queries/identity'

import { AmountDialog, type MailMoney } from './amount-dialog'
import { AskDialog, type Attachment } from './attachment'
import { Composer } from './composer'
import { ShareHandleDialog } from '@/components/share/share-handle-dialog'
import { ShareMarketDialog } from '@/components/share/share-market-dialog'
import { mailbox } from './use-mail'
import { useSendMail } from './use-send-mail'

const MAIL_DISCLOSURE = disclosureFor('mail')
const POSTAGE_STRK: MailMoney = { token: STRK_TOKEN, symbol: 'STRK', decimals: 18, wei: mailPostageWei(18), amountText: '0.01', postage: true }

/** What the thread shows as pending while the transaction proves and lands. */
export interface ComposerSeed {
  text: string
  kindLabel: string
}

function bodyOf(text: string, attachment: Attachment | null): MailBody | null {
  const t = text.trim()
  if (!attachment) return t ? { kind: 'text', text: t } : null
  const withText = t ? { text: t } : {}
  switch (attachment.kind) {
    case 'request':
      return { kind: 'request', amount: attachment.amountText, symbol: attachment.symbol, token: attachment.token, ...withText }
    case 'handle':
      return { kind: 'handle', handle: attachment.handle, houseId: attachment.houseId, houseName: attachment.houseName, ...withText }
    case 'market':
      return { kind: 'market', share: attachment.share, ...withText }
  }
}

const KIND_LABEL: Record<Attachment['kind'], string> = { request: 'An ask', handle: 'A voter handle', market: 'A finished bet' }

export interface MailComposerPanelProps {
  peer: string
  self: boolean
  /** From an ask in the thread: opens the amount dialog already holding the numbers. */
  seed: { asset?: PayAsset; amount?: string } | null
  onSeedUsed: () => void
  onPending: (seed: ComposerSeed | null) => void
  onSent: () => void
}

export function MailComposerPanel({ peer, self, seed, onSeedUsed, onPending, onSent }: MailComposerPanelProps) {
  const identity = useIdentity(peer)
  const route = useQuery(recipientRouteQuery(self ? null : peer))
  const { sendMail, busy } = useSendMail()
  const pipeline = usePipeline()
  const { refusal, refuse, clear } = useRefusal()
  const [draft, setDraft] = useState('')
  const [money, setMoney] = useState<MailMoney | null>(null)
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [dialog, setDialog] = useState<'amount' | 'request' | 'handle' | 'market' | null>(seed ? 'amount' : null)
  const [reviewing, setReviewing] = useState(false)

  const body = useMemo(() => bodyOf(draft, attachment), [draft, attachment])
  const bytes = body ? mailBodyBytes(body) : 0
  const carried = money ?? POSTAGE_STRK
  const box = mailbox()

  const blocker = self
    ? MAIL_PEER_SELF
    : !box
      ? 'This build has no Mailbox yet'
      : route.isPending
        ? 'Checking the recipient'
        : route.isError || !route.data
          ? 'The recipient could not be checked'
          : route.data.route === 'unregistered'
            ? MAIL_PEER_UNREGISTERED
            : route.data.route === 'blocked-rpc-unknown'
              ? 'The recipient could not be checked'
              : !body
                ? 'Write something'
                : bytes > MAX_MAIL_PLAINTEXT_BYTES
                  ? MAIL_TOO_LONG
                  : null

  const reset = () => {
    setDraft('')
    setMoney(null)
    setAttachment(null)
  }

  async function confirm(sponsored: boolean) {
    if (!body || blocker) return
    clear()
    onPending({ text: draft.trim(), kindLabel: attachment ? KIND_LABEL[attachment.kind] : '' })
    const sent = await sendMail({ peer, token: carried.token, symbol: carried.symbol, amount: carried.wei, body, sponsored, onRefused: refuse })
    // A refusal KEEPS THE SHEET OPEN, red, against the button that caused it.
    if (!sent) {
      onPending(null)
      return
    }
    setReviewing(false)
    reset()
    onSent()
  }

  return (
    <>
      <Composer
        draft={draft}
        onDraft={setDraft}
        bytes={bytes}
        money={money}
        onEditMoney={() => setDialog('amount')}
        onClearMoney={() => setMoney(null)}
        attachment={attachment}
        onAttach={setDialog}
        onRemoveAttachment={() => setAttachment(null)}
        onSubmit={() => {
          if (!blocker) setReviewing(true)
        }}
        blocker={blocker}
        busy={busy}
      />

      {/* Keyed on the seed: the form's initial values are read once, so a new prefill needs a new form. */}
      <AmountDialog
        key={JSON.stringify(seed)}
        open={dialog === 'amount'}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null)
            onSeedUsed()
          }
        }}
        peer={peer}
        seed={seed ?? undefined}
        onPick={setMoney}
      />
      <AskDialog open={dialog === 'request'} onOpenChange={(open) => setDialog(open ? 'request' : null)} peer={peer} onPick={setAttachment} />
      <ShareHandleDialog
        open={dialog === 'handle'}
        onOpenChange={(open) => setDialog(open ? 'handle' : null)}
        onShare={(share) => {
          setAttachment({ kind: 'handle', ...share })
          setDialog(null)
        }}
      />
      <ShareMarketDialog
        open={dialog === 'market'}
        onOpenChange={(open) => setDialog(open ? 'market' : null)}
        onShare={(share: PositionShare) => {
          setAttachment({ kind: 'market', share })
          setDialog(null)
        }}
      />

      <ReviewSheet
        open={reviewing}
        onOpenChange={(open) => (open || busy ? undefined : setReviewing(false))}
        title={MAIL_REVIEW_TITLE}
        description={`To ${handleLabel(identity.name, peer, 10, 6)}`}
        boundary="shielded"
        rows={[
          { label: 'To', value: handleLabel(identity.name, peer, 10, 6) },
          { label: carried.postage ? 'Postage' : 'You send', value: <Amount wei={carried.wei} decimals={carried.decimals} symbol={carried.symbol} /> },
          { label: 'Message', value: draft.trim() ? (draft.trim().length > 80 ? `${draft.trim().slice(0, 80)}…` : draft.trim()) : attachment ? KIND_LABEL[attachment.kind] : '—' },
          { label: 'Lands as', value: 'A shielded note with the memo sealed to it, posted by the pool' },
        ]}
        disclosure={MAIL_DISCLOSURE}
        confirmLabel={MAIL_SEND_CTA}
        sponsor={{ kind: 'eligible' }}
        onConfirm={(sponsored) => void confirm(sponsored)}
        busy={busy}
        problem={busy ? null : refusal}
      >
        {busy && pipeline && pipeline.operation === 'mail' ? (
          <OperationPipeline stages={pipeline.stages} reached={pipeline.reached} failedAt={pipeline.failedAt} replaced={pipeline.replaced} startedAt={pipeline.startedAt} />
        ) : null}
      </ReviewSheet>
    </>
  )
}
