import type { MascotPose } from '@/assets'
import type { Scene, Speaker } from '@/types/contract'

export function mascotPose(scene: Scene, character: Speaker): MascotPose {
  if (scene.speaker !== character) return 'neutral'
  if (scene.reaction === 'shocked' || scene.reaction === 'mind_blown') return 'shocked'
  if (character === 'teacher' && scene.picture !== null) return 'pointing'
  return 'neutral'
}
