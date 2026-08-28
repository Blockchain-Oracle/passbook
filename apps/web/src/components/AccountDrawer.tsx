//
// The popup behind the account chip — rebuilt against the STUDIO prototype's own account modal.
//
// ── IT IS A MODAL, NOT A RIGHT-HAND RAIL ─────────────────────────────────────────────────
//
// [Abu 2026-08-28] The previous build floated a 368px rail pinned under the header with a
// per-breakpoint top offset it had to keep in step with a wrapping header. The prototype does not
// have that shape at all: `dr.on` renders a centred `min(400px,100%)` sheet on a scrim, bottom-
// aligned on a phone. That is exactly `ResponsiveDialog`, so the rail and its offset arithmetic are
// gone rather than restyled — one popup primitive, and the header can now change height freely.
//
// ── THE META CAME OFF ────────────────────────────────────────────────────────────────────
//
// It used to carry: a balance line, the full 66-character address as a copy slab, a sentence about
// counterfactual addresses, four chevron rows each explaining itself in a sentence, a Settings link
// the header already has, and a closing line repeating the address. Seven blocks of prose to reach
// four verbs. The prototype's answer is a list of ACCOUNTS and a row of VERBS, and the only prose
// is the one line at the bottom that says what Lock actually is.
//
// Switching is therefore inline — the accounts are on screen, so pressing one switches. The old
// `switch` sub-view existed only because the list was hidden behind a row, and deleting the list's
// hiding place deletes the sub-view with it.
//
// ── THE CLIPBOARD IS AFFIRMED FROM ITS OWN SUCCESS CALLBACK, NEVER BEFORE ────────────────
//
// `navigator.clipboard.writeText` returns a promise that rejects on a denied permission, a
// non-secure context, or a document that is not focused. Setting "Copied" beside the call tells a
// user their address is on the clipboard when it is not — and they paste whatever was there
// before, which on a payment screen is somebody else's address. The active card IS the copy
// control, which is where that affordance went when the address slab came off.
//
import { useCallback, useState } from 'react'

import {
  COPIED,
  EXPORT_ROW_LABEL,
  IMPORT_TITLE,
  LOCKED_BODY,
  LOCKED_HEADLINE,
  LOCKED_BODY_SEALED,
  LOCK_WHAT_IT_DOES,
  LOCK_WHAT_IT_DOES_SEALED,
  UNLOCK_PASSWORD_LABEL,
  UNLOCK_ACTION,
} from '@strk20/protocol/account-copy'

import { cn } from '../lib/cn'
import { toast } from '../shell/toast-store'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import {
  createAccount,
  lockSession,
  usePasswordSet,
  shortenFelt,
  switchAccount,
  unlockSession,
  useSession,
  type AccountSummary,
} from '../shell/session'
import { BackupCeremony } from './BackupCeremony'
import { ImportPanel, ImportPanelStandalone } from './ImportPanel'
import { ConnectWallet } from './ConnectWallet'
import { IdentityDisc } from './IdentityDisc'
import { PasswordField } from './PasswordField'
import { Button } from './LegacyButton'
import { Text } from './Text'

/** Which panel is showing. `main` is the account list; the others are one job each. */
type View = 'main' | 'import' | 'export' | 'connect'

export interface AccountDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AccountDrawer({ open, onOpenChange }: AccountDrawerProps) {
  const [view, setView] = useState<View>('main')

  // HOISTED OUT OF THE PANEL on purpose: `ResponsiveDialog` is one tree across the sheet
  // threshold, but the import panel unmounts whenever the view changes, and a half-filled
  // recovery form should survive a trip to the backup ceremony and back.
  const [importFile, setImportFile] = useState<{ name: string; text: string } | null>(null)
  const [importCode, setImportCode] = useState('')

  //
  // EVERY OPEN STARTS AT THE LIST, AND THE RESET HAPPENS ON THE WAY OUT.
  //
  // A popup that reopens on the import panel because that is where it was last closed has hidden
  // its own contents. The obvious version — an effect on `open` — resets one paint too late: the
  // reopened popup renders and PAINTS with the previous view, so reopening after an export shows
  // a frame of the backup ceremony. Effects run after the browser has already drawn.
  //
  const close = useCallback(
    (next: boolean) => {
      if (!next) setView('main')
      onOpenChange(next)
    },
    [onOpenChange],
  )

  return (
    <ResponsiveDialog open={open} onOpenChange={close} label="Account" modal>
      <DrawerBody
        view={view}
        onView={setView}
        onClose={() => close(false)}
        importFile={importFile}
        onImportFile={setImportFile}
        importCode={importCode}
        onImportCode={setImportCode}
      />
    </ResponsiveDialog>
  )
}

interface BodyProps {
  view: View
  onView: (view: View) => void
  onClose: () => void
  importFile: { name: string; text: string } | null
  onImportFile: (file: { name: string; text: string } | null) => void
  importCode: string
  onImportCode: (code: string) => void
}

function DrawerBody(props: BodyProps) {
  const session = useSession()

  if (session.status === 'loading') {
    return (
      <Text variant="body3" className="text-neutral2">
        Deriving this browser&rsquo;s account…
      </Text>
    )
  }

  if (session.status === 'failed') {
    return (
      <Text variant="body3" className="text-exposed">
        {session.because}
      </Text>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-s12 overflow-y-auto">
      <div className="flex items-center justify-between gap-s8">
        <Text variant="kicker">
          {props.view === 'import'
            ? IMPORT_TITLE
            : props.view === 'export'
              ? EXPORT_ROW_LABEL
              : props.view === 'connect'
                ? 'Connect Ready Wallet'
                : 'This browser holds'}
        </Text>
        {/*
          The prototype's × sits in the header row rather than floating over the content. A
          sub-view puts a Back in the same slot — same position, DIFFERENT GLYPH, because an ×
          that returns to the list instead of dismissing the popup is a control that lies about
          what it does, and this one is the only control in the header.
        */}
        <HeaderButton
          kind={props.view === 'main' ? 'close' : 'back'}
          onClick={props.view === 'main' ? props.onClose : () => props.onView('main')}
        />
      </div>

      {session.status === 'locked' ? (
        props.view === 'import' ? (
          <ImportPanelStandalone onDone={() => props.onView('main')} />
        ) : (
          <LockedPanel
            problem={session.problem}
            accounts={session.accounts}
            sealed={session.sealed}
            onView={props.onView}
          />
        )
      ) : props.view === 'import' ? (
        <ImportPanel
          file={props.importFile}
          onFile={props.onImportFile}
          code={props.importCode}
          onCode={props.onImportCode}
          onDone={() => props.onView('main')}
        />
      ) : props.view === 'export' ? (
        <BackupCeremony
          accountKey={session.accountKey}
          receiveAddress={session.address}
          onComplete={() => undefined}
        />
      ) : props.view === 'connect' ? (
        <ConnectWallet />
      ) : (
        <MainPanel
          address={session.address}
          label={session.label}
          accounts={session.accounts}
          onView={props.onView}
        />
      )}
    </div>
  )
}

// ── The list ──────────────────────────────────────────────────────────────────────────────

/**
 * The account list and the verbs, in the prototype's order.
 *
 * There is no "Disconnect" for the ACCOUNT and there never was one to remove: it is an embedded
 * key, so there is no wallet to disconnect from — Lock is that verb, and the footnote says what
 * it does. "Connect Ready Wallet" below is a different thing entirely: an EXTERNAL wallet,
 * connected as a funding source and optional fee-payer, never as the identity. Its own view
 * carries the copy that keeps those apart; its Disconnect belongs to it.
 */
function MainPanel({
  address,
  label,
  accounts,
  onView,
}: {
  address: string
  label: string | null
  accounts: readonly AccountSummary[]
  onView: (view: View) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const others = accounts.filter((account) => account.address !== address)
  // `null` while the storage tier is still answering. Treated as unsealed below, which selects the
  // WEAKER claim — never an overclaim, which is the only direction that matters here.
  const passwordSet = usePasswordSet() === true

  return (
    <>
      <ActiveAccount address={address} label={label} />

      {others.map((account) => (
        <button
          key={account.address}
          type="button"
          disabled={busy !== null}
          onClick={() => {
            setBusy(account.address)
            void switchAccount(account.address).then((result) => {
              setBusy(null)
              if (!result.ok) toast({ kind: 'error', title: 'Could not switch', detail: result.because })
            })
          }}
          className={cn(
            'focus-ring flex cursor-pointer items-center gap-s12 rounded-card border border-solid',
            'border-surface3 p-s12 text-left transition-colors',
            'duration-[var(--transition-duration-fastHeavy)] ease-glide',
            'hover:bg-inset disabled:cursor-default disabled:opacity-60',
          )}
        >
          <IdentityDisc address={account.address} size={34} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body2 font-medium text-neutral1">
              {account.label ?? 'Another account'}
            </span>
            <span className="numeric truncate font-mono text-mono text-neutral3">
              {shortenFelt(account.address)}
            </span>
          </span>
          <span className="shrink-0 text-body4 text-neutral3">
            {busy === account.address ? 'switching…' : 'switch'}
          </span>
        </button>
      ))}

      {/*
        THREE VERBS ON ONE LINE, as the prototype draws them. `min-w-0` on the row's children is
        what stops "New account" from forcing the row wider than the popup at 320.

        The label is the prototype's "New account", not `account-copy`'s `CREATE_ACTION` ("Create
        another account"). That constant was written for a full-width row and is three words too
        long for a third of a 400px popup; it is still the module's word for the ACTION and still
        under test, it is just not what fits in this particular box.
      */}
      <div className="flex gap-s8">
        <VerbButton
          busy={busy === 'new'}
          disabled={busy !== null}
          onClick={() => {
            setBusy('new')
            void createAccount().then((result) => {
              setBusy(null)
              if (!result.ok)
                toast({ kind: 'error', title: 'Could not create an account', detail: result.because })
            })
          }}
        >
          {busy === 'new' ? 'Creating…' : 'New account'}
        </VerbButton>
        <VerbButton disabled={busy !== null} onClick={() => onView('import')}>
          Import file
        </VerbButton>
        <VerbButton
          busy={busy === 'lock'}
          disabled={busy !== null}
          onClick={() => {
            setBusy('lock')
            void lockSession().then((result) => {
              setBusy(null)
              if (!result.ok) toast({ kind: 'error', title: 'Could not lock', detail: result.because })
            })
          }}
        >
          Lock
        </VerbButton>
      </div>

      {/*
        THE FOURTH VERB, AND IT IS NOT IN THE PROTOTYPE'S ROW BECAUSE THE PROTOTYPE HAS NO BACKUP.
        Dropping it to match the picture would leave the recovery file with no door anywhere in the
        app — Settings does not carry one — so a key that only exists in this browser would have no
        way out of it. It gets its own full-width line rather than a fourth column, which keeps the
        three-verb rhythm intact.
      */}
      <VerbButton fill disabled={busy !== null} onClick={() => onView('export')}>
        {EXPORT_ROW_LABEL}
      </VerbButton>

      {/*
        THE CONNECT VERB LIVES HERE — the review's ruling: "it's supposed to be in the modal…
        it is called Connect to Ready Wallet." The wallet surface no longer carries the card;
        the account popup is where somebody managing their account expects to find it.
      */}
      <VerbButton fill disabled={busy !== null} onClick={() => onView('connect')}>
        Connect Ready Wallet
      </VerbButton>

      {/*
        The two lock sentences are genuinely different claims and the surface must pick the true
        one — see `account-copy.ts`. `usePasswordSet` answers from storage rather than from session
        state, because a password can be set from Settings while this drawer is mounted.
      */}
      <Text variant="body4" className="text-neutral3">
        {passwordSet ? LOCK_WHAT_IT_DOES_SEALED : LOCK_WHAT_IT_DOES}
      </Text>
    </>
  )
}

/**
 * The active account: lime-washed, and the whole card is the copy control.
 *
 * The address is a `<button>` wrapping the mono string rather than a string with a button beside
 * it, because the string IS the affordance — every wallet has taught people that tapping an
 * address copies it. `active` on the right becomes `copied` for the beat after a confirmed write,
 * which is the same slot doing both jobs rather than a second line appearing under the card.
 */
function ActiveAccount({ address, label }: { address: string; label: string | null }) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    //
    // NO OPTIONAL CHAINING ON `clipboard`, AND THAT IS THE WHOLE BUG THIS AVOIDS.
    //
    // `navigator.clipboard?.writeText(…).then(ok, fail)` short-circuits the ENTIRE chain when the
    // API is absent, so neither branch runs: on a non-secure origin — a phone hitting
    // `http://192.168.x.x:5173`, which is how this gets demoed — tapping the address did nothing
    // at all. No "Copied", no error, no console line. And a missing `clipboard` is precisely the
    // shape the non-secure-context case takes; it is not a rejecting promise.
    //
    if (!navigator.clipboard) {
      cannotCopy('This browser does not offer the clipboard here — it needs a secure (https) page.')
      return
    }
    // Promise form, and `Copied` is set in the SUCCESS branch only. See the file header.
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      },
      (cause: unknown) => {
        cannotCopy('This browser refused the clipboard. Select the address and copy it by hand.')
        console.warn('clipboard write failed', cause)
      },
    )
  }, [address])

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy this account's address, ${address}`}
      className={cn(
        'focus-ring flex cursor-pointer items-center gap-s12 rounded-card border border-solid',
        'border-accent2Hovered bg-accent2 p-s12 text-left',
      )}
    >
      <IdentityDisc address={address} size={34} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body2 font-medium text-neutral1">
          {label ?? 'This browser’s account'}
        </span>
        <span className="numeric truncate font-mono text-mono text-neutral2">
          {shortenFelt(address)}
        </span>
      </span>
      {/* Lowercased in CSS, not by `.toLowerCase()` — `COPIED` is the app's word for this state
          and the casing is this card's house style, which is a presentation decision. */}
      <span className="shrink-0 text-body4 lowercase text-accent1">{copied ? COPIED : 'active'}</span>
    </button>
  )
}

// ── The other two states ──────────────────────────────────────────────────────────────────

function LockedPanel({
  problem,
  accounts,
  sealed,
  onView,
}: {
  problem: string | null
  accounts: readonly AccountSummary[]
  /** True when a password is required. Chooses the copy AND whether there is a field at all. */
  sealed: boolean
  onView: (view: View) => void
}) {
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')

  // Kept identical to `wallet.tsx`'s handler on purpose: two doors into the same lock, and a user
  // who unlocks from the drawer must not get different behaviour from one who unlocks from the
  // surface. Cleared on success only — see that file for why a wrong password keeps the text.
  const unlock = () => {
    if (busy || (sealed && password === '')) return
    setBusy(true)
    void unlockSession(sealed ? password : undefined).then((result) => {
      setBusy(false)
      if (result.ok) setPassword('')
      else toast({ kind: 'error', title: 'Could not unlock', detail: result.because })
    })
  }

  return (
    <>
      <Text variant="body2" className="font-medium text-neutral1">
        {LOCKED_HEADLINE}
      </Text>
      <Text variant="body3" className="text-neutral2">
        {sealed ? LOCKED_BODY_SEALED : LOCKED_BODY}
      </Text>
      {/* No field on an unsealed browser: there would be no secret to check it against. */}
      {sealed ? (
        <PasswordField
          label={UNLOCK_PASSWORD_LABEL}
          value={password}
          onChange={setPassword}
          onSubmit={unlock}
          autoComplete="current-password"
          disabled={busy}
        />
      ) : null}
      {problem ? (
        <Text variant="body3" className="text-irreversible" role="alert">
          {problem}
        </Text>
      ) : null}
      <Button
        variant="primary"
        size="md"
        fill
        disabled={busy || (sealed && password === '')}
        onClick={unlock}
      >
        {busy ? 'Unlocking…' : UNLOCK_ACTION}
      </Button>
      <VerbButton fill onClick={() => onView('import')}>
        {IMPORT_TITLE}
      </VerbButton>
      {accounts.length > 1 ? (
        <Text variant="body4" className="text-neutral3">
          {accounts.length} accounts are saved in this browser. Unlock to switch between them.
        </Text>
      ) : null}
    </>
  )
}

/** The import panel with its own file/code state, for the locked screen. */
// ── Furniture ─────────────────────────────────────────────────────────────────────────────

/** One sentence, one toast — so both clipboard failures report through the same door. */
function cannotCopy(detail: string): void {
  toast({ kind: 'error', title: 'The address could not be copied', detail })
}

/**
 * The prototype's verb button: a quiet inset tile that firms up its border on hover.
 *
 * Not `Button variant="tertiary"` — that primitive is sized for a form's footer and carries the
 * app's control height. These are 11px-padded tiles that sit three to a 400px row, which is a
 * different object with a different job, and forcing it through the shared primitive would mean
 * teaching that primitive a size only this popup uses.
 */
function VerbButton({
  children,
  onClick,
  disabled = false,
  busy = false,
  fill = false,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  fill?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        'focus-ring cursor-pointer rounded-control border border-solid border-surface3 bg-inset',
        'px-s8 py-s12 text-center text-buttonLabel4 text-neutral1 transition-colors',
        'duration-[var(--transition-duration-fastHeavy)] ease-glide',
        'hover:border-surface3Hovered hover:bg-insetHovered',
        'disabled:cursor-default disabled:opacity-60',
        fill ? 'w-full' : 'min-w-0 flex-1',
      )}
    >
      {children}
    </button>
  )
}

function HeaderButton({ kind, onClick }: { kind: 'close' | 'back'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={kind === 'close' ? 'Close' : 'Back'}
      className={cn(
        'focus-ring flex size-s28 shrink-0 cursor-pointer items-center justify-center rounded-pill',
        'text-neutral3 transition-colors duration-[var(--transition-duration-fastHeavy)]',
        'ease-glide hover:bg-inset hover:text-neutral1',
      )}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d={kind === 'close' ? 'M6 6l12 12M18 6L6 18' : 'M15 5l-7 7 7 7'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
