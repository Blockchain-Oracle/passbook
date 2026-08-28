//
// Receive — the address, as a thing a phone camera can read.
//
// ── THE QR CARD IS HARD WHITE IN BOTH THEMES, AND THAT IS NOT A THEMING BUG ──────────────
//
// A QR reader thresholds the image: it needs dark modules on a light field with real contrast, and
// a quiet zone around the outside. Rendering the code on `--color-ground` would put a #131313
// pattern on a #131313 card in dark mode — invisible to the eye and unreadable to a scanner. So
// the card is `#fff` with 16px of padding whatever the theme is, and the two literal colours are
// deliberate off-palette values with a functional reason, exactly like `IdentityDisc`'s hues.
//
// ── ERROR CORRECTION IS `Q` BECAUSE THE MIDDLE IS OCCLUDED ───────────────────────────────
//
// The identity disc sits over the centre so a user can tell at a glance which account a code is
// for — and covering modules is only safe because level Q carries ~25% redundancy. Dropping to L
// or M with the disc still on would produce a code that scans on a good phone in good light and
// fails on a bad one, which is the worst possible failure for a payment address.
//
// ── AND THE ADDRESS IS SHOWN IN FULL ON DEMAND ───────────────────────────────────────────
//
// Elided by default, because 66 mono characters is a wall. But the elision hides the middle, which
// is where a substituted address would differ — so "Show full" is not a nicety, it is the control
// that makes visual verification possible at all.
//
import { useCallback, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { ADDRESS_IS_EXACT_BEFORE_DEPLOY, COPIED, COPY_ADDRESS } from '@strk20/protocol/account-copy'
import {
  buildPayLink,
  parsePayLinkSearch,
  PAY_NOTE_MAX_CHARS,
  type PayAsset,
} from '@strk20/protocol/pay-link'

import { cn } from '../lib/cn'
import { toast } from '../shell/toast-store'
import { shortenFelt } from '../shell/session'
import { IdentityDisc } from './IdentityDisc'
import { Button } from './LegacyButton'
import { Text } from './Text'

/** How much of the address survives the elision at each end. Enough to check both halves. */
const LEAD = 22
const TAIL = 14

export interface ReceivePanelProps {
  address: string
}

export default function ReceivePanel({ address }: ReceivePanelProps) {
  const [copied, setCopied] = useState(false)
  const [showFull, setShowFull] = useState(false)
  const [mode, setMode] = useState<'address' | 'request'>('address')
  const [asset, setAsset] = useState<PayAsset>('STRK')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')

  const request = useMemo(
    () => parsePayLinkSearch({ asset, amount, note }),
    [asset, amount, note],
  )
  const requestPath = useMemo(
    () => (request.ok ? buildPayLink(address, request.value) : null),
    [address, request],
  )
  const requestUrl = useMemo(() => {
    if (!requestPath) return null
    return typeof window === 'undefined' ? requestPath : `${window.location.origin}${requestPath}`
  }, [requestPath])
  const qrValue = mode === 'request' && requestUrl ? requestUrl : address

  const copy = useCallback((value: string, label: string) => {
    //
    // NO OPTIONAL CHAINING ON `clipboard`. `navigator.clipboard?.writeText(…).then(ok, fail)`
    // short-circuits the whole chain when the API is absent, so NEITHER branch runs — and absent is
    // exactly the shape a non-secure origin takes. Scanning this QR from a phone means the page is
    // being served over the LAN on plain http, which is the one situation where Copy has to at
    // least say why it did nothing.
    //
    if (!navigator.clipboard) {
      toast({
        kind: 'error',
        title: `The ${label} could not be copied`,
        detail: 'This browser does not offer the clipboard here — it needs a secure (https) page.',
      })
      return
    }
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      },
      (cause: unknown) => {
        toast({
          kind: 'error',
          title: `The ${label} could not be copied`,
          detail: `This browser refused the clipboard. Select the ${label} and copy it by hand.`,
        })
        console.warn('clipboard write failed', cause)
      },
    )
  }, [])

  const shown =
    showFull || address.length <= LEAD + TAIL + 1
      ? address
      : `${address.slice(0, LEAD)}…${address.slice(-TAIL)}`

  return (
    <div className="flex w-full min-w-0 flex-col gap-s16">
      <div className="flex flex-col gap-s4">
        <Text variant="display3" as="h2" className="text-neutral1">
          Receive
        </Text>
        <Text variant="body3" className="text-neutral2">
          {ADDRESS_IS_EXACT_BEFORE_DEPLOY}
        </Text>
      </div>

      {/*
        STACKED AT EVERY WIDTH, because the container is not the viewport. This renders inside the
        app's dialog, whose own `max-width` is 420px above the sheet threshold — so a `sm:flex-row`
        keyed on the VIEWPORT would put a 200px QR card beside the address block inside 372px of
        usable width on a 1440px screen. One column is the right answer in the box it is actually in.
      */}
      <div className="flex flex-col items-center gap-s12">
        <div className="flex w-full rounded-pill bg-inset p-s4" aria-label="Receive format">
          {(['address', 'request'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={mode === choice}
              onClick={() => {
                setMode(choice)
                setCopied(false)
              }}
              className={cn(
                'focus-ring min-h-s36 flex-1 rounded-pill px-s12 text-buttonLabel3 capitalize',
                mode === choice ? 'bg-accent1 text-ground' : 'text-neutral2 hover:text-neutral1',
              )}
            >
              {choice}
            </button>
          ))}
        </div>

        {mode === 'request' ? (
          <div className="grid w-full min-w-0 grid-cols-1 gap-s8 rounded-card border border-solid border-surface3 p-s12 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-s4">
              <span className="text-body4 text-neutral2">Asset</span>
              <select
                value={asset}
                onChange={(event) => setAsset(event.target.value as PayAsset)}
                className="focus-ring min-h-s44 rounded-control border border-solid border-surface3 bg-raised px-s12 text-body3 text-neutral1"
              >
                <option value="STRK">STRK</option>
                <option value="USDC">USDC</option>
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-s4">
              <span className="text-body4 text-neutral2">Amount · optional</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-invalid={!request.ok || undefined}
                className="focus-ring numeric min-h-s44 min-w-0 rounded-control border border-solid border-surface3 bg-raised px-s12 text-body3 text-neutral1"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-s4 sm:col-span-2">
              <span className="text-body4 text-neutral2">Note · optional, not on chain</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={PAY_NOTE_MAX_CHARS}
                rows={2}
                placeholder="What is this payment for?"
                className="focus-ring min-w-0 resize-none rounded-control border border-solid border-surface3 bg-raised p-s12 text-body3 text-neutral1"
              />
            </label>
            {!request.ok ? (
              <Text variant="body4" className="text-irreversible sm:col-span-2" role="alert">
                {request.because}
              </Text>
            ) : null}
          </div>
        ) : null}

        {/*
          `#fff` and `#131313` as literals: see the header. `marginSize={0}` because the card's own
          16px padding IS the quiet zone — letting the library draw a second one inside would shrink
          the modules for no gain.
        */}
        <div
          className="relative flex shrink-0 rounded-card p-s16"
          style={{ backgroundColor: '#ffffff' }}
        >
          <QRCodeSVG value={qrValue} size={168} level="Q" marginSize={0} fgColor="#131313" bgColor="#ffffff" />
          {/*
            The disc, ringed in the same white as the card so the occlusion is a clean square the
            error correction can absorb rather than a ragged edge over live modules.
          */}
          <span
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 rounded-pill p-s4"
            style={{ backgroundColor: '#ffffff' }}
          >
            <IdentityDisc address={address} size={34} />
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-s8">
          <Text variant="body4" className="text-neutral3">
            {mode === 'request' ? 'Payment request link' : 'Your account address'}
          </Text>
          <code
            className={cn(
              'block break-all rounded-card bg-inset p-s12 font-mono text-mono text-neutral1',
              // `select-all` so one click takes the whole value — a partial selection of an address
              // is the single most dangerous thing a user can paste.
              'select-all',
            )}
          >
            {mode === 'request' ? (requestUrl ?? 'Fix the request fields above') : shown}
          </code>
          <div className="flex flex-wrap gap-s8">
            <Button
              variant="primary"
              size="sm"
              disabled={mode === 'request' && requestUrl === null}
              onClick={() =>
                copy(
                  mode === 'request' ? (requestUrl ?? '') : address,
                  mode === 'request' ? 'request link' : 'address',
                )
              }
            >
              {copied ? COPIED : mode === 'request' ? 'Copy request link' : COPY_ADDRESS}
            </Button>
            {mode === 'address' ? (
              <Button variant="tertiary" size="sm" onClick={() => setShowFull((on) => !on)}>
                {showFull ? 'Show less' : 'Show full'}
              </Button>
            ) : null}
          </div>
          <Text variant="body4" className="text-neutral3">
            {mode === 'request'
              ? 'The link prefills Send. Its note is human context only and is not written into the transaction.'
              : `Anything sent to ${shortenFelt(address, 8, 6)} reaches this public account first. The amount and sender are visible until those funds are shielded in a separate transaction.`}
          </Text>
        </div>
      </div>
    </div>
  )
}
