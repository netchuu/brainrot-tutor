import { castMascotSrcs } from '@/assets'
import { FakeChat } from '@/templates/FakeChat/FakeChat'
import { MythOrFact } from '@/templates/MythOrFact/MythOrFact'
import { ParkourDuo } from '@/templates/ParkourDuo/ParkourDuo'
import { warmRenderer } from '@/templates/SplitScreen/formulaRenderer'
import { SplitScreen } from '@/templates/SplitScreen/SplitScreen'
import { Top3Countdown } from '@/templates/Top3Countdown/Top3Countdown'
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

const top3Countdown: TemplateDefinition = {
  component: Top3Countdown,
  preload: () => [],
  backgroundArea: 'full',
}

const mythOrFact: TemplateDefinition = {
  component: MythOrFact,
  preload: () => [],
  backgroundArea: 'full',
}

const TEMPLATES: Record<TemplateId, TemplateDefinition> = {
  parkour_duo: parkourDuo,
  split_screen: splitScreen,
  fake_chat: fakeChat,
  top3_countdown: top3Countdown,
  myth_or_fact: mythOrFact,
}

export function templateFor(id: TemplateId): TemplateDefinition {
  return TEMPLATES[id]
}
