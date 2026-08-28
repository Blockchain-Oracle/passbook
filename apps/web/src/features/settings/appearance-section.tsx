import { Monitor, Moon, Sun } from 'lucide-react'

import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsSection } from './section'
import { THEME_FOLLOWING_SYSTEM, THEME_LABELS, THEME_PINNED } from './settings-copy'

export type ThemeChoice = keyof typeof THEME_LABELS

const CHOICES: readonly ThemeChoice[] = ['dark', 'light', 'system']
const ICON = { dark: Moon, light: Sun, system: Monitor } as const

function isChoice(v: unknown): v is ThemeChoice {
  return typeof v === 'string' && (CHOICES as readonly string[]).includes(v)
}

export interface AppearanceSectionProps {
  /** next-themes' `theme` — `undefined` before hydration. */
  theme: string | undefined
  /** What `system` resolved to, for the sentence under the picker. */
  resolvedTheme: string | undefined
  onChange: (choice: ThemeChoice) => void
}

export function AppearanceSection({ theme, resolvedTheme, onChange }: AppearanceSectionProps) {
  const choice: ThemeChoice = isChoice(theme) ? theme : 'dark'
  const Icon = ICON[choice]
  const sentence =
    choice === 'system' ? `${THEME_FOLLOWING_SYSTEM}${resolvedTheme ? ` Currently ${resolvedTheme}.` : ''}` : THEME_PINNED
  return (
    <SettingsSection id="appearance" index="01" title="Appearance">
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Icon aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Theme</ItemTitle>
          <ItemDescription>{sentence}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Select
            value={choice}
            items={THEME_LABELS}
            onValueChange={(v) => {
              if (isChoice(v)) onChange(v)
            }}
          >
            <SelectTrigger aria-label="Theme" className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHOICES.map((c) => {
                const ChoiceIcon = ICON[c]
                return (
                  <SelectItem key={c} value={c}>
                    <ChoiceIcon className="size-4 text-muted-foreground" aria-hidden />
                    {THEME_LABELS[c]}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
    </SettingsSection>
  )
}
