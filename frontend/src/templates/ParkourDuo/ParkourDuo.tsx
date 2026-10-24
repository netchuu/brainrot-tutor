import { CHARACTER_EMOJI, mascotSrc, REACTION_EMOJI, stickerSrc } from '@/assets'
import type { StickerReaction } from '@/assets'
import { Caption } from '@/player/Caption'
import { FallbackImage } from '@/player/FallbackImage'
import { reactionAtMs } from '@/player/usePlayback'
import { mascotPose } from '@/templates/ParkourDuo/pose'
import type { TemplateProps } from '@/templates/types'
import type { CharacterId, Scene, Speaker } from '@/types/contract'

function HighlightCard({ scene }: { scene: Scene }) {
  const text = scene.highlight ?? scene.term
  return (
    <div
      data-testid="picture-fallback"
      className={`text-outline flex aspect-square w-full items-center justify-center rounded-[4cqw] bg-linear-135 from-fuchsia-500 via-violet-600 to-sky-500 p-[4cqw] text-center leading-none font-black break-words text-white uppercase shadow-2xl ${text === null ? 'text-[30cqw]' : 'text-[10cqw]'}`}
    >
      {text ?? (scene.reaction === 'none' ? '💡' : REACTION_EMOJI[scene.reaction])}
    </div>
  )
}

function PictureSlot({ scene }: { scene: Scene }) {
  const card = <HighlightCard scene={scene} />
  return (
    <div key={scene.id} className="animate-pop absolute top-[5cqh] left-1/2 w-[70cqw] -translate-x-1/2">
      {scene.picture === null ? (
        card
      ) : (
        <FallbackImage
          src={scene.picture.url}
          alt={scene.picture.query}
          className="aspect-square w-full rounded-[4cqw] object-cover shadow-2xl ring-[0.8cqw] ring-white"
          fallback={card}
        >
          <p className="mt-[0.8cqh] truncate text-center text-[2.6cqw] text-white/70">{scene.picture.credit}</p>
        </FallbackImage>
      )}
    </div>
  )
}

function ReactionSticker({ reaction }: { reaction: StickerReaction }) {
  return (
    <div data-testid="reaction" className="animate-pop absolute top-[2cqh] right-[4cqw] z-20 w-[24cqw]">
      <FallbackImage
        src={stickerSrc(reaction)}
        alt={reaction}
        className="w-full drop-shadow-xl"
        fallback={<span className="block text-center text-[18cqw] leading-none drop-shadow-xl">{REACTION_EMOJI[reaction]}</span>}
      />
    </div>
  )
}

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
  const fallback = (
    <div
      className={`flex aspect-square w-[34cqw] items-center justify-center rounded-full border-[1cqw] border-white text-[18cqw] leading-none shadow-2xl ${MASCOT_COLOR[role]}`}
    >
      {CHARACTER_EMOJI[character]}
    </div>
  )
  return (
    <div
      data-testid={`mascot-${role}`}
      data-active={active}
      className={`absolute bottom-0 flex h-[30cqh] w-[46cqw] origin-bottom items-end justify-center transition-all duration-300 ${MASCOT_SIDE[role]} ${active ? 'z-10 scale-100 opacity-100' : 'scale-[0.7] opacity-50 grayscale'}`}
    >
      <div className={`flex h-full w-full items-end justify-center ${active ? 'animate-bob' : ''}`}>
        <FallbackImage
          src={mascotSrc(character, mascotPose(scene, role))}
          alt={character}
          className="h-full w-full object-contain object-bottom"
          fallback={fallback}
        />
      </div>
    </div>
  )
}

export function ParkourDuo({ episode, scene, timeMs }: TemplateProps) {
  const reaction = scene.reaction === 'none' ? null : scene.reaction
  return (
    <div className="absolute inset-0">
      <PictureSlot scene={scene} />
      {reaction !== null && timeMs >= reactionAtMs(scene) && <ReactionSticker key={scene.id} reaction={reaction} />}
      <div className="absolute inset-x-[4cqw] top-[54cqh] flex min-h-[14cqh] items-center justify-center">
        <Caption words={scene.words} highlight={scene.highlight} timeMs={timeMs} />
      </div>
      <Mascot role="teacher" character={episode.cast.teacher} scene={scene} />
      <Mascot role="student" character={episode.cast.student} scene={scene} />
    </div>
  )
}
