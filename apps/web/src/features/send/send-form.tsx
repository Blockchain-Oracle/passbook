import { useId, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { toPlainText } from '@strk20/protocol/amount'
import { disclosureFor } from '@strk20/protocol/disclosure'
import { PAY_NOTE_MAX_CHARS, type PayLinkSearch } from '@strk20/protocol/pay-link'
import type { SendResult } from '@strk20/protocol/send'

import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { MoneyField } from '@/components/money/money-field'
import { ReviewSheet } from '@/components/money/review-sheet'
import { ShieldDialog } from '@/components/money/shield-dialog'
import { TokenPicker } from '@/components/money/token-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { formatWei, shortAddress } from '@/lib/format'
import { sendProblem, useSend } from '@/mutations/use-send'
import { shieldProblem, useShield } from '@/mutations/use-shield'
import { RecipientField } from './recipient-field'
import { SendFailed, SendPipeline, SendReceipt, type SentSummary } from './send-outcome'
import { useSendForm, type SendSearch } from './use-send-form'

const HEADER_NOTE =
  'A private transfer to another pool account. The recipient sees who sent it — private is not anonymous to the person you are paying.'
const NOTE_HINT = 'Context for the request link only. It is not written into the transaction.'

/** The whole Send surface below the page header. Route composes it; nothing here is a route. */
export function SendForm({ initial }: { initial: SendSearch }) {
  const form = useSendForm(initial)
  const send = useSend()
  const shield = useShield()
  const [reviewing, setReviewing] = useState(false)
  const [shielding, setShielding] = useState(false)
  const [sent, setSent] = useState<{ result: Extract<SendResult, { ok: true }>; summary: SentSummary } | null>(null)
  const noteId = useId()

  const { asset, parsed, recipient } = form
  const request: PayLinkSearch = {
    ...(asset.symbol === 'STRK' || asset.symbol === 'USDC' ? { asset: asset.symbol } : {}),
    ...(parsed.wei && asset.decimals !== null ? { amount: toPlainText(parsed.wei, asset.decimals) } : {}),
    ...(form.note.trim() ? { note: form.note.trim().slice(0, PAY_NOTE_MAX_CHARS) } : {}),
  }

  // The door opens only when public money could actually cover the gap; an unreadable public
  // balance is not an offer.
  const shieldDoor =
    form.shortfallWei !== null && asset.publicWei !== null && asset.publicWei >= form.shortfallWei
      ? { shortfallWei: form.shortfallWei, onShield: () => setShielding(true) }
      : null

  const confirm = () => {
    if (recipient.state !== 'registered' || parsed.wei === null) return
    const summary: SentSummary = {
      amount: parsed.wei,
      decimals: asset.decimals,
      symbol: asset.symbol,
      recipient: recipient.name ? `@${recipient.name} · ${shortAddress(recipient.address)}` : shortAddress(recipient.address, 10, 6),
    }
    send.mutate(
      { kind: 'transfer', recipient: recipient.address, token: asset.address, symbol: asset.symbol, amount: parsed.wei, label: recipient.name ? `Pay @${recipient.name}` : `Send ${asset.symbol}` },
      {
        onSuccess: (result) => {
          if (result.ok) {
            setSent({ result, summary })
            setReviewing(false)
            form.reset()
          }
        },
      },
    )
  }

  const busy = send.isPending
  const failed = !busy && send.data && !send.data.ok ? send.data : null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <p className="text-body4 text-muted-foreground">{HEADER_NOTE}</p>

          <Field>
            <FieldLabel>Asset</FieldLabel>
            <div className="flex flex-wrap items-center gap-3">
              <TokenPicker
                tokens={form.assets.map((a) => ({
                  address: a.address,
                  symbol: a.symbol,
                  name: a.name,
                  logoUri: a.logoUri,
                  decimals: a.decimals,
                  trailing: a.shieldedWei === null ? '—' : `${formatWei(a.shieldedWei, a.decimals)} shielded`,
                }))}
                value={asset.address}
                onChange={form.setToken}
              />
              <AssetIdentity symbol={asset.symbol} name={asset.name} logoUri={asset.logoUri} boundary="shielded" size="sm" />
            </div>
          </Field>

          <MoneyField
            value={form.raw}
            onChange={form.setRaw}
            symbol={asset.symbol}
            decimals={asset.decimals}
            available={asset.shieldedWei}
            boundary="shielded"
            onMax={asset.shieldedWei !== null && asset.decimals !== null ? () => form.setRaw(toPlainText(asset.shieldedWei!, asset.decimals!)) : undefined}
            problem={parsed.problem ?? (form.short ? `Not enough shielded ${asset.symbol}` : null)}
            shieldDoor={shieldDoor}
          />

          <RecipientField value={form.recipientRaw} onChange={form.setRecipientRaw} status={recipient} request={request} autoFocus={!initial.to} />

          <Field>
            <FieldLabel htmlFor={noteId}>Note</FieldLabel>
            <Textarea
              id={noteId}
              value={form.note}
              onChange={(e) => form.setNote(e.target.value.slice(0, PAY_NOTE_MAX_CHARS))}
              placeholder="What is this for? (optional)"
              rows={2}
            />
            <FieldDescription>
              {NOTE_HINT} {form.note.length}/{PAY_NOTE_MAX_CHARS}
            </FieldDescription>
          </Field>

          <Button
            size="lg"
            aria-disabled={form.blocker !== null || busy || undefined}
            onClick={() => {
              if (form.blocker === null && !busy) setReviewing(true)
            }}
          >
            {busy ? 'Sending…' : (form.blocker ?? 'Review send')}
            {form.blocker === null && !busy ? <ArrowUpRight data-icon="inline-end" /> : null}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <SendPipeline />
        {sent ? <SendReceipt result={sent.result} summary={sent.summary} /> : null}
        {failed ? <SendFailed result={failed} onSelfSubmit={() => setReviewing(true)} /> : null}
      </div>

      <ReviewSheet
        open={reviewing}
        onOpenChange={setReviewing}
        title={`Send ${asset.symbol}`}
        description={HEADER_NOTE}
        boundary="shielded"
        rows={[
          { label: 'Amount', value: <Amount wei={parsed.wei} decimals={asset.decimals} symbol={asset.symbol} /> },
          { label: 'From', value: `Shielded ${asset.symbol}` },
          { label: 'To', value: recipient.state === 'registered' ? (recipient.name ? `@${recipient.name}` : shortAddress(recipient.address, 10, 6)) : '—' },
          { label: 'Pool fee', value: <Amount wei={form.feeWei} decimals={18} symbol="STRK" /> },
        ]}
        disclosure={disclosureFor('pool-send')}
        confirmLabel={`Send ${asset.symbol}`}
        onConfirm={confirm}
        busy={busy}
        blocker={busy ? null : (form.blocker ?? sendProblem(send.data))}
      />

      <ShieldDialog
        open={shielding}
        onOpenChange={setShielding}
        token={asset.address}
        symbol={asset.symbol}
        decimals={asset.decimals}
        logoUri={asset.logoUri}
        publicWei={asset.publicWei}
        publicStrkWei={form.publicStrkWei}
        onShield={(ask) =>
          shield.mutate(ask, {
            onSuccess: (result) => {
              if (result.ok) setShielding(false)
            },
          })
        }
        busy={shield.isPending}
        problem={shieldProblem(shield.data)}
      />
    </div>
  )
}
