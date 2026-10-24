import { Caption } from '@/player/Caption'
import { mascotPose } from '@/templates/pose'
import { CharacterImage, PictureCard, ReactionSticker } from '@/templates/shared'
import type { TemplateProps } from '@/templates/types'
import type { CharacterId, Scene, Speaker } from '@/types/contract'

const MASCOT_SIDE: Record<Speaker, string> = {
  teacher: 'left-[1cqw]',
  student: 'right-[1cqw]',
}

const MASCOT_COLOR: Record<Speaker, string> = {
  teacher: 'bg-indigo-500',
  student: 'bg-pink-500',
}

function Mascot({ role, character, scene }: { role: Speaker; character: CharacterId; scene: Scene }) {
  const active = scene.speaker === role
  return (
    <div
      data-testid={`mascot-${role}`}
      data-active={active}
      className={`absolute bottom-0 flex h-[30cqh] w-[46cqw] origin-bottom items-end justify-center transition-all duration-300 ${MASCOT_SIDE[role]} ${active ? 'z-10 scale-100 opacity-100' : 'scale-[0.7] opacity-50 grayscale'}`}
    >
      <div className={`flex h-full w-full items-end justify-center ${active ? 'animate-bob' : ''}`}>
        <CharacterImage
          character={character}
          pose={mascotPose(scene, role)}
          className="h-full w-full object-contain object-bottom"
          fallbackClassName={`w-[34cqw] text-[18cqw] ${MASCOT_COLOR[role]}`}
        />
      </div>
    </div>
  )
}

export function ParkourDuo({ episode, scene, timeMs }: TemplateProps) {
  return (
    <div className="absolute inset-0">
      <div key={scene.id} className="animate-pop absolute top-[5cqh] left-1/2 w-[70cqw] -translate-x-1/2">
        <PictureCard scene={scene} className="aspect-square w-full" />
      </div>
      <ReactionSticker scene={scene} timeMs={timeMs} />
      <div className="absolute inset-x-[4cqw] top-[54cqh] flex min-h-[14cqh] items-center justify-center">
        <Caption words={scene.words} highlight={scene.highlight} timeMs={timeMs} />
      </div>
      <Mascot role="teacher" character={episode.cast.teacher} scene={scene} />
      <Mascot role="student" character={episode.cast.student} scene={scene} />
    </div>
  )
}
