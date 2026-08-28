import { Volume2, VolumeX } from 'lucide-react'

import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SettingsSection } from './section'
import { SOUNDS_OFF, SOUNDS_ON, SOUNDS_TITLE } from './settings-copy'

export interface SoundsSectionProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

export function SoundsSection({ enabled, onChange }: SoundsSectionProps) {
  const Icon = enabled ? Volume2 : VolumeX
  return (
    <SettingsSection id="sounds" index="06" title={SOUNDS_TITLE}>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Icon aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            <Label htmlFor="sounds-switch">Play sounds</Label>
          </ItemTitle>
          <ItemDescription className="line-clamp-none">{enabled ? SOUNDS_ON : SOUNDS_OFF}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch id="sounds-switch" checked={enabled} onCheckedChange={(next) => onChange(next)} />
        </ItemActions>
      </Item>
    </SettingsSection>
  )
}
