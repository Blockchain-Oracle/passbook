import { createFileRoute } from '@tanstack/react-router'

import { EarnSurface } from '@/features/earn'

export const Route = createFileRoute('/earn')({ component: EarnSurface })
