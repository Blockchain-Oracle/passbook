import { toPlainText } from '@strk20/protocol/amount'
import { voyagerTxUrl } from '@strk20/protocol/transaction'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { stageLabel } from '../shell/stage-labels'
import { usePoolFee } from '../shell/use-pool-fee'
import { useSession } from '../shell/session'
import { useShield } from '../shell/use-shield'
import { AmountInput, useAmountField } from './AmountInput'
import { Button } from './LegacyButton'
import { Text } from './Text'


export function ShieldDialog({
  token,
  publicWei,
  publicStrkWei,
  open,
  onOpenChange,
  onConfirmed,
}: {
  token: TokenInfo
  publicWei: bigint
  publicStrkWei: bigint
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: () => void
}) {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const shielding = useShield(ready, onConfirmed)
  const fee = usePoolFee()
  const amount = useAmountField({ decimals: token.decimals, available: publicWei })
  const successful = shielding.result?.ok === true ? shielding.result : null
  const running = shielding.stage !== null

  const close = () => {
    if (running) return
    shielding.reset()
    onOpenChange(false)
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      label={`Shield ${token.symbol}`}
      modal
      dismissible={!running}
    >
      <div className="flex min-h-0 flex-col gap-s16 overflow-y-auto">
        <div className="flex flex-col gap-s4">
          <Text variant="kicker">Public → shielded</Text>
          <Text variant="display3" as="h2">
            Shield {token.symbol}
          </Text>
          <Text variant="body3" className="text-neutral2">
            The embedded Passbook account deposits its own public funds and creates one encrypted
            note back to itself. A connected wallet cannot shield on its behalf.
          </Text>
        </div>

        {successful ? (
          <div className="flex flex-col gap-s12 rounded-large bg-inset p-s16">
            <Text variant="subheading1" className="text-settled">
              Shield confirmed
            </Text>
            <Text variant="body3" className="text-neutral2">
              The pool accepted the deposit and the new note was observed. Public and shielded
              balances are being refreshed.
            </Text>
            <a
              href={voyagerTxUrl(successful.transactionHash) ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="focus-ring w-fit rounded-control font-mono text-mono text-neutral1 underline"
            >
              View transaction ↗
            </a>
            <Button fill onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <AmountInput
              field={amount}
              symbol={token.symbol}
              balance={{
                value: `${toPlainText(publicWei, token.decimals)} ${token.symbol} public`,
                confidence: 'dated',
              }}
              label={`Public ${token.symbol} to shield`}
            />

            <dl className="flex flex-col gap-s6 rounded-card bg-inset p-s12">
              <div className="flex justify-between gap-s12">
                <dt className="text-body4 text-neutral3">Pool fee</dt>
                <dd className="m-s0 font-mono text-body4 text-neutral1">
                  {fee === null ? 'Reading…' : `${fee} STRK`}
                </dd>
              </div>
              <div className="flex justify-between gap-s12">
                <dt className="text-body4 text-neutral3">Submitted by</dt>
                <dd className="m-s0 text-body4 text-neutral1">Embedded Passbook account</dd>
              </div>
            </dl>

            <Text variant="body4" className="text-exposed">
              This deposit is public: the Passbook address, token and amount are visible on
              Starknet. Privacy begins with the encrypted note created inside the pool.
            </Text>

            {shielding.problem ? (
              <Text variant="body4" className="text-irreversible" role="alert">
                {shielding.problem}
              </Text>
            ) : null}

            <Button
              fill
              aria-disabled={
                running ||
                amount.wei === null ||
                amount.wei === 0n ||
                amount.short ||
                fee === null
              }
              onClick={() => {
                if (amount.wei === null || amount.wei === 0n) return
                void shielding.shield({
                  token: token.address,
                  symbol: token.symbol,
                  amount: amount.wei,
                  publicTokenWei: publicWei,
                  publicStrkWei,
                })
              }}
            >
              {running
                ? stageLabel(shielding.stage!)
                : amount.short
                  ? `Not enough public ${token.symbol}`
                  : 'Review and shield'}
            </Button>
          </>
        )}
      </div>
    </ResponsiveDialog>
  )
}
