import type { ReactNode } from 'react'
import { REACTION_EMOJI } from '@/assets'
import { activeWordIndex } from '@/player/captions'
import { FallbackImage } from '@/player/FallbackImage'
import { reactionAtMs } from '@/player/usePlayback'
import { ru } from '@/strings'
import { revealedText, splitHighlight } from '@/templates/FakeChat/reveal'
import { CharacterImage } from '@/templates/shared'
import type { TemplateProps } from '@/templates/types'
import type { Cast, Scene, Speaker } from '@/types/contract'

const SIDE: Record<Speaker, string> = {
  teacher: 'self-start rounded-bl-[1.5cqw] bg-white text-black',
  student: 'self-end rounded-br-[1.5cqw] bg-sky-500 text-white',
}

function Avatar({ cast, speaker }: { cast: Cast; speaker: Speaker }) {
  return (
    <div className="size-[9cqw] shrink-0 overflow-hidden rounded-full bg-black/40">
      <CharacterImage
        character={cast[speaker]}
        pose="neutral"
        className="size-full object-cover object-top"
        fallbackClassName={`w-full border-[0.5cqw] text-[5cqw] ${speaker === 'teacher' ? 'bg-indigo-500' : 'bg-pink-500'}`}
      />
    </div>
  )
}

function Bubble({ speaker, children, badge }: { speaker: Speaker; children: ReactNode; badge?: string }) {
  return (
    <div
      data-speaker={speaker}
      className={`relative max-w-[78%] rounded-[4cqw] px-[3.5cqw] py-[2.2cqw] text-[4.4cqw] leading-snug font-semibold shadow-lg ${SIDE[speaker]}`}
    >
      {children}
      {badge !== undefined && (
        <span
          data-testid="chat-reaction"
          className="animate-pop absolute -right-[2cqw] -bottom-[3cqw] rounded-full bg-white px-[1.2cqw] text-[5cqw] leading-none shadow-md"
        >
          {badge}
        </span>
      )}
    </div>
  )
}

function Message({ cast, scene, children }: { cast: Cast; scene: Scene; children: ReactNode }) {
  return (
    <div className={`flex items-end gap-[2cqw] ${scene.speaker === 'teacher' ? '' : 'flex-row-reverse'}`}>
      <Avatar cast={cast} speaker={scene.speaker} />
      {children}
    </div>
  )
}

function CurrentMessage({ cast, scene, timeMs }: { cast: Cast; scene: Scene; timeMs: number }) {
  const active = activeWordIndex(scene.words, timeMs)
  const [before, highlight, after] = splitHighlight(revealedText(scene.text, scene.words, active), scene.highlight)
  const reaction = scene.reaction !== 'none' && timeMs >= reactionAtMs(scene) ? REACTION_EMOJI[scene.reaction] : undefined
  return (
    <>
      {scene.picture !== null && (
        <Message cast={cast} scene={scene}>
          <div className={`animate-pop max-w-[60%] ${scene.speaker === 'teacher' ? 'self-start' : 'self-end'}`}>
            <FallbackImage
              src={scene.picture.url}
              alt={scene.picture.query}
              className="aspect-square w-full rounded-[4cqw] object-cover shadow-lg ring-[0.6cqw] ring-white/80"
              fallback={null}
            >
              <p className="mt-[0.5cqh] truncate text-[2.4cqw] text-white/70">{scene.picture.credit}</p>
            </FallbackImage>
          </div>
        </Message>
      )}
      <Message cast={cast} scene={scene}>
        <Bubble speaker={scene.speaker} badge={reaction}>
          {active < 0 ? (
            <span data-testid="typing" className="animate-pulse tracking-[0.3em]">
              •••
            </span>
          ) : (
            <span data-testid="current-message">
              {before}
              {highlight !== '' && <span className="text-accent [-webkit-text-stroke:0.04em_#000]">{highlight}</span>}
              {after}
            </span>
          )}
        </Bubble>
      </Message>
    </>
  )
}

export function FakeChat({ episode, scene, timeMs, history }: TemplateProps) {
  const { cast } = episode
  return (
    <div className="absolute inset-0">
      <header className="absolute top-[3cqh] right-[4cqw] left-[17cqw] z-10 flex items-center gap-[2cqw] rounded-full bg-black/55 px-[3cqw] py-[1.5cqw] backdrop-blur-sm">
        <div className="flex -space-x-[3cqw]">
          <Avatar cast={cast} speaker="teacher" />
          <Avatar cast={cast} speaker="student" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[3.8cqw] font-black">
            {ru.chat.title(ru.characters[cast.teacher], ru.characters[cast.student])}
          </p>
          <p className="text-[2.8cqw] text-emerald-300">{ru.chat.online}</p>
        </div>
      </header>
      <div
        data-testid="chat"
        className="absolute inset-x-[4cqw] top-[12cqh] bottom-[5cqh] flex flex-col justify-end gap-[2.4cqw] overflow-hidden rounded-[5cqw] bg-black/35 p-[3cqw] backdrop-blur-[2px]"
      >
        {history.map((previous) => (
          <Message key={previous.id} cast={cast} scene={previous}>
            <Bubble speaker={previous.speaker}>{previous.text}</Bubble>
          </Message>
        ))}
        <CurrentMessage key={scene.id} cast={cast} scene={scene} timeMs={timeMs} />
      </div>
    </div>
  )
}
