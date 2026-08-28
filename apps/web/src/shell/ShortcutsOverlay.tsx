//
// The `?` overlay: every keyboard shortcut this app has, in one place.
//
// ── IT LISTS WHAT EXISTS, AND NOTHING ELSE ────────────────────────────────────────────────
//
// A shortcuts sheet that names a binding the app does not have is worse than no sheet: the reader
// tries it, nothing happens, and now they distrust the rest of the list. Every row below maps to a
// binding in `palette-binding.ts` — the two files are meant to be read side by side, and a shortcut
// added there without a row here is a shortcut nobody will find.
//
// ── THE MODIFIER IS RENDERED PER PLATFORM ─────────────────────────────────────────────────
//
// `bindPaletteChord` accepts either Meta or Ctrl, so the DISPLAY has to pick one — and picking
// wrong is the small lie that makes a polished thing feel unfinished. macOS gets ⌘; everything else
// gets Ctrl.
//
import { useEffect } from 'react'

import { ResponsiveDialog } from './ResponsiveDialog'
import { Text } from '../components/Text'

export interface ShortcutsOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Mac or not.
 *
 * `navigator.platform` is deprecated and `userAgentData` is Chromium-only, so this reads both and
 * falls back to the user agent string. Getting it wrong costs a wrong glyph in a help sheet, which
 * is why it is a best-effort read and not a feature detection ceremony.
 */
function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  const platform = data?.platform ?? navigator.platform ?? navigator.userAgent ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

interface Shortcut {
  keys: string[]
  label: string
  /** Why it behaves the way it does, where that is worth a reader's time. */
  note?: string
}

export function ShortcutsOverlay({ open, onOpenChange }: ShortcutsOverlayProps) {
  const mod = isApplePlatform() ? '⌘' : 'Ctrl'

  // Escape closes it. `ResponsiveDialog` owns the scrim and the focus trap; this is only the key,
  // and it is here rather than assumed because a help overlay that traps its own reader is the
  // least forgivable kind.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const groups: { title: string; items: Shortcut[] }[] = [
    {
      title: 'Anywhere',
      items: [
        {
          keys: [`${mod}`, 'K'],
          label: 'Open the command palette',
          note: 'Works while you are typing, too.',
        },
        {
          keys: ['/'],
          label: 'Open the command palette',
          note: 'Not while a field has focus — the slash goes into the field instead.',
        },
        { keys: ['?'], label: 'Open this list' },
        { keys: ['Esc'], label: 'Close whatever is open' },
      ],
    },
    {
      title: 'In the palette',
      items: [
        { keys: ['↑', '↓'], label: 'Move through results' },
        { keys: ['Enter'], label: 'Go to the highlighted one' },
      ],
    },
  ]

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} label="Keyboard shortcuts" modal>
      <div className="flex w-full min-w-0 flex-col gap-s16">
        <Text variant="subheading1" as="h2">
          Keyboard shortcuts
        </Text>

        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-s8">
            <Text variant="body4" className="text-neutral2">
              {group.title}
            </Text>
            <dl className="flex flex-col gap-s8">
              {group.items.map((item) => (
                <div key={item.label + item.keys.join()} className="flex items-baseline justify-between gap-s12">
                  <dt className="flex min-w-0 flex-col gap-s2">
                    <Text variant="body3" className="text-neutral1" as="span">
                      {item.label}
                    </Text>
                    {item.note ? (
                      <Text variant="body4" className="text-neutral2" as="span">
                        {item.note}
                      </Text>
                    ) : null}
                  </dt>
                  <dd className="flex shrink-0 items-center gap-s4">
                    {item.keys.map((key) => (
                      <kbd
                        key={key}
                        className="numeric rounded-control bg-inset px-s6 py-s2 text-body4 text-neutral1"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </ResponsiveDialog>
  )
}
