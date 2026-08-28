// Handed from the layout (which owns the stream) to whichever child route renders in its pane.
import { createContext, useContext } from 'react'

import type { RoomInputs } from './queries'
import type { StreamState } from './use-room-stream'

export interface ChatContextValue {
  me: RoomInputs
  connection: StreamState
}

export const ChatContext = createContext<ChatContextValue | null>(null)

export function useChatContext(): ChatContextValue | null {
  return useContext(ChatContext)
}
