import { Mail } from 'lucide-react'
import { MAIL_AUDITOR_DERIVES } from '@strk20/protocol/disclosure-copy'
import { MAIL_PICK_A_THREAD } from '@strk20/protocol/mail-copy'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

/** The desktop right pane when no thread is open (the phone index shows the list instead). */
export function MailIndex() {
  return (
    <Empty className="flex-1 rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Mail aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{MAIL_PICK_A_THREAD}</EmptyTitle>
        <EmptyDescription className="max-w-md">{MAIL_AUDITOR_DERIVES}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
