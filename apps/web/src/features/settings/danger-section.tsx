import { useState } from 'react'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { SettingsSection } from './section'
import { FORGET_ACTION, FORGET_BODY, FORGET_CONFIRM_WORD, FORGET_TITLE, NOTHING_TO_FORGET, forgetPrompt } from './settings-copy'

export interface DangerSectionProps {
  /** How many accounts this browser holds — zero means there is nothing to forget. */
  accountCount: number
  onForget: () => void
}

/** Irreversible: a typed word, then every key in this browser is gone. The CTA is never `disabled`. */
export function DangerSection({ accountCount, onForget }: DangerSectionProps) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const armed = typed.trim().toLowerCase() === FORGET_CONFIRM_WORD
  const nothing = accountCount === 0
  const close = (next: boolean) => {
    setOpen(next)
    if (!next) setTyped('')
  }

  return (
    <SettingsSection id="danger" index="07" title="Danger zone" tone="danger">
      <Item variant="outline" className="border-irreversible/40">
        <ItemMedia variant="icon">
          <Trash2 className="text-irreversible" aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{FORGET_TITLE}</ItemTitle>
          <ItemDescription className="line-clamp-none">{nothing ? NOTHING_TO_FORGET : FORGET_BODY}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="destructive" aria-disabled={nothing} onClick={() => !nothing && setOpen(true)}>
            <Trash2 data-icon="inline-start" />
            Forget…
          </Button>
        </ItemActions>
      </Item>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!armed) return
              onForget()
              close(false)
            }}
          >
            <DialogHeader>
              <DialogTitle className="font-display text-display4 uppercase text-irreversible">{FORGET_TITLE}</DialogTitle>
              <DialogDescription>{FORGET_BODY}</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="forget-confirm">{forgetPrompt(FORGET_CONFIRM_WORD)}</FieldLabel>
              <Input id="forget-confirm" autoFocus autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
            <DialogFooter showCloseButton>
              <Button type="submit" variant="destructive" aria-disabled={!armed}>
                <Trash2 data-icon="inline-start" />
                {armed ? FORGET_ACTION : forgetPrompt(FORGET_CONFIRM_WORD)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  )
}
