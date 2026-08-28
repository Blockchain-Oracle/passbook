import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Unplug, Wallet } from 'lucide-react'
import { parseAmountInput } from '@strk20/protocol/amount'
import { BRIDGE_USDC, BRIDGE_USDC_DECIMALS } from '@strk20/protocol/bridge'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { PUBLIC_FUNDING_NOTICE } from '@strk20/protocol/wallet-capability'
import { toast } from 'sonner'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { invalidateAccount } from '@/mutations'
import { shortAddress } from '@/lib/format'
import { connectWallet, disconnectWallet, fundPublicAccount, useFundingWallet, walletsQuery } from './funding-wallet'

const ASSETS = {
  STRK: { token: STRK_TOKEN, decimals: 18 },
  USDC: { token: BRIDGE_USDC, decimals: BRIDGE_USDC_DECIMALS },
} as const
type Asset = keyof typeof ASSETS

const NO_WALLET =
  'No Starknet wallet found in this browser. Passbook works without one — this is only for moving money in from an existing wallet.'

function WalletPicker() {
  const wallets = useQuery(walletsQuery())
  const connect = useMutation({
    mutationKey: ['connect-funding-wallet'],
    mutationFn: connectWallet,
    onSuccess: (outcome) =>
      outcome.ok ? toast.success(`${outcome.wallet.name} connected`) : toast.error('Could not connect', { description: outcome.because }),
  })
  if (wallets.isPending) return <Spinner />
  if (!wallets.data?.length) return <p className="text-body4 text-muted-foreground">{NO_WALLET}</p>
  return (
    <div className="flex flex-col gap-1">
      {wallets.data.map((w) => (
        <Item key={w.id} size="sm" variant="outline" render={<button type="button" onClick={() => connect.mutate(w.id)} />}>
          <ItemMedia>
            {w.icon.startsWith('data:') ? <img src={w.icon} alt="" className="size-6 rounded" /> : <Wallet className="size-5" aria-hidden />}
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{w.name}</ItemTitle>
          </ItemContent>
          <span className="text-body4 text-muted-foreground">{connect.isPending && connect.variables === w.id ? 'connecting…' : 'connect'}</span>
        </Item>
      ))}
    </div>
  )
}

function FundingRail({ passbookAddress }: { passbookAddress: string }) {
  const wallet = useFundingWallet()
  const [asset, setAsset] = useState<Asset>('STRK')
  const [text, setText] = useState('')
  const parsed = parseAmountInput(text, ASSETS[asset].decimals)
  const send = useMutation({
    mutationKey: ['fund-public-account'],
    mutationFn: (wei: bigint) => fundPublicAccount(ASSETS[asset].token, wei, passbookAddress),
    onSuccess: (outcome) => {
      if (!outcome.ok) {
        toast.error('Public funding was not sent', { description: outcome.because })
        return
      }
      toast.success(`${text} ${asset} on its way`, {
        description: `Signed in ${wallet?.name ?? 'your wallet'}. It lands at your embedded address as public ${asset}; shielding is a separate Passbook transaction.`,
      })
      setText('')
      void invalidateAccount()
    },
  })
  if (!wallet) return null
  const blocker = parsed.problem ?? (parsed.wei === null || parsed.wei === 0n ? 'Enter an amount' : null)
  return (
    <div className="flex flex-col gap-3">
      <Item size="sm" variant="muted">
        <ItemMedia>
          {wallet.icon.startsWith('data:') ? <img src={wallet.icon} alt="" className="size-6 rounded" /> : <Wallet className="size-5" aria-hidden />}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{wallet.name}</ItemTitle>
          <span className="font-mono text-mono text-muted-foreground">{shortAddress(wallet.address, 8, 6)}</span>
        </ItemContent>
        <Button variant="ghost" size="sm" onClick={() => { disconnectWallet(); toast(`${wallet.name} disconnected`) }}>
          <Unplug data-icon="inline-start" />
          Disconnect
        </Button>
      </Item>
      <Field orientation="horizontal">
        <FieldLabel>Asset</FieldLabel>
        <ToggleGroup value={[asset]} onValueChange={(v) => v[0] && setAsset(v[0] as Asset)} multiple={false}>
          <ToggleGroupItem value="STRK">STRK</ToggleGroupItem>
          <ToggleGroupItem value="USDC">USDC</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Field>
        <FieldLabel htmlFor="fund-amount">Amount</FieldLabel>
        <Input id="fund-amount" inputMode="decimal" placeholder="0.0" value={text} onChange={(e) => setText(e.target.value)} className="font-mono" />
      </Field>
      <Button aria-disabled={send.isPending || blocker !== null} onClick={() => !send.isPending && parsed.wei && !blocker && send.mutate(parsed.wei)}>
        {send.isPending ? <Spinner data-icon="inline-start" /> : null}
        {send.isPending ? 'In your wallet…' : (blocker ?? 'Send it')}
      </Button>
      {wallet.support === 'unsupported' ? (
        <p className="text-body4 text-muted-foreground">
          {wallet.name} does not support private actions itself. That does not matter here — Passbook does the private part with its own key.
        </p>
      ) : null}
    </div>
  )
}

/** The door: an external wallet as a public funding source. Never an identity, never the chip. */
export function ConnectFundingWallet({ passbookAddress }: { passbookAddress: string }) {
  const wallet = useFundingWallet()
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-display4 uppercase">{wallet ? 'Funding wallet' : 'Add money from a wallet'}</p>
          <p className="text-body4 text-muted-foreground">
            {wallet
              ? 'Connected as a place to move money from. Your Passbook account is unchanged.'
              : 'Connect Ready — or any Starknet wallet — to send funds into this account. It does not sign you in and it does not replace your account.'}
          </p>
        </div>
        <BoundaryBadge kind="bothPublic" />
      </div>
      {wallet ? <FundingRail passbookAddress={passbookAddress} /> : <WalletPicker />}
      <Alert>
        <AlertDescription>{PUBLIC_FUNDING_NOTICE}</AlertDescription>
      </Alert>
    </div>
  )
}
