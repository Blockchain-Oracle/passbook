import { useState, type ReactElement } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy } from 'lucide-react'
import { ADDRESS_IS_EXACT_BEFORE_DEPLOY, COPIED, COPY_ADDRESS } from '@strk20/protocol/account-copy'
import { PAY_ASSETS, PAY_NOTE_MAX_CHARS, buildPayLink, parsePayLinkSearch, type PayAsset } from '@strk20/protocol/pay-link'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCopy } from '@/hooks/use-copy'
import { shortAddress } from '@/lib/format'

const ARRIVES_PUBLIC = (short: string) =>
  `Anything sent to ${short} reaches this public account first. The amount and sender are visible until those funds are shielded in a separate transaction.`
const LINK_PREFILLS = 'The link prefills Send. Its note is human context only and is not written into the transaction.'

function AddressPanel({ address }: { address: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="rounded-xl border-2 border-dashed border-public bg-white p-3">
        <QRCodeSVG value={address} size={168} level="Q" />
      </div>
      <p className="max-w-full break-all text-center font-mono text-mono">{address}</p>
      <Button variant="outline" onClick={() => void copy(address)}>
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        {copied ? COPIED : COPY_ADDRESS}
      </Button>
      <p className="text-body4 text-muted-foreground">{ARRIVES_PUBLIC(shortAddress(address))}</p>
      <p className="text-body4 text-muted-foreground">{ADDRESS_IS_EXACT_BEFORE_DEPLOY}</p>
    </div>
  )
}

function RequestPanel({ address }: { address: string }) {
  const [asset, setAsset] = useState<PayAsset | ''>('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const { copied, copy } = useCopy()

  const parsed = parsePayLinkSearch({ asset, amount, note })
  const link = parsed.ok ? `${window.location.origin}${buildPayLink(address, parsed.value)}` : null

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel>Asset</FieldLabel>
        <ToggleGroup value={asset ? [asset] : []} onValueChange={(next) => setAsset((next[0] as PayAsset | undefined) ?? '')}>
          {PAY_ASSETS.map((candidate) => (
            <ToggleGroupItem key={candidate} value={candidate} aria-label={candidate}>
              {candidate}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>Leave it open and the payer chooses in Send.</FieldDescription>
      </Field>
      <Field data-invalid={(!parsed.ok && amount !== '') || undefined}>
        <FieldLabel htmlFor="receive-amount">Amount</FieldLabel>
        <Input id="receive-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Open amount" />
      </Field>
      <Field>
        <FieldLabel htmlFor="receive-note">Note</FieldLabel>
        <Input id="receive-note" value={note} maxLength={PAY_NOTE_MAX_CHARS} onChange={(e) => setNote(e.target.value)} placeholder="Context for the payer" />
        <FieldDescription>Not on chain.</FieldDescription>
      </Field>
      {!parsed.ok ? <FieldError>{parsed.because}</FieldError> : null}
      {link ? (
        <>
          <div className="self-center rounded-xl border-2 border-dashed border-public bg-white p-3">
            <QRCodeSVG value={link} size={144} level="Q" />
          </div>
          <p className="break-all font-mono text-mono text-muted-foreground">{link}</p>
        </>
      ) : null}
      <Button aria-disabled={link === null || undefined} onClick={() => link && void copy(link)}>
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        {link === null ? 'Fix the request first' : copied ? COPIED : 'Copy request link'}
      </Button>
      <p className="text-body4 text-muted-foreground">{LINK_PREFILLS}</p>
    </div>
  )
}

/** The address, as a QR and as text, plus a payment-request link builder. */
export function ReceiveSheet({ address, children }: { address: string | undefined; children: ReactElement }) {
  return (
    <Sheet>
      <SheetTrigger render={children} />
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <BoundaryBadge kind="publicEntry" className="w-fit" />
          <SheetTitle className="font-display text-display3 uppercase">Receive</SheetTitle>
          <SheetDescription>Your embedded strk20.run address. It is exact before the account is deployed.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {address ? (
            <Tabs defaultValue="address">
              <TabsList className="w-full">
                <TabsTrigger value="address">Address</TabsTrigger>
                <TabsTrigger value="request">Request</TabsTrigger>
              </TabsList>
              <TabsContent value="address" className="pt-4">
                <AddressPanel address={address} />
              </TabsContent>
              <TabsContent value="request" className="pt-4">
                <RequestPanel address={address} />
              </TabsContent>
            </Tabs>
          ) : (
            <p className="text-body3 text-muted-foreground">Open your account to see its address.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
