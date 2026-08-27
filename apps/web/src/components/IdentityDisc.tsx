//
// The one mark that stands for an account, anywhere in this app.
//
// ── WHY A GRADIENT DISC AND NOT AN AVATAR ────────────────────────────────────────────────
//
// It is not a picture of a person and does not pretend to be one. Its whole job is to be MATCHABLE
// — the same address draws the same disc every time, on the chip, in the drawer, in the switch
// list, and beside a peer in chat — so the eye can answer "is this the same account as yesterday"
// without reading sixty-six hex characters. Uniswap's `Unicon` is the same idea with more
// machinery; Yosuku's `CommentRoom.tsx:36-40` is the same idea in five lines, and this is that.
//
// ── THE HASH READS PAST THE `0x`, WHICH IS THE DIFFERENCE BETWEEN A PALETTE AND A SMUDGE ─
//
// Starknet addresses are frequently written zero-padded to 64 characters, so a hash that walked
// the first twelve characters of `0x0043c2…` and `0x0051aa…` would be reading mostly zeros and
// two accounts would come out nearly the same hue. Starting at index 2 and taking the first ten
// significant characters is what spreads real addresses across the wheel.
//
// ── AND THE COLOUR IS DELIBERATELY OFF-PALETTE ───────────────────────────────────────────
//
// Hand-mixed HSL rather than a design token, for `TokenLogo`'s reason: this is an IDENTITY mark,
// not a statement about state. Routing it through the semantic palette would make an account's
// colour mean something — settled, exposed, irreversible — that it does not.
//
import { cn } from '../lib/cn'

/**
 * The hue an address hashes to, 0–359. Exported because the switch list tints a row with it and
 * the two must agree; a second copy of this loop is how a row and its disc come to disagree.
 */
export function identityHue(address: string): number {
  let hash = 0
  // From 2, so the `0x` is skipped; to 12, so it is the leading significant nibbles that decide.
  for (let index = 2; index < Math.min(address.length, 12); index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) % 360
  }
  return hash
}

export interface IdentityDiscProps {
  /** The account's address. Anything stable works, but the address is what other surfaces have. */
  address: string
  /** Rendered edge length in px. 16 on the chip, 48 in the drawer, 40 in a list row. */
  size?: number
  className?: string
}

export function IdentityDisc({ address, size = 24, className }: IdentityDiscProps) {
  const hue = identityHue(address)
  // A second hue a fifth of the wheel away: far enough to read as a lit sphere rather than a flat
  // circle, close enough that the disc still has one identity a person can name ("the teal one").
  const shade = (hue + 72) % 360

  return (
    <span
      aria-hidden="true"
      // `aria-hidden` because it carries no information a reader does not already have — the
      // address itself is always beside it. A label here would announce a colour, which is noise.
      className={cn('block shrink-0 rounded-pill', className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 30% 26%, hsl(${hue} 82% 66%), hsl(${shade} 68% 42%) 72%)`,
        // A hairline inner edge, so a pale disc still has a boundary on a white surface.
        boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.08)',
      }}
    />
  )
}
