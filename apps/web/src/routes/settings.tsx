import { createFileRoute } from '@tanstack/react-router'

import { Page } from '@/components/layout/page'
import { SETTINGS_DESCRIPTION, SettingsSurface } from '@/features/settings'

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
})

// No boundary badge: nothing here moves money.
function SettingsRoute() {
  return (
    <Page kicker="System" title="Settings" description={SETTINGS_DESCRIPTION}>
      <SettingsSurface />
    </Page>
  )
}
