import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, QrCode, Send, ShieldMinus, ShieldPlus } from 'lucide-react'

import { ShieldDialog } from '@/components/money/shield-dialog'
import { UnshieldDialog } from '@/components/money/unshield-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { sendProblem, shieldProblem, useSend, useShield } from '@/mutations'
import { ReceiveSheet } from './receive-sheet'
import { weiOf, type WalletToken } from './rows'
import type { WalletData } from './use-wallet-data'

interface ShieldDoorProps {
  data: WalletData
  /** Fix the token (the token page); absent means pick one from the menu. */
  token?: WalletToken
  className?: string
}

/**
 * The public → shielded door. One live mutation per tab; the dialog collects the ask and this
 * owns the `useShield` call so the pipeline row and the feed see one operation.
 */
export function ShieldDoor({ data, token, className }: ShieldDoorProps) {
  const [chosen, setChosen] = useState<WalletToken | null>(null)
  const shield = useShield()
  const active = chosen ?? (token && shield.isPending ? token : null)

  const open = (pick: WalletToken) => {
    shield.reset()
    setChosen(pick)
  }

  const trigger = token ? (
    <Button className={className} onClick={() => open(token)}>
      <ShieldPlus data-icon="inline-start" />
      Shield {token.symbol}
    </Button>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button className={className} />}>
        <ShieldPlus data-icon="inline-start" />
        Shield
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        {/* Base UI: a GroupLabel reads its Group's context, so the label needs the Group around it. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Public → shielded</DropdownMenuLabel>
          {data.tokens.map((row) => (
            <DropdownMenuItem key={row.token} onClick={() => open(row)}>
              {row.symbol}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      {trigger}
      {active ? (
        <ShieldDialog
          open={chosen !== null}
          onOpenChange={(next) => {
            if (!next && !shield.isPending) setChosen(null)
          }}
          token={active.token}
          symbol={active.symbol}
          decimals={active.decimals}
          logoUri={active.logoUri}
          publicWei={weiOf(data.publicRows, active.token)}
          publicStrkWei={data.publicStrkWei}
          onShield={(ask) =>
            shield.mutate(ask, {
              onSuccess: (result) => {
                if (result.ok) setChosen(null)
              },
            })
          }
          busy={shield.isPending}
          problem={shieldProblem(shield.data)}
        />
      ) : null}
    </>
  )
}

/**
 * The shielded → public door, and the mirror of `ShieldDoor` on purpose: same trigger, same menu of
 * assets, same dialog shape. Going in and coming back out are one round trip, so they get one
 * grammar — this used to be a link to `/send?out` and a destination toggle, which made the way out
 * a different screen from the way in.
 */
export function UnshieldDoor({ data, token, className }: ShieldDoorProps) {
  const [chosen, setChosen] = useState<WalletToken | null>(null)
  const send = useSend()
  const active = chosen ?? (token && send.isPending ? token : null)

  const open = (pick: WalletToken) => {
    send.reset()
    setChosen(pick)
  }

  const trigger = token ? (
    <Button variant="outline" className={className} onClick={() => open(token)}>
      <ShieldMinus data-icon="inline-start" className="text-exposed" />
      Unshield {token.symbol}
    </Button>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className={className} />}>
        <ShieldMinus data-icon="inline-start" className="text-exposed" />
        Unshield
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Shielded → public</DropdownMenuLabel>
          {data.tokens.map((row) => (
            <DropdownMenuItem key={row.token} onClick={() => open(row)}>
              {row.symbol}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      {trigger}
      {active ? (
        <UnshieldDialog
          open={chosen !== null}
          onOpenChange={(next) => {
            if (!next && !send.isPending) setChosen(null)
          }}
          token={active.token}
          symbol={active.symbol}
          decimals={active.decimals}
          logoUri={active.logoUri}
          shieldedWei={weiOf(data.shieldedRows, active.token)}
          address={data.address}
          onUnshield={(ask) =>
            send.mutate(ask, {
              onSuccess: (result) => {
                if (result.ok) setChosen(null)
              },
            })
          }
          busy={send.isPending}
          problem={sendProblem(send.data)}
        />
      ) : null}
    </>
  )
}

/** Shield · Exit · Send · Receive — the verbs that cross or leave the boundary. */
export function CrossingActions({ data }: { data: WalletData }) {
  return (
    <>
      <ShieldDoor data={data} className="w-full md:w-auto" />
      {/* The other half of the shield door, and it sits beside it for that reason: value going in
          and value coming back out are one round trip, not a feature and a setting. */}
      <UnshieldDoor data={data} className="w-full md:w-auto" />
      <Button variant="outline" className="w-full md:w-auto" render={<Link to="/bridge" />}>
        <ArrowUpRight data-icon="inline-start" />
        Exit
      </Button>
      <Button variant="outline" className="w-full md:w-auto" render={<Link to="/send" />}>
        <Send data-icon="inline-start" />
        Send
      </Button>
      <ReceiveSheet address={data.address}>
        <Button variant="outline" className="w-full md:w-auto">
          <QrCode data-icon="inline-start" />
          Receive
        </Button>
      </ReceiveSheet>
    </>
  )
}
