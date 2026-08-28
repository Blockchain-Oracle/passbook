import { MessageCircle } from 'lucide-react'
import { CHAT_PICK_A_CONVERSATION } from '@strk20/protocol/chat-copy'
import { CHAT_AUDITOR_DERIVES } from '@strk20/protocol/disclosure-copy'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'

/** The desktop right pane when no thread is open (the mobile index shows the list instead). */
export function ChatIndex() {
  return (
    <Empty className="flex-1 rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircle aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{CHAT_PICK_A_CONVERSATION}</EmptyTitle>
        <EmptyDescription className="max-w-md">{CHAT_AUDITOR_DERIVES}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
