import { Link } from '@tanstack/react-router'
import { ArrowLeft, Send } from 'lucide-react'

import { Page } from '@/components/layout/page'
import { Amount } from '@/components/money/amount'
import { AssetIdentity } from '@/components/money/asset-identity'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent } from '@/components/ui/item'
import { explorerAddress, shortAddress } from '@/lib/format'
import { ShieldDoor } from './crossing-actions'
import { walletTokenFor } from './rows'
import { useWalletData } from './use-wallet-data'

/** `/token/$address`: one token's two balances, its shield door and the way to Send. */
export function TokenPage({ address }: { address: string }) {
  const data = useWalletData()
  const token = walletTokenFor(data.tokens, address)

  if (!token) {
    return (
      <Page kicker="Money" title="Token" actions={<BackButton />}>
        <Card>
          <CardHeader>
            <CardTitle>Not a wallet token</CardTitle>
            <CardDescription>
              {shortAddress(address, 10, 8)} is not STRK, USDC or anything this account holds in the pool. Nothing was read for it.
            </CardDescription>
          </CardHeader>
        </Card>
      </Page>
    )
  }

  const shielded = data.shieldedRows.find((row) => row.token === token.token)
  const pub = data.publicRows.find((row) => row.token === token.token)

  return (
    <Page kicker="Money" title={token.symbol} description={token.name ?? undefined} actions={<BackButton />}>
      <div className="flex flex-col gap-4 md:flex-row">
        <Card className="flex-1 border-2 border-shielded">
          <CardHeader>
            <CardTitle className="font-display text-display4 uppercase">Shielded</CardTitle>
            <CardDescription>
              <BoundaryBadge kind="shielded" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Item size="sm" className="px-0">
              <ItemContent>
                <AssetIdentity symbol={token.symbol} name={token.name} logoUri={token.logoUri} boundary="shielded" chip={false} />
              </ItemContent>
              <ItemActions>
                <Amount wei={shielded?.wei} decimals={token.decimals} symbol={token.symbol} confidence={shielded?.confidence} size="hero" />
              </ItemActions>
            </Item>
          </CardContent>
        </Card>
        <Card className="flex-1 border-2 border-dashed border-public">
          <CardHeader>
            <CardTitle className="font-display text-display4 uppercase">Public</CardTitle>
            <CardDescription>
              <BoundaryBadge kind="publicEntry" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Item size="sm" className="px-0">
              <ItemContent>
                <AssetIdentity symbol={token.symbol} name={token.name} logoUri={token.logoUri} boundary="public" chip={false} />
              </ItemContent>
              <ItemActions>
                <Amount wei={pub?.wei} decimals={token.decimals} symbol={token.symbol} size="hero" />
              </ItemActions>
            </Item>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <ShieldDoor data={data} token={token} />
        <Button
          variant="outline"
          render={<Link to="/send" search={token.symbol === 'STRK' || token.symbol === 'USDC' ? { asset: token.symbol } : {}} />}
        >
          <Send data-icon="inline-start" />
          Send {token.symbol}
        </Button>
        <Button variant="ghost" render={<a href={explorerAddress(token.token)} target="_blank" rel="noreferrer" />}>
          Contract {shortAddress(token.token)}
        </Button>
      </div>
    </Page>
  )
}

function BackButton() {
  return (
    <Button variant="ghost" size="sm" render={<Link to="/wallet" />}>
      <ArrowLeft data-icon="inline-start" />
      Wallet
    </Button>
  )
}
