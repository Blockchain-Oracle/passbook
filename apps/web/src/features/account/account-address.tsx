import { Check, Copy } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { ADDRESS_IS_EXACT_BEFORE_DEPLOY, COPIED, COPY_ADDRESS } from '@strk20/protocol/account-copy'

import { Button } from '@/components/ui/button'
import { useCopy } from '@/hooks/use-copy'

/** The active address with its QR: the drawer's receive surface. */
export function AccountAddress({ address }: { address: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-md bg-white p-2">
        <QRCodeSVG value={address} size={136} level="Q" />
      </div>
      <p className="max-w-full break-all text-center font-mono text-mono">{address}</p>
      <Button variant="outline" size="sm" onClick={() => void copy(address)} aria-label={copied ? COPIED : COPY_ADDRESS}>
        {copied ? <Check className="text-settled" data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        {copied ? COPIED : COPY_ADDRESS}
      </Button>
      <p className="text-center text-body4 text-muted-foreground">{ADDRESS_IS_EXACT_BEFORE_DEPLOY}</p>
    </div>
  )
}
