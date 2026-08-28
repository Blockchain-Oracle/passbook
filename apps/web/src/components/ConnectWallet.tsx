//
// The Connect Ready Wallet panel — the card, the picker, and the deposit rail behind it.
//
// ── IT LIVES IN THE ACCOUNT MODAL NOW, AND THAT WAS THE REVIEW'S RULING ───────────────────
//
// "Why is connect wallet here [the wallet surface]? It's supposed to be in the modal… and it is
// called Connect to Ready Wallet." So this renders inside `AccountDrawer`'s connect view — where
// account things live — and the verb names Ready, the wallet most Starknet users actually hold.
//
// ── THIS IS NOT A LOGIN, AND EVERY LINE OF COPY HERE HAS TO KEEP SAYING SO ────────────────
//
// A "Connect wallet" button on a crypto app means one thing to everybody who has used one before:
// it is how you sign in. Here it is not — the account already exists, it was derived in this
// browser before this component mounted, and connecting changes nothing about who you are. So the
// card leads with what the connection is FOR (moving money in, and signing submissions when you
// prefer your own wallet to pay), the connected state keeps showing the Passbook address as the
// account, and the word "connect" never appears without an object.
//
// `funding-wallet.ts`'s header has the argument for why identity and funding must stay separate.
// This file is where a user could be misled about it, so it is where the copy does the work.
//
import { useEffect, useMemo, useState } from 'react'

import { toPlainText } from '@strk20/protocol/amount'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { PUBLIC_DEPOSIT_NOTICE } from '@strk20/protocol/wallet-capability'

import { cn } from '../lib/cn'
import {
  connectWallet,
  depositToPassbook,
  disconnectWallet,
  listWallets,
  useFundingWallet,
  type DiscoveredWallet,
} from '../shell/funding-wallet'
import { shortenFelt, useSession } from '../shell/session'
import { toast } from '../shell/toast-store'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { Button } from './ui/Button'
import { Text } from './ui/Text'

/** 18 decimals, STRK's. The rail moves STRK only — the pool's fee token and the app's default. */
const STRK_DECIMALS = 18n

function parseStrk(raw: string): bigint | null {
  const trimmed = raw.trim()
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return null
  const [whole, frac = ''] = trimmed.split('.')
  return BigInt(whole!) * 10n ** STRK_DECIMALS + BigInt(frac.padEnd(18, '0') || '0')
}

export function ConnectWallet() {
  const wallet = useFundingWallet()
  const [picking, setPicking] = useState(false)

  return (
    <section className="flex flex-col gap-s12 rounded-large border border-solid border-surface3 bg-raised p-s16">
      <div className="flex items-start justify-between gap-s12">
        <div className="flex flex-col gap-s4">
          <Text variant="body2" as="h2" className="font-medium text-neutral1">
            {wallet ? 'Funding wallet' : 'Add money from a wallet'}
          </Text>
          <Text variant="body4" className="text-neutral2">
            {wallet ? (
              <>
                Connected as a place to move money <em>from</em>. Your Passbook account is
                unchanged.
              </>
            ) : (
              <>
                Connect Ready — or any Starknet wallet — to send funds into this account. It does
                not sign you in and it does not replace your account.
              </>
            )}
          </Text>
        </div>
      </div>

      {wallet ? (
        <>
          <div className="flex flex-wrap items-center gap-s12 rounded-card bg-inset p-s12">
            {/*
              The icon is a `data:` URI the wallet supplied — rendered, never fetched. A wallet
              that could make this app request a URL of its choosing would learn the visitor's IP
              on every page load, which is a tracking channel opened by a decoration.
            */}
            <img src={wallet.icon} alt="" aria-hidden="true" className="h-s24 w-s24 rounded-control" />
            <span className="flex min-w-0 flex-col">
              <Text variant="body3" className="text-neutral1">
                {wallet.name}
              </Text>
              <Text variant="mono" className="truncate text-neutral3">
                {shortenFelt(wallet.address, 8, 6)}
              </Text>
            </span>
            <Button
              variant="tertiary"
              size="sm"
              className="ml-auto"
              onClick={() => {
                disconnectWallet()
                // "Disconnected" and NOT "access revoked" — this clears the page's handle, and the
                // wallet's own permission list is managed in the wallet. See `disconnectWallet`.
                toast({ kind: 'info', title: `${wallet.name} disconnected` })
              }}
            >
              Disconnect
            </Button>
          </div>
          <DepositRail walletName={wallet.name} />
        </>
      ) : (
        <Button variant="secondary" size="md" className="self-start" onClick={() => setPicking(true)}>
          Connect Ready Wallet
        </Button>
      )}

      {/*
        THE PUBLIC-DEPOSIT NOTICE IS SHOWN BEFORE ANY DEPOSIT, NOT AFTER, and it is imported rather
        than retyped so it cannot drift from the sentence `wallet-capability.ts` pins. A deposit's
        sender and amount are on chain; privacy starts after it. This is the single most tempting
        place in the app to imply otherwise.
      */}
      <Text variant="body4" className="text-neutral3">
        {PUBLIC_DEPOSIT_NOTICE}
      </Text>

      {wallet && wallet.support === 'unsupported' ? (
        <Text variant="body4" className="text-neutral3">
          {wallet.name} does not support private actions itself. That does not matter here —
          Passbook does the private part with its own key. It only matters if you expected your
          wallet to hold the shielded balance.
        </Text>
      ) : null}

      <WalletPicker open={picking} onClose={() => setPicking(false)} />
    </section>
  )
}

/**
 * The rail the connection exists for — money in, from the connected wallet, one press.
 *
 * `depositToPassbook` shipped with the funding store and had zero call sites until this form:
 * the connection could be made and then did nothing. The wallet pops to sign its own transfer —
 * this app never holds that key — and the notice above the form has already said the transfer
 * is public.
 */
function DepositRail({ walletName }: { walletName: string }) {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const wei = useMemo(() => parseStrk(raw), [raw])

  if (!ready) return null
  return (
    <div className="flex flex-col gap-s6 rounded-card border border-solid border-surface3 p-s12">
      <Text variant="body4" className="uppercase text-neutral3">
        Add money from {walletName}
      </Text>
      <div className="flex gap-s8">
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          inputMode="decimal"
          placeholder="5"
          aria-label="Amount of STRK to move in"
          className="focus-ring w-full min-w-0 flex-1 rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 outline-none placeholder:text-neutral3"
        />
        <Button
          variant="secondary"
          size="md"
          disabled={wei === null || wei === 0n || busy}
          onClick={() => {
            if (wei === null || wei === 0n) return
            setBusy(true)
            void depositToPassbook(STRK_TOKEN, wei, ready.address).then((result) => {
              setBusy(false)
              if (result.ok) {
                setRaw('')
                toast({
                  kind: 'success',
                  title: `${toPlainText(wei, 18)} STRK on its way`,
                  detail: `Signed in ${walletName}. It lands at your address as public STRK — shield it from the wallet screen.`,
                })
              } else {
                toast({ kind: 'error', title: 'The deposit was not sent', detail: result.because })
              }
            })
          }}
        >
          {busy ? 'In your wallet…' : 'Send it'}
        </Button>
      </div>
    </div>
  )
}

/**
 * The picker.
 *
 * ── AN EMPTY LIST IS A STATE, NOT AN ERROR ────────────────────────────────────────────────
 *
 * Most visitors have no Starknet wallet installed, and for this product that is FINE — the
 * account already works. So "none found" renders as a plain sentence pointing at Ready, with no
 * error styling and no retry button. Treating it as a failure would tell people something is
 * broken at the exact moment nothing is.
 */
function WalletPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  //
  // Discovery runs when the dialog OPENS, not on mount.
  //
  // Two reasons, and the second is the important one. It keeps the SDK chunk off the surface for
  // anybody who never presses the button. And the wallet-standard list is populated by extensions
  // announcing themselves, so a read taken at page load can be genuinely empty on a browser that
  // does have a wallet — asking at the moment of intent is asking after everything has announced.
  //
  useEffect(() => {
    if (!open) return
    let live = true
    setWallets(null)
    void listWallets().then((found) => {
      if (live) setWallets(found)
    })
    return () => {
      live = false
    }
  }, [open])

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      label="Choose a wallet"
    >
      <div className="flex flex-col gap-s8 p-s16">
        <Text variant="body2" as="h2" className="font-medium text-neutral1">
          Choose a wallet
        </Text>
        {wallets === null ? (
          <Text variant="body4" className="text-neutral3">
            Looking for wallets…
          </Text>
        ) : wallets.length === 0 ? (
          <Text variant="body3" className="text-neutral2">
            No Starknet wallet found in this browser. Passbook works without one — this is only for
            moving money in from an existing wallet.
          </Text>
        ) : (
          wallets.map((w) => (
            <button
              key={w.id}
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setBusy(w.id)
                void connectWallet(w.id).then((result) => {
                  setBusy(null)
                  if (result.ok) {
                    onClose()
                    toast({ kind: 'success', title: `${w.name} connected` })
                  } else {
                    // The sentence comes from `connectWallet` — it is the one that knows whether
                    // this was a dismissed prompt, a wrong network, or a wallet that vanished.
                    toast({ kind: 'error', title: 'Could not connect', detail: result.because })
                  }
                })
              }}
              className={cn(
                'focus-ring flex items-center gap-s12 rounded-card bg-inset p-s12 text-left',
                'hover:bg-surface3',
              )}
            >
              <img src={w.icon} alt="" aria-hidden="true" className="h-s24 w-s24 rounded-control" />
              <Text variant="body3" className="text-neutral1">
                {w.name}
              </Text>
              <Text variant="body4" className="ml-auto text-neutral3">
                {busy === w.id ? 'connecting…' : 'connect'}
              </Text>
            </button>
          ))
        )}
      </div>
    </ResponsiveDialog>
  )
}
