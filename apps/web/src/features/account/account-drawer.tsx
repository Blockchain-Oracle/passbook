import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AtSign, Check, FileKey, FileUp, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { CREATE_BODY, EXPORT_ROW_DETAIL, EXPORT_ROW_LABEL, SWITCH_BODY, SWITCH_TITLE } from '@strk20/protocol/account-copy'
import { notify } from '@/lib/notify'

import { sessionActions, type Session } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ImportPanel } from '@/features/onboarding/import-panel'
import { shortAddress } from '@/lib/format'
import { useIdentity } from '@/queries/identity'
import { AccountAddress } from './account-address'
import { AccountBalances } from './account-balances'
import { ACTIVE_MARK, ADD_ACCOUNT_ACTION, IMPORT_ACCOUNT_ACTION, LOCK_ACTION, NO_NAME_MARK } from './account-copy'
import { ExportPanel, ForgetForm, LabelForm, LockControl, NameForm } from './account-forms'

type View = 'main' | 'label' | 'name' | 'export' | 'import' | 'forget' | 'lock'

interface AccountDrawerProps {
  session: Session
  open: boolean
  onOpenChange: (open: boolean) => void
}

function same(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return a === b
  }
}

function Verb({ icon: Icon, label, onClick, tone }: { icon: typeof Lock; label: string; onClick: () => void; tone?: 'danger' }) {
  return (
    <Button variant={tone === 'danger' ? 'destructive' : 'outline'} size="sm" onClick={onClick}>
      <Icon data-icon="inline-start" />
      {label}
    </Button>
  )
}

/** The account sheet: where the money's owner is looked at, switched, labelled, exported or forgotten. */
export function AccountDrawer({ session, open, onOpenChange }: AccountDrawerProps) {
  const [view, setView] = useState<View>('main')
  const address = session.address
  const identity = useIdentity(address)
  const close = () => {
    setView('main')
    onOpenChange(false)
  }
  const switchTo = useMutation({
    mutationKey: ['switch-account'],
    mutationFn: sessionActions.switchAccount,
    onError: (e) => notify.refused('Could not switch', { description: e.message }),
  })
  const create = useMutation({
    mutationKey: ['create-account'],
    mutationFn: sessionActions.createAccount,
    onSuccess: () => notify.settled('New account', { description: CREATE_BODY }),
    onError: (e) => notify.refused('Could not create an account', { description: e.message }),
  })

  const body = () => {
    if (!address) return null
    switch (view) {
      case 'label':
        return <LabelForm address={address} current={session.label ?? null} onDone={() => setView('main')} />
      case 'name':
        return <NameForm current={identity.name} onDone={() => setView('main')} />
      case 'export':
        return <ExportPanel onDone={() => setView('main')} />
      case 'import':
        return <ImportPanel onDone={() => setView('main')} />
      case 'forget':
        return <ForgetForm onDone={close} />
      case 'lock':
        return <LockControl hasVault={session.hasVault} onLocked={close} />
      default:
        return (
          <div className="flex flex-col gap-5">
            <AccountAddress address={address} />
            <AccountBalances address={address} accountKey={session.accountKey} />
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Verb icon={Pencil} label={session.label ? 'Rename' : 'Label'} onClick={() => setView('label')} />
              <Verb icon={Lock} label={LOCK_ACTION} onClick={() => setView('lock')} />
              <Verb icon={Plus} label={ADD_ACCOUNT_ACTION} onClick={() => !create.isPending && create.mutate()} />
              <Verb icon={FileUp} label={IMPORT_ACCOUNT_ACTION} onClick={() => setView('import')} />
            </div>
            {/* Onboarding promises "you can claim one in Settings" when a claim fails; this is where. */}
            <Item variant="outline" size="sm" render={<button type="button" onClick={() => setView('name')} />}>
              <AtSign className="size-4" aria-hidden />
              <ItemContent>
                <ItemTitle>{identity.name ? `@${identity.name}` : NO_NAME_MARK}</ItemTitle>
                <ItemDescription>
                  {identity.name
                    ? 'Your public name in the directory. Change it here.'
                    : 'Claim a public name so people can reach you without the address.'}
                </ItemDescription>
              </ItemContent>
            </Item>
            <Item variant="outline" size="sm" render={<button type="button" onClick={() => setView('export')} />}>
              <FileKey className="size-4" aria-hidden />
              <ItemContent>
                <ItemTitle>{EXPORT_ROW_LABEL}</ItemTitle>
                <ItemDescription>{EXPORT_ROW_DETAIL}</ItemDescription>
              </ItemContent>
            </Item>
            {session.accounts.length > 1 ? (
              <div className="flex flex-col gap-2">
                <p className="text-kicker uppercase text-muted-foreground">{SWITCH_TITLE}</p>
                <ItemGroup className="gap-1">
                  {session.accounts.map((a) => {
                    const active = same(a.address, address)
                    return (
                      <Item
                        key={a.address}
                        size="xs"
                        variant={active ? 'muted' : 'outline'}
                        render={<button type="button" onClick={() => !active && switchTo.mutate(a.address)} aria-current={active ? 'true' : undefined} />}
                      >
                        <ItemContent>
                          <ItemTitle>{a.label ?? shortAddress(a.address, 8, 6)}</ItemTitle>
                          {a.label ? <ItemDescription className="font-mono">{shortAddress(a.address, 8, 6)}</ItemDescription> : null}
                        </ItemContent>
                        <ItemActions>
                          {active ? (
                            <span className="flex items-center gap-1 text-body4 text-settled">
                              <Check className="size-3" aria-hidden />
                              {ACTIVE_MARK}
                            </span>
                          ) : null}
                        </ItemActions>
                      </Item>
                    )
                  })}
                </ItemGroup>
                <p className="text-body4 text-muted-foreground">{SWITCH_BODY}</p>
              </div>
            ) : null}
            <Separator />
            <Verb icon={Trash2} label="Forget this browser’s wallet" tone="danger" onClick={() => setView('forget')} />
          </div>
        )
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-display4 uppercase">
            {identity.name ? `@${identity.name}` : (session.label ?? 'Account')}
          </SheetTitle>
          <SheetDescription className="font-mono text-mono">{address ? shortAddress(address, 10, 8) : ''}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {view !== 'main' ? (
            <Button variant="ghost" size="sm" className="mb-3" onClick={() => setView('main')}>
              Back
            </Button>
          ) : null}
          {body()}
        </div>
      </SheetContent>
    </Sheet>
  )
}
