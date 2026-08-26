//
// The command palette — and the proof that `ResponsiveDialog` is a primitive rather than an orphan.
//
// WHY THIS MOUNTS INSIDE `ResponsiveDialog` AND NOT INSIDE A `Dialog.Root`. The library's own recipe
// (`@base-ui/react/docs/react/components/autocomplete.md`, "Command palette") wraps the autocomplete
// in a `Dialog.Root`. Following it literally would put a SECOND popup stack in the app on day one
// while leaving the responsive dialog with no caller at all — an abstraction with no consumer, which
// is the outcome the two were specified together to avoid. `Dialog`'s parts are structurally a
// subset of `Drawer`'s, so nothing is lost by the substitution, and the palette gets a real bottom
// sheet under 640px for free.
//
// EVERYTHING ELSE IS THE RECIPE VERBATIM: `<Autocomplete.Root open inline items autoHighlight="always"
// keepHighlight>` around Input / Empty / List / Item. `inline` means "no popup of my own"; `open`
// alongside it is what makes the list count as visible. Neither works without the other.
//
// TRANSIENT STATE RESETS BY UNMOUNTING, which is worth knowing rather than rediscovering. The
// library's guidance for a combobox inside a dialog is to bind its open state to the dialog's so the
// query and highlight reset on close — but `Autocomplete.Root` does not expose `onOpenChange` at all
// (it is omitted from its props), so that binding is not available here. It is also unnecessary:
// `Drawer.Portal` has no `keepMounted`, so closing the palette unmounts this whole subtree and the
// next `/` starts from nothing.
//
// This module is loaded by `React.lazy`. The split is NOT for the byte gate — that gate sums every
// emitted `.js`, so splitting moves bytes between files and changes the total by rounding error. It
// is for first-paint parse and execute cost of chrome most sessions never open. Say that out loud
// or the next reader deletes the split for the wrong reason.
//
import { Autocomplete } from '@base-ui/react/autocomplete'

import { OptionRowBody } from '../components/OptionRow'
import { ResponsiveDialog } from './ResponsiveDialog'

/**
 * One command, as plain data.
 *
 * PRE-SCOPED BY THE CALLER. Nothing in this file asks what kind of account is signed in, or what a
 * persona is — the caller decides which commands exist and hands over a list. `label` is the field
 * the library filters on by default, so the visible name and the searched name cannot drift.
 */
export interface PaletteCommand {
  readonly id: string
  readonly label: string
  readonly detail: string
}

/** The popup's accessible name. A dialog with no name is announced as "dialog" and nothing else. */
export const PALETTE_LABEL = 'Command palette'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: readonly PaletteCommand[]
  onRun: (command: PaletteCommand) => void
}

export function CommandPalette({ open, onOpenChange, commands, onRun }: CommandPaletteProps) {
  return (
    // `modal` is not passed, so it is `false`: the palette is chrome, and the app behind it stays
    // readable, scrollable and clickable while it is up. The app's one modal is the trust-boundary
    // self-submit dialog and it is not this.
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} label={PALETTE_LABEL}>
      <Autocomplete.Root
        open
        inline
        // Explicit for the same reason the drawer's is: modality is a default on several of this
        // library's roots, so leaving it out is not the same as saying no. An inline list has no
        // popup to make modal, and this is what says so.
        modal={false}
        items={commands}
        autoHighlight="always"
        keepHighlight
      >
        <div className="pb-palette">
          {/*
            `type` is deliberately absent: the library renders a bare `<input>` with no type
            attribute, and `type="search"` would add a UA clear button duplicating the palette's own
            dismiss. The ring is the app's one focus ring — the input is the only focusable thing in
            here, and the highlighted ROW is announced through `aria-activedescendant` rather than
            focused, which is what keeps the caret where the reader is typing.
          */}
          <Autocomplete.Input className="focus-ring" aria-label="Search commands" placeholder="Search Passbook" />

          {/*
            Rendered unconditionally on purpose. This element is a polite live region and it
            announces by CHANGING; conditionally mounting it means some screen readers never see the
            change at all. Only its children are conditional, which is the library's documented shape.
          */}
          <Autocomplete.Empty>
            <p className="p-s12 text-body3 text-neutral2">Nothing in Passbook is called that.</p>
          </Autocomplete.Empty>

          <Autocomplete.List>
            {(command: PaletteCommand | null) =>
              //
              // THE NULL GUARD IS NOT DEFENSIVENESS. Story 6.4 reuses this row anatomy inline, in a
              // selector, where a row can genuinely be null while data is arriving — and the palette
              // library this one was chosen over throws `Cannot use 'in' operator` on exactly that
              // and renders a blank list. Guarding here is cheaper than discovering it there.
              //
              command ? (
                <Autocomplete.Item
                  key={command.id}
                  value={command}
                  className="option-row"
                  onClick={() => {
                    // Closed FIRST, so focus is restored to the trigger before whatever the command
                    // does takes the reader somewhere else. Running first and closing after leaves
                    // the palette up if the command throws, which is the one state with no way out.
                    onOpenChange(false)
                    onRun(command)
                  }}
                >
                  {/*
                    THE SHARED ROW, not a second one. Story 6.4 promoted this anatomy out of the
                    palette and into `components/OptionRow.tsx`, and the palette became a caller of
                    it — which is what makes "one row implementation in the repository" a fact about
                    the code rather than a rule someone has to keep remembering. The library owns the
                    OUTER element (it is what carries `data-highlighted`); the body is shared.
                  */}
                  <OptionRowBody row={{ id: command.id, title: command.label, subtitle: command.detail }} />
                </Autocomplete.Item>
              ) : null
            }
          </Autocomplete.List>
        </div>
      </Autocomplete.Root>
    </ResponsiveDialog>
  )
}

// `React.lazy` resolves the module's default export, and the root mounts this lazily.
export default CommandPalette
