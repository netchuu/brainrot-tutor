import type { ComponentType } from 'react'
import type { EpisodeOutline, Scene } from '@/types/contract'

export interface TemplateProps {
  episode: EpisodeOutline
  scene: Scene
  sceneIndex: number
  timeMs: number
}

export interface TemplateDefinition {
  component: ComponentType<TemplateProps>
  preload: (episode: EpisodeOutline) => string[]
}
