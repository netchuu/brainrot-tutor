import { Caption } from '@/player/Caption'
import { mascotPose } from '@/templates/pose'
import { CharacterImage, HighlightCard, PictureCard, ReactionSticker } from '@/templates/shared'
import { Formula } from '@/templates/SplitScreen/Formula'
import type { TemplateProps } from '@/templates/types'
import type { Scene } from '@/types/contract'

function TopContent({ scene }: { scene: Scene }) {
  if (scene.formula !== null) return <Formula tex={scene.formula} />
  if (scene.term !== null) {
    return (
      <div
        data-testid="term-card"
        className="text-outline w-full rounded-[4cqw] bg-linear-135 from-amber-400 via-orange-500 to-rose-500 px-[5cqw] py-[6cqw] text-center text-[7cqw] leading-tight font-black break-words text-white shadow-2xl"
      >
        {scene.term}
      </div>
    )
  }
  if (scene.picture !== null) return <PictureCard scene={scene} className="mx-auto aspect-square h-[29cqh]" />
  return <HighlightCard scene={scene} className="mx-auto aspect-square h-[29cqh]" />
}

export function SplitScreen({ episode, scene, timeMs }: TemplateProps) {
  const character = episode.cast[scene.speaker]
  return (
    <div className="absolute inset-0">
      <div
        key={scene.id}
        className="animate-pop absolute inset-x-[7cqw] top-[9cqh] flex h-[34cqh] flex-col items-center justify-center"
      >
        <TopContent scene={scene} />
      </div>
      <ReactionSticker scene={scene} timeMs={timeMs} />
      <div
        data-testid="speaker-avatar"
        data-character={character}
        className="animate-bob absolute top-[39cqh] left-[3cqw] z-10 flex size-[14cqw] items-end justify-center"
      >
        <CharacterImage
          character={character}
          pose={mascotPose(scene, scene.speaker)}
          className="size-full rounded-full bg-black/40 object-contain"
          fallbackClassName="w-full bg-indigo-500 text-[9cqw]"
        />
      </div>
      <div className="absolute inset-x-[4cqw] top-[45cqh] z-10 flex min-h-[12cqh] items-center justify-center">
        <Caption words={scene.words} highlight={scene.highlight} timeMs={timeMs} />
      </div>
    </div>
  )
}
