// The page that is not here, inside the shell: the sidebar and the phone tabs stay, so a wrong
// address is a wrong turn inside the app rather than a fall out of it. Nothing of the user's is
// implicated — an address that matches no route has touched no account.
import { Link } from '@tanstack/react-router'
import { Compass, Wallet } from 'lucide-react'

import { Page } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

const TITLE = 'Nothing at this address'
const BODY = 'The link is wrong, or the page it named is gone. Nothing moved and nothing was touched — your accounts are where they were.'

export function NotFoundPage() {
  return (
    <Page kicker="404" title={TITLE} description={BODY}>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Compass aria-hidden />
          </EmptyMedia>
          <EmptyTitle>Not a page this app has</EmptyTitle>
          <EmptyDescription>Every surface is one click away in the sidebar; the wallet is the usual place to start.</EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" render={<Link to="/wallet" />}>
            <Wallet data-icon="inline-start" />
            Wallet
          </Button>
          <Button size="lg" variant="outline" render={<Link to="/markets" />}>
            Markets
          </Button>
        </div>
      </Empty>
    </Page>
  )
}
