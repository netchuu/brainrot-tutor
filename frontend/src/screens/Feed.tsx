import { useState } from 'react'
import { CookingSticker, ErrorCard, Stage, StageButton, StageFrame } from '@/player/Stage'
import type { StreamState } from '@/player/useEpisodeStream'
import { ru } from '@/strings'
import type { Scene } from '@/types/contract'

const NO_SCENES: readonly Scene[] = []

interface FeedProps {
  state: StreamState
  onRetry: () => void
  onExit: () => void
}

export function Feed({ state, onRetry, onExit }: FeedProps) {
  const [episodeIndex, setEpisodeIndex] = useState(0)
  const { plan, error } = state
  const hasScenes = state.scenes.some((scenes) => scenes.length > 0)

  if (error !== null && !hasScenes) {
    return (
      <StageFrame background={null} onClose={onExit}>
        <ErrorCard message={error.message}>
          {error.retryable && <StageButton onClick={onRetry}>{ru.feed.retry}</StageButton>}
          <StageButton secondary onClick={onExit}>
            {ru.feed.editText}
          </StageButton>
        </ErrorCard>
      </StageFrame>
    )
  }

  const episode = plan?.episodes[episodeIndex]
  if (plan === null || episode === undefined) {
    return (
      <StageFrame background={null} onClose={onExit}>
        <CookingSticker caption={ru.feed.writingScript} />
      </StageFrame>
    )
  }

  const scenes = state.scenes[episode.index] ?? NO_SCENES
  const streaming = state.status === 'streaming'

  if (scenes.length === 0 && !streaming) {
    return (
      <StageFrame background={null} onClose={onExit}>
        <ErrorCard message={error?.message ?? ru.errors.broken}>
          {(error === null || error.retryable) && <StageButton onClick={onRetry}>{ru.feed.retry}</StageButton>}
          <StageButton secondary onClick={onExit}>
            {ru.feed.editText}
          </StageButton>
        </ErrorCard>
      </StageFrame>
    )
  }

  const complete = state.episodeDone[episode.index] === true || scenes.length >= episode.scene_count || !streaming
  const next = plan.episodes[episodeIndex + 1]
  const nextReady = next !== undefined && (streaming || (state.scenes[next.index]?.length ?? 0) > 0)
  const firstWait = episodeIndex === 0 && scenes.length === 0

  return (
    <Stage
      key={episode.index}
      episode={episode}
      scenes={scenes}
      complete={complete}
      onClose={onExit}
      waitingTitle={firstWait ? plan.course_title : undefined}
      waitingCaption={firstWait ? ru.feed.voicingFirst : undefined}
      endActions={(replay) => (
        <>
          {nextReady && (
            <StageButton
              onClick={() => {
                setEpisodeIndex(episodeIndex + 1)
              }}
            >
              {ru.feed.nextEpisode}
            </StageButton>
          )}
          <StageButton secondary onClick={replay}>
            {ru.feed.replay}
          </StageButton>
          {!nextReady && (
            <StageButton secondary onClick={onExit}>
              {ru.feed.newText}
            </StageButton>
          )}
        </>
      )}
    >
      {error !== null && (
        <div
          role="alert"
          className="absolute top-[2cqh] right-[3cqw] left-[17cqw] z-[55] flex items-center gap-[3cqw] rounded-[4cqw] bg-red-600/90 px-[4cqw] py-[2.5cqw] text-[3.6cqw] font-bold shadow-xl"
        >
          <span className="flex-1">{error.message}</span>
          {error.retryable && (
            <button type="button" className="rounded-full bg-white px-[3cqw] py-[1.5cqw] text-black" onClick={onRetry}>
              {ru.feed.retry}
            </button>
          )}
        </div>
      )}
    </Stage>
  )
}
