import { useState } from 'react'
import type { ReactNode } from 'react'
import { usePlayback } from '@/player/usePlayback'
import { templateFor } from '@/templates/registry'
import type { EpisodeOutline, Scene } from '@/types/contract'

function BackgroundLoop({ src }: { src: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  return (
    <div className="absolute inset-0" aria-hidden>
      <div className="animate-pan absolute inset-0 bg-linear-135 from-emerald-500 via-sky-600 to-fuchsia-600 bg-size-[300%_300%]" />
      {src !== null && failedSrc !== src && (
        <video
          key={src}
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onError={() => {
            setFailedSrc(src)
          }}
        />
      )}
      <div className="absolute inset-0 bg-black/30" />
    </div>
  )
}

export function StageFrame({ background, children }: { background: string | null; children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-black">
      <div className="relative aspect-9/16 w-[min(100vw,calc(100dvh*9/16))] overflow-hidden bg-neutral-950 select-none [container-type:size]">
        <BackgroundLoop src={background} />
        {children}
      </div>
    </div>
  )
}

export function CookingSticker() {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center">
      <div className="animate-pop rounded-[5cqw] bg-white px-[6cqw] py-[3cqw] text-[7cqw] font-black text-black shadow-2xl">
        <span className="inline-block animate-pulse">🍳 cooking…</span>
      </div>
    </div>
  )
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-[4cqw] bg-black/70 p-[8cqw] text-center">
      {children}
    </div>
  )
}

const BUTTON = 'rounded-full bg-accent px-[8cqw] py-[3cqw] text-[5cqw] font-black text-black uppercase shadow-xl active:scale-95'

export function ErrorCard({ message, onRetry }: { message: string; onRetry: (() => void) | null }) {
  return (
    <Overlay>
      <p className="text-[6cqw] font-black">Something broke</p>
      <p className="text-[4cqw] text-white/80">{message}</p>
      {onRetry !== null && (
        <button type="button" className={BUTTON} onClick={onRetry}>
          Try again
        </button>
      )}
    </Overlay>
  )
}

interface StageProps {
  episode: EpisodeOutline
  scenes: readonly Scene[]
  complete: boolean
}

export function Stage({ episode, scenes, complete }: StageProps) {
  const playback = usePlayback(scenes, complete)
  const template = templateFor(episode.template)
  const Template = template.component
  return (
    <StageFrame background={template.background(episode.index)}>
      {playback.scene !== null && (
        <Template episode={episode} scene={playback.scene} sceneIndex={playback.position} timeMs={playback.timeMs} />
      )}
      {playback.status === 'waiting' && <CookingSticker />}
      {playback.status === 'finished' && (
        <Overlay>
          <p className="text-[5cqw] text-white/70">Episode {String(episode.index + 1)} done</p>
          <p className="text-[7cqw] leading-tight font-black">{episode.title}</p>
          <button type="button" className={BUTTON} onClick={playback.replay}>
            Replay
          </button>
        </Overlay>
      )}
      {playback.needsTap && (
        <button
          type="button"
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 text-[7cqw] font-black"
          onClick={playback.resumeSound}
        >
          🔊 Tap for sound
        </button>
      )}
    </StageFrame>
  )
}
