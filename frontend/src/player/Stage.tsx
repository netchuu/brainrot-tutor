import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { backgroundSrc } from '@/assets'
import { usePlayback } from '@/player/usePlayback'
import { ru } from '@/strings'
import { templateFor } from '@/templates/registry'
import type { EpisodeOutline, Scene } from '@/types/contract'

function BackgroundLoop({ src }: { src: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [playingSrc, setPlayingSrc] = useState<string | null>(null)
  return (
    <div className="absolute inset-0" aria-hidden>
      {(src === null || playingSrc !== src) && (
        <div className="animate-pan absolute inset-0 bg-linear-135 from-emerald-500 via-sky-600 to-fuchsia-600 bg-size-[300%_300%]" />
      )}
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
          onPlaying={() => {
            setPlayingSrc(src)
          }}
          onError={() => {
            setFailedSrc(src)
          }}
        />
      )}
      <div className="absolute inset-0 bg-black/30" />
    </div>
  )
}

export function StageFrame({
  background,
  onClose,
  children,
}: {
  background: string | null
  onClose?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-black">
      <div className="relative aspect-9/16 w-[min(100vw,calc(100dvh*9/16))] overflow-hidden bg-neutral-950 select-none [container-type:size]">
        <BackgroundLoop src={background} />
        {children}
        {onClose !== undefined && (
          <button
            type="button"
            aria-label={ru.feed.close}
            className="absolute top-[2cqh] left-[3cqw] z-[60] flex size-[11cqw] items-center justify-center rounded-full bg-black/50 text-[6cqw] leading-none font-black text-white active:scale-95"
            onClick={onClose}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export function CookingSticker({ title, caption }: { title?: string; caption?: string }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-[4cqw] px-[8cqw] text-center">
      {title !== undefined && <p className="text-outline text-[7cqw] leading-tight font-black">{title}</p>}
      <div className="animate-pop rounded-[5cqw] bg-white px-[6cqw] py-[3cqw] text-[7cqw] font-black text-black shadow-2xl">
        <span className="inline-block animate-pulse">🍳 {ru.stage.cooking}</span>
      </div>
      {caption !== undefined && <p className="text-[4.5cqw] font-bold text-white/90">{caption}</p>}
    </div>
  )
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-[4cqw] bg-black/80 p-[8cqw] text-center backdrop-blur-sm">
      {children}
    </div>
  )
}

export function StageButton({
  children,
  onClick,
  secondary = false,
}: {
  children: ReactNode
  onClick: () => void
  secondary?: boolean
}) {
  return (
    <button
      type="button"
      className={`rounded-full px-[8cqw] py-[3cqw] text-[5cqw] font-black uppercase shadow-xl active:scale-95 ${secondary ? 'bg-black/40 text-white ring-[0.6cqw] ring-white/70' : 'bg-accent text-black'}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function ErrorCard({ message, children }: { message: string; children: ReactNode }) {
  return (
    <Overlay>
      <p className="text-[6cqw] font-black">{ru.stage.errorTitle}</p>
      <p className="text-[4.5cqw] text-white/80">{message}</p>
      <div className="flex flex-col items-center gap-[3cqw]">{children}</div>
    </Overlay>
  )
}

interface StageProps {
  episode: EpisodeOutline
  scenes: readonly Scene[]
  complete: boolean
  onClose: () => void
  waitingTitle?: string
  waitingCaption?: string
  endActions: (replay: () => void) => ReactNode
  children?: ReactNode
}

export function Stage({
  episode,
  scenes,
  complete,
  onClose,
  waitingTitle,
  waitingCaption,
  endActions,
  children,
}: StageProps) {
  const playback = usePlayback(scenes, complete)
  const template = templateFor(episode.template)
  const Template = template.component

  useEffect(() => {
    for (const url of template.preload(episode)) new Image().src = url
  }, [template, episode])

  return (
    <StageFrame background={backgroundSrc(episode.background)} onClose={onClose}>
      {playback.scene !== null && (
        <Template episode={episode} scene={playback.scene} sceneIndex={playback.position} timeMs={playback.timeMs} />
      )}
      {playback.status === 'waiting' && <CookingSticker title={waitingTitle} caption={waitingCaption} />}
      {playback.status === 'finished' && (
        <Overlay>
          <p className="text-[5cqw] text-white/70">{ru.stage.episodeDone(episode.index + 1)}</p>
          <p className="text-[7cqw] leading-tight font-black">{episode.title}</p>
          <div className="flex flex-col items-center gap-[3cqw]">{endActions(playback.replay)}</div>
        </Overlay>
      )}
      {playback.needsTap && (
        <button
          type="button"
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 text-[7cqw] font-black"
          onClick={playback.resumeSound}
        >
          🔊 {ru.stage.tapForSound}
        </button>
      )}
      {children}
    </StageFrame>
  )
}
