import type { MascotPose } from '@/assets'
import type { Scene, Speaker } from '@/types/contract'

export function mascotPose(scene: Scene, role: Speaker): MascotPose {
  if (scene.speaker !== role) return 'neutral'
  if (scene.reaction === 'shocked' || scene.reaction === 'mind_blown') return 'shocked'
  if (role === 'teacher' && scene.picture !== null) return 'pointing'
  return 'neutral'
}
