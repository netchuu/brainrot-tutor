import { Caption } from '@/player/Caption'
import { ru } from '@/strings'
import { PictureCard, ReactionSticker } from '@/templates/shared'
import type { TemplateProps } from '@/templates/types'

const RANKS = [3, 2, 1] as const

export function Top3Countdown({ scene, timeMs, history }: TemplateProps) {
  const shown = new Set([...history.map((previous) => previous.rank), scene.rank])
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-x-0 top-[4cqh] flex items-center justify-center gap-[3cqw]">
        <span className="text-outline text-[7cqw] font-black text-accent">{ru.top3.title}</span>
        {RANKS.map((rank) => (
          <span
            key={rank}
            data-testid={`rank-pill-${String(rank)}`}
            data-current={scene.rank === rank}
            className={`flex size-[9cqw] items-center justify-center rounded-full text-[5cqw] font-black ${scene.rank === rank ? 'bg-accent text-black' : shown.has(rank) ? 'bg-white/70 text-black' : 'bg-white/15 text-white/60'}`}
          >
            {rank}
          </span>
        ))}
      </div>
      {scene.rank !== null && (
        <p
          key={`${scene.id}-rank`}
          data-testid="rank"
          className="text-outline animate-pop absolute top-[11cqh] left-[5cqw] z-10 text-[30cqw] leading-none font-black text-accent"
        >
          #{scene.rank}
        </p>
      )}
      <div
        key={scene.id}
        className={`animate-pop absolute top-[15cqh] w-[62cqw] ${scene.rank === null ? 'left-1/2 -translate-x-1/2' : 'right-[5cqw]'}`}
      >
        <PictureCard scene={scene} className="aspect-square w-full" />
      </div>
      <ReactionSticker scene={scene} timeMs={timeMs} />
      <div className="absolute inset-x-[4cqw] top-[60cqh] flex min-h-[14cqh] items-center justify-center">
        <Caption words={scene.words} highlight={scene.highlight} timeMs={timeMs} />
      </div>
    </div>
  )
}
