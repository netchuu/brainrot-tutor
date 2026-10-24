import { castMascotSrcs } from '@/assets'
import { FakeChat } from '@/templates/FakeChat/FakeChat'
import { ParkourDuo } from '@/templates/ParkourDuo/ParkourDuo'
import { warmRenderer } from '@/templates/SplitScreen/formulaRenderer'
import { SplitScreen } from '@/templates/SplitScreen/SplitScreen'
import type { TemplateDefinition } from '@/templates/types'
import type { TemplateId } from '@/types/contract'

const parkourDuo: TemplateDefinition = {
  component: ParkourDuo,
  preload: (episode) => castMascotSrcs(episode.cast),
  backgroundArea: 'full',
}

const splitScreen: TemplateDefinition = {
  component: SplitScreen,
  preload: (episode) => castMascotSrcs(episode.cast),
  prepare: warmRenderer,
  backgroundArea: 'bottom',
}

const fakeChat: TemplateDefinition = {
  component: FakeChat,
  preload: (episode) => castMascotSrcs(episode.cast),
  backgroundArea: 'full',
}

const TEMPLATES: Partial<Record<TemplateId, TemplateDefinition>> = {
  parkour_duo: parkourDuo,
  split_screen: splitScreen,
  fake_chat: fakeChat,
}

export function templateFor(id: TemplateId): TemplateDefinition {
  return TEMPLATES[id] ?? parkourDuo
}
