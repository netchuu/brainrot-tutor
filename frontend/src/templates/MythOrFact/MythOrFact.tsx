import { Caption } from '@/player/Caption'
import { ru } from '@/strings'
import { claimPhase } from '@/templates/MythOrFact/claim'
import { PictureCard, ReactionSticker } from '@/templates/shared'
import type { TemplateProps } from '@/templates/types'
import type { Verdict } from '@/types/contract'

const STAMP: Record<Verdict, string> = {
  myth: 'bg-red-600 ring-red-200',
  fact: 'bg-emerald-600 ring-emerald-200',
}

const STAMP_ICON: Record<Verdict, string> = {
  myth: '❌',
  fact: '✅',
}

export function MythOrFact({ scene, timeMs, history }: TemplateProps) {
  const phase = claimPhase(scene, history)
  return (
    <div className="absolute inset-0">
      <p className="text-outline absolute inset-x-0 top-[4cqh] text-center text-[8cqw] font-black text-accent uppercase">
        {ru.myth.question}
      </p>
      {phase.kind === 'intro' ? (
        <div key={scene.id} className="animate-pop absolute top-[13cqh] left-1/2 w-[64cqw] -translate-x-1/2">
          <PictureCard scene={scene} className="aspect-square w-full" />
        </div>
      ) : (
        <div
          key={phase.claim.id}
          data-testid="claim-card"
          className="animate-pop absolute inset-x-[7cqw] top-[14cqh] flex min-h-[30cqh] flex-col items-center justify-center rounded-[5cqw] bg-white/95 p-[5cqw] text-center text-[5.5cqw] leading-snug font-bold text-black shadow-2xl"
        >
          {phase.claim.text}
          {phase.kind === 'reveal' ? (
            <span
              key={`${phase.claim.id}-stamp`}
              data-testid="verdict-stamp"
              data-verdict={phase.verdict}
              className={`animate-pop absolute -right-[3cqw] -bottom-[5cqw] rotate-[-10deg] rounded-[3cqw] px-[4cqw] py-[1.5cqw] text-[8cqw] font-black text-white uppercase shadow-2xl ring-[1cqw] ${STAMP[phase.verdict]}`}
            >
              {STAMP_ICON[phase.verdict]} {ru.myth.verdicts[phase.verdict]}
            </span>
          ) : (
            <span
              data-testid="verdict-unknown"
              className="absolute -right-[3cqw] -bottom-[5cqw] animate-pulse rounded-full bg-accent px-[4cqw] text-[12cqw] leading-tight font-black text-black shadow-2xl"
            >
              ?
            </span>
          )}
        </div>
      )}
      <ReactionSticker scene={scene} timeMs={timeMs} />
      <div className="absolute inset-x-[4cqw] top-[58cqh] flex min-h-[14cqh] items-center justify-center">
        <Caption words={scene.words} highlight={scene.highlight} timeMs={timeMs} />
      </div>
    </div>
  )
}
