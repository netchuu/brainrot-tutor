import { CHARACTER_EMOJI, mascotSrc, REACTION_EMOJI, stickerSrc } from '@/assets'
import type { MascotPose } from '@/assets'
import { FallbackImage } from '@/player/FallbackImage'
import { reactionAtMs } from '@/player/usePlayback'
import type { CharacterId, Scene } from '@/types/contract'

export function HighlightCard({ scene, className }: { scene: Scene; className: string }) {
  const text = scene.highlight ?? scene.term
  return (
    <div
      data-testid="picture-fallback"
      className={`text-outline flex items-center justify-center rounded-[4cqw] bg-linear-135 from-fuchsia-500 via-violet-600 to-sky-500 p-[4cqw] text-center leading-none font-black break-words text-white uppercase shadow-2xl ${text === null ? 'text-[30cqw]' : 'text-[10cqw]'} ${className}`}
    >
      {text ?? (scene.reaction === 'none' ? '💡' : REACTION_EMOJI[scene.reaction])}
    </div>
  )
}

export function PictureCard({ scene, className }: { scene: Scene; className: string }) {
  const card = <HighlightCard scene={scene} className={className} />
  if (scene.picture === null) return card
  return (
    <FallbackImage
      src={scene.picture.url}
      alt={scene.picture.query}
      className={`rounded-[4cqw] object-cover shadow-2xl ring-[0.8cqw] ring-white ${className}`}
      fallback={card}
    >
      <p className="mt-[0.8cqh] truncate text-center text-[2.6cqw] text-white/70">{scene.picture.credit}</p>
    </FallbackImage>
  )
}

export function ReactionSticker({
  scene,
  timeMs,
  position = 'top-[2cqh] right-[4cqw]',
}: {
  scene: Scene
  timeMs: number
  position?: string
}) {
  if (scene.reaction === 'none' || timeMs < reactionAtMs(scene)) return null
  const reaction = scene.reaction
  return (
    <div key={scene.id} data-testid="reaction" className={`animate-pop absolute z-20 w-[24cqw] ${position}`}>
      <FallbackImage
        src={stickerSrc(reaction)}
        alt={reaction}
        className="w-full drop-shadow-xl"
        fallback={<span className="block text-center text-[18cqw] leading-none drop-shadow-xl">{REACTION_EMOJI[reaction]}</span>}
      />
    </div>
  )
}

export function CharacterImage({
  character,
  pose,
  className,
  fallbackClassName,
}: {
  character: CharacterId
  pose: MascotPose
  className: string
  fallbackClassName: string
}) {
  return (
    <FallbackImage
      src={mascotSrc(character, pose)}
      alt={character}
      className={className}
      fallback={
        <div
          className={`flex aspect-square items-center justify-center rounded-full border-[1cqw] border-white leading-none shadow-2xl ${fallbackClassName}`}
        >
          {CHARACTER_EMOJI[character]}
        </div>
      }
    />
  )
}
