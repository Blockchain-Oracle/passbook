import { createFileRoute } from '@tanstack/react-router'

import { CHAT_PICK_A_CONVERSATION } from '@strk20/protocol/chat-copy'
import { CHAT_AUDITOR_DERIVES } from '@strk20/protocol/disclosure-copy'

import { Text } from '../components/ui/Text'

export const Route = createFileRoute('/chat/')({
  component: ChatIndex,
})

//
// The right-hand pane before a conversation is chosen.
//
// ── IT IS DESKTOP-ONLY BY LAYOUT, NOT BY A MEDIA QUERY HERE ──────────────────────────────
//
// On a phone `/chat` IS the conversation list — the layout hides this pane and shows the sidebar
// full-width — so this renders into a column nobody sees below 1024px. That is why it holds no
// controls: the "New" button lives in the sidebar header, where it exists at every width.
//
// ── AND IT SPENDS THE EMPTY SPACE ON THE ONE THING WORTH SAYING ──────────────────────────
//
// The room key derives from pool viewing keys, and the auditor holds an escrowed copy of those, so
// the auditor can read any conversation here without asking. Every thread carries that sentence
// too; putting it on the empty state means a first-time visitor meets it before they have typed
// anything, which is the only moment it can still change what they decide to send.
//
function ChatIndex() {
  return (
    <div className="flex min-h-[320px] flex-col items-start justify-center gap-s12 rounded-large border border-solid border-surface3 p-s24">
      <Text variant="subheading1" as="h2">
        {CHAT_PICK_A_CONVERSATION}
      </Text>
      <Text variant="body3" className="max-w-[52ch] text-neutral2">
        {CHAT_AUDITOR_DERIVES}
      </Text>
    </div>
  )
}
