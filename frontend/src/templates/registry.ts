import { allMascotSrcs, backgroundSrc } from '@/assets'
import { ParkourDuo } from '@/templates/ParkourDuo/ParkourDuo'
import type { TemplateDefinition } from '@/templates/types'
import type { TemplateId } from '@/types/contract'

const parkourDuo: TemplateDefinition = {
  component: ParkourDuo,
  background: (episodeIndex) => backgroundSrc('parkour', episodeIndex),
  assets: allMascotSrcs(),
}

const TEMPLATES: Partial<Record<TemplateId, TemplateDefinition>> = {
  parkour_duo: parkourDuo,
}

export function templateFor(id: TemplateId): TemplateDefinition {
  return TEMPLATES[id] ?? parkourDuo
}
