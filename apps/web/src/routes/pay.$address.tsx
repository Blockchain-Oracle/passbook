//
// Scan-to-pay: someone else's address, arrived at by link or by camera.
//
// ── WHAT THIS PAGE IS FOR ─────────────────────────────────────────────────────────────────
//
// `ReceivePanel` shows YOUR address so somebody can pay you. This is the other end of that
// exchange: the page their phone lands on. It shows whose address this is, proves it is a real one,
// and hands off to the send form with the recipient already filled in — so the person paying never
// retypes a 64-character felt they cannot proof-read.
//
// ── THE PARAM IS NOT AN ADDRESS UNTIL IT IS PARSED, AND SOMETIMES IT NEVER IS ─────────────
//
// The build gate visits the LITERAL route `/pay/$address`, so `params.address` is the eight
// character string `"$address"`. That is not an edge case to be defended against; it is a request
// this page receives on every build, and it stands in for the much likelier real one — a truncated
// link, a mis-copied address, a QR read badly in poor light.
//
// So the page parses first and branches. `maybeAddress` returns `null` rather than throwing, which
// is what makes "this link does not name an address" a state this surface can render instead of a
// blank screen or a crash. Nothing downstream is reached with an unparsed value.
//
// ── AND IT NEVER CLAIMS THE RECIPIENT IS REGISTERED ───────────────────────────────────────
//
// Whether an address can actually receive a shielded transfer is a pool read the SEND form already
// does, with its own copy for the answer. Doing it here too would either duplicate that logic or,
// worse, render an encouraging page for an address that cannot be paid. This page proves the link
// is well-formed and hands over; the form decides whether the payment can happen.
//
import { createFileRoute, Link } from '@tanstack/react-router'

import { maybeAddress, toFeltHex } from '@strk20/protocol/address'

import ReceivePanel from '../components/ReceivePanel'
import { Text } from '../components/ui/Text'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/pay/$address')({
  component: Pay,
})

function Pay() {
  const { address } = Route.useParams()

  // Parsed once, here. Everything below reads the RESULT, so there is no path on which a
  // half-validated string reaches a QR code or a send link.
  const parsed = maybeAddress(address)

  if (parsed === null) {
    return (
      <Surface routeId={Route.fullPath}>
        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s12">
          <Text variant="heading3" as="h1">
            That link is not an address
          </Text>
          <Text variant="body3" className="text-neutral2">
            A payment link carries the recipient&rsquo;s address, and this one does not. It may have
            been cut short when it was copied, or scanned badly. Ask for it again rather than
            guessing — an address that is one character out belongs to somebody else, or to nobody.
          </Text>
          {/* A dead end with no way forward is a worse dead end. The send form takes an address
              typed or pasted by hand, which is exactly the fallback this situation needs. */}
          <Link to="/send" className="focus-ring text-body3 text-accent1 underline underline-offset-2">
            Enter the address by hand instead
          </Link>
        </div>
      </Surface>
    )
  }

  // Canonicalised before it is displayed or handed on: `0x0403…` and `0x403…` are one address, and
  // the QR, the link and the copy button should all carry the same spelling of it.
  const canonical = toFeltHex(parsed)

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s16">
        <div className="flex flex-col gap-s4">
          <Text variant="heading3" as="h1">
            Pay this address
          </Text>
          <Text variant="body3" className="text-neutral2">
            Someone shared this address with you. Check it against the one they sent before you send
            anything.
          </Text>
        </div>

        {/*
          THE SAME PANEL THE RECEIVE FLOW USES, pointed at somebody else's address.

          Reused rather than reimplemented, and the reason is the panel's own header: its QR card is
          hard white in both themes because a reader thresholds the image. A second QR built here
          would be a second place for that to be got wrong — and this is the copy of it that a
          stranger's camera actually reads.
        */}
        <ReceivePanel address={canonical} />

        {/* The handoff. The address travels in the URL so the form is filled before it renders —
            nobody should retype a 64-character felt they have no way to proof-read. */}
        <Link
          to="/send"
          search={{ to: canonical }}
          className="cta focus-ring flex min-h-s48 w-full items-center justify-center rounded-control bg-accent1 text-buttonLabel2 text-ground"
        >
          Continue to send
        </Link>
      </div>
    </Surface>
  )
}
