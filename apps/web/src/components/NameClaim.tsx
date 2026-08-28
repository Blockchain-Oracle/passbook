//
// Claiming a name in the public directory.
//
// ── THE SIGNATURE IS THE WHOLE POINT OF THE FEATURE ──────────────────────────────────────
//
// Without it a directory is a list anyone can write anything into: `alice → 0x<attacker>` costs
// nothing, and the first person to type a common name owns it against the person who actually uses
// it. So a claim is signed with the VIEWING KEY — the key registration anchored on chain — and the
// relayer verifies it against `get_public_key(address)`. A name can therefore only be pointed at
// an address whose key the claimant holds.
//
// That is also why this refuses before signing when the account is not registered: there is no
// on-chain key to verify against, so the relayer would reject it after the round trip.
//
// ── AND THE WARNING IS NOT A FOOTNOTE ────────────────────────────────────────────────────
//
// `DIRECTORY_IS_PUBLIC` sits above the field, not under the button. Registration is already
// publicly enumerable on chain; what this adds is the link from a handle somebody chose to that
// address — and it says so before the name is typed rather than after it is published.
//
import { useCallback, useState } from 'react'

import {
  DIRECTORY_CLAIM_NEEDS_REGISTRATION,
  DIRECTORY_IS_PUBLIC,
  DIRECTORY_NAME_MALFORMED,
  DIRECTORY_TITLE,
} from '@strk20/protocol/chat-copy'
// THE PURE MODULE, STATICALLY. `directory.ts` reaches `starknet` for the curve signature, and
// importing anything from it here would make the dynamic `signClaim` below move nothing —
// which is exactly what the build gate caught (`INEFFECTIVE_DYNAMIC_IMPORT`) and why
// `directory-name.ts` exists.
import {
  AVATAR_PATTERN,
  DIRECTORY_NAME_PATTERN,
  MAX_AVATAR_CHARS,
  normalizeDirectoryName,
} from '@strk20/protocol/directory-name'

import { cn } from '../lib/cn'
import { claimName, nameFor, useDirectory } from '../shell/use-directory'
import { toast } from '../shell/toast-store'
import { useSession } from '../shell/session'
import { Button } from './LegacyButton'
import { PeerAvatar } from './PeerAvatar'
import { Text } from './Text'

export function NameClaim() {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { entries } = useDirectory()
  const held = ready ? nameFor(entries, ready.address) : null

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)

  const normalized = normalizeDirectoryName(name)
  const wellFormed = DIRECTORY_NAME_PATTERN.test(normalized)

  const claim = useCallback(async () => {
    if (!ready || !wellFormed) return
    setBusy(true)
    setProblem(null)

    // Dynamic, for the gate's reason: `directory.ts` reaches `starknet` for the curve signature,
    // and `/settings` must not drag the crypto graph into a chunk that only wanted a form.
    const { signClaim } = await import('@strk20/protocol/directory')
    const signature = signClaim(normalized, ready.address, ready.viewingKey)

    const outcome = await claimName({
      name: normalized,
      address: ready.address,
      signature,
      // Omitted rather than sent as `undefined`: the relayer validates the field's SHAPE when it is
      // present, and a key holding `undefined` survives `JSON.stringify` as an absent key anyway —
      // being explicit here means the request body says what it means.
      ...(avatar === null ? {} : { avatar }),
    })
    setBusy(false)

    if (!outcome.ok) {
      setProblem(outcome.because)
      return
    }
    setName('')
    toast({
      kind: 'success',
      title: `You are @${normalized}`,
      detail: 'Anyone can now find this address by that name.',
    })
    // `avatar` IS A DEPENDENCY. Without it the callback closes over the value from the render that
    // created it — `null` — so a picture chosen after mount would be dropped on submit and the
    // claim would silently publish without it.
  }, [ready, normalized, wellFormed, avatar])

  return (
    <section className="flex flex-col gap-s12 rounded-large border border-solid border-surface3 p-s16">
      <div className="flex flex-col gap-s4">
        <Text variant="subheading1" as="h2">
          {DIRECTORY_TITLE}
        </Text>
        <Text variant="body3" className="text-neutral2">
          {DIRECTORY_IS_PUBLIC}
        </Text>
      </div>

      {held ? (
        <Text variant="body3" className="text-settled">
          This address is listed as @{held}. Claiming another name replaces it.
        </Text>
      ) : null}

      {ready === null ? (
        <Text variant="body3" className="text-neutral2">
          {DIRECTORY_CLAIM_NEEDS_REGISTRATION}
        </Text>
      ) : (
        <>
          <label className="flex flex-col gap-s4">
            <span className="text-body4 text-neutral2">Name</span>
            <div className="flex items-center gap-s8">
              <span aria-hidden="true" className="text-body2 text-neutral3">
                @
              </span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setProblem(null)
                }}
                placeholder="yourname"
                aria-label="The name to claim"
                spellCheck={false}
                autoComplete="off"
                className={cn(
                  'focus-ring min-h-s48 w-full rounded-card border border-solid bg-raised px-s12',
                  'text-body3 text-neutral1 placeholder:text-neutral3',
                  problem ? 'border-irreversible' : 'border-surface3',
                )}
              />
            </div>
            {/* The rule, shown while it is being broken rather than after the submit. */}
            {name.trim() !== '' && !wellFormed ? (
              <Text variant="body4" className="text-exposed">
                {DIRECTORY_NAME_MALFORMED}
              </Text>
            ) : null}
          </label>

          <AvatarField
            address={ready.address}
            avatar={avatar}
            onAvatar={setAvatar}
            onProblem={setProblem}
          />

          {problem ? (
            <Text variant="body3" className="text-irreversible" role="alert">
              {problem}
            </Text>
          ) : null}

          <Button
            variant="primary"
            size="md"
            fill
            disabled={busy || !wellFormed}
            onClick={() => void claim()}
          >
            {busy ? 'Claiming…' : `Claim @${normalized || 'name'}`}
          </Button>

          <Text variant="body4" className="text-neutral3">
            The claim is signed with the key this account registered on chain, so a name cannot be
            pointed at an address somebody does not control.
          </Text>
        </>
      )}
    </section>
  )
}

/**
 * The optional profile picture.
 *
 * ── IT IS DOWNSCALED HERE, NOT VALIDATED HERE AND SENT WHOLE ─────────────────────────────
 *
 * `MAX_AVATAR_CHARS` is about 9 kB of image, which a phone photo exceeds by three orders of
 * magnitude. Checking the size and refusing would be technically correct and useless — nobody has
 * a 9 kB file to hand. So the browser draws it into a 96px canvas and re-encodes, which is what
 * makes "upload a picture" a thing an ordinary photo can actually do.
 *
 * The result is a `data:` URI and never a URL. `directory-name.ts`'s `AVATAR_PATTERN` enforces
 * that on both sides, and its comment carries the reason: loading a profile image from a third-party
 * host would report to that host every time anybody opened a conversation with this peer.
 */
function AvatarField({
  address,
  avatar,
  onAvatar,
  onProblem,
}: {
  address: string
  avatar: string | null
  onAvatar: (next: string | null) => void
  onProblem: (problem: string | null) => void
}) {
  return (
    <div className="flex items-center gap-s12">
      <PeerAvatar address={address} avatar={avatar} size={48} />
      <div className="flex min-w-0 flex-1 flex-col gap-s4">
        <label className="text-body4 text-neutral2">Picture (optional)</label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={cn(
            'focus-ring w-full rounded-card border border-solid border-surface3 bg-raised',
            'p-s8 text-body4 text-neutral2',
            'file:mr-s12 file:rounded-small file:border-0 file:bg-inset file:px-s12 file:py-s4',
            'file:text-buttonLabel4 file:text-neutral1',
          )}
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            onProblem(null)
            if (!chosen) {
              onAvatar(null)
              return
            }
            void downscale(chosen).then(onAvatar, () => {
              onAvatar(null)
              onProblem('That image could not be read. Try a PNG, JPEG or WebP.')
            })
          }}
        />
        {avatar ? (
          <button
            type="button"
            onClick={() => onAvatar(null)}
            className="focus-ring self-start text-body4 text-neutral3 underline"
          >
            Remove picture
          </button>
        ) : (
          <span className="text-body4 text-neutral3">
            Without one, the coloured mark above is what people see. It is drawn from the address,
            so it is already the same everywhere.
          </span>
        )}
      </div>
    </div>
  )
}

/** The image, as a 96px square `data:` URI small enough for the ledger. */
async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const SIDE = 96
    const canvas = document.createElement('canvas')
    canvas.width = SIDE
    canvas.height = SIDE
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('this browser gave no 2d canvas')

    // COVER, NOT STRETCH: the shorter edge fills the square and the overflow is cropped evenly, so
    // a portrait photo becomes a centred crop rather than a squashed face.
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      SIDE,
      SIDE,
    )

    // WebP first, JPEG as the fallback: WebP is roughly a third smaller at this size, and a browser
    // that does not encode it returns a PNG data URI from `toDataURL`, which at 96px can still
    // exceed the cap. The quality ramp is what guarantees termination under the cap rather than
    // hoping one setting fits every image.
    for (const quality of [0.8, 0.6, 0.4]) {
      for (const type of ['image/webp', 'image/jpeg']) {
        const encoded = canvas.toDataURL(type, quality)
        if (AVATAR_PATTERN.test(encoded) && encoded.length <= MAX_AVATAR_CHARS) return encoded
      }
    }
    throw new Error('the image would not compress under the size cap')
  } finally {
    // Explicitly released: an ImageBitmap holds decoded pixels, and a settings page somebody tries
    // four pictures on would otherwise keep four full-resolution decodes alive.
    bitmap.close()
  }
}
