import { useState } from 'react'

const COPIED_MS = 1500

/** The clipboard write plus the 1.5 s "Copied" flip every copy button shows. */
export function useCopy(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    // No optional chaining on the write: a missing clipboard should throw, not silently no-op.
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }
  return { copied, copy }
}
