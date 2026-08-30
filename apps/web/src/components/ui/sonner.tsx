//
// The toast HOST. The cards themselves are `components/ui/notification.tsx`, raised through
// `lib/notify.tsx` — nothing here paints a toast.
//
// Placement is the other half of "I never see it": bottom-right on a desktop, next to where the
// action was taken, and top-center on a phone, where the bottom of the screen belongs to the tab
// bar. Sonner takes one `position`, so the breakpoint is read here rather than guessed with CSS.
//
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { useIsMobile } from '@/hooks/use-mobile'

/** Wide enough for a sentence plus a hash without wrapping the hash. */
const TOAST_WIDTH = '25rem'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()
  const mobile = useIsMobile()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      position={mobile ? 'top-center' : 'bottom-right'}
      // Clear of the phone's tab bar and of a desktop window's corner chrome.
      offset={{ bottom: 20, right: 20 }}
      mobileOffset={{ top: 12, left: 12, right: 12 }}
      expand
      visibleToasts={4}
      gap={10}
      style={{ '--width': TOAST_WIDTH } as React.CSSProperties}
      toastOptions={{ unstyled: true, classNames: { toast: 'w-full' } }}
      {...props}
    />
  )
}

export { Toaster }
