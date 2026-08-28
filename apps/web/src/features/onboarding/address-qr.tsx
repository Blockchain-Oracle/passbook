import { Check, Copy } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { ADDRESS_IS_EXACT_BEFORE_DEPLOY, COPIED, COPY_ADDRESS } from '@strk20/protocol/account-copy'

import { Button } from '@/components/ui/button'
import { useCopy } from '@/hooks/use-copy'
import { cn } from '@/lib/utils'

interface AddressQrProps {
  address: string
  /** The line above the address, e.g. `FUND_ADDRESS_HINT`. */
  hint?: string
  size?: number
  className?: string
}

/** The counterfactual address, copyable, with its QR. Exact before deployment — the copy says so. */
export function AddressQr({ address, hint, size = 152, className }: AddressQrProps) {
  const { copied, copy } = useCopy()
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed border-publicEdge bg-publicTint/40 p-4', className)}>
      {hint ? <p className="text-body4 text-muted-foreground">{hint}</p> : null}
      <div className="rounded-md bg-white p-2">
        <QRCodeSVG value={address} size={size} level="Q" />
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
