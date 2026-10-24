import { useEffect, useMemo, useState } from 'react'
import { CookingSticker, ErrorCard, Stage, StageButton, StageFrame } from '@/player/Stage'
import type { StreamState } from '@/player/useEpisodeStream'
import type { SwipeDirection } from '@/player/useSwipe'
import { useQuizzes } from '@/quiz/useQuizzes'
import { Quiz } from '@/screens/Quiz'
import { Tutor } from '@/screens/Tutor'
import { ru } from '@/strings'
import { useTutor } from '@/tutor/useTutor'
import type { EpisodeOutline, EpisodesRequest, Language, QuizRequest, Scene } from '@/types/contract'

const NO_SCENES: readonly Scene[] = []
const QUIZ_QUESTION_COUNT = 4
const MAX_QUIZ_TITLE_CHARS = 200

function quizRequest(
  request: EpisodesRequest,
  language: Language,
  episode: EpisodeOutline,
  scenes: readonly Scene[],
): QuizRequest {
  return {
    source_text: request.source_text,
    language,
    question_count: QUIZ_QUESTION_COUNT,
    episode: {
      index: episode.index,
      title: episode.title.slice(0, MAX_QUIZ_TITLE_CHARS),
      scenes: scenes.map((scene) => ({ id: scene.id, text: scene.text, source_quote: scene.source_quote })),
    },
  }
}

interface FeedProps {
  state: StreamState
  request: EpisodesRequest
  onRetry: () => void
  onExit: () => void
}

export function Feed({ state, request, onRetry, onExit }: FeedProps) {
  const [episodeIndex, setEpisodeIndex] = useState(0)
  const [view, setView] = useState<'watch' | 'quiz' | 'tutor'>('watch')
  const [replaySceneId, setReplaySceneId] = useState<string | null>(null)
  const [watchRun, setWatchRun] = useState(0)
  const { loads, load } = useQuizzes()

  const { plan, error } = state
  const episode = plan?.episodes[episodeIndex]
  const scenes = (episode === undefined ? undefined : state.scenes[episode.index]) ?? NO_SCENES
  const streaming = state.status === 'streaming'
  const language = plan?.language ?? request.language
  const episodeComplete =
    episode !== undefined && scenes.length > 0 && (state.episodeDone[episode.index] === true || !streaming)
  const tutor = useTutor(request.source_text, language)
  const sceneIds = useMemo(() => new Set(scenes.map((scene) => scene.id)), [scenes])
  const replayScenes = useMemo(() => scenes.filter((scene) => scene.id === replaySceneId), [scenes, replaySceneId])

  useEffect(() => {
    if (episodeComplete) load(episode.index, quizRequest(request, language, episode, scenes))
  }, [episodeComplete, episode, scenes, request, language, load])

  const hasScenes = state.scenes.some((received) => received.length > 0)

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

  if (plan === null || episode === undefined) {
    return (
      <StageFrame background={null} onClose={onExit}>
        <CookingSticker caption={ru.feed.writingScript} />
      </StageFrame>
    )
  }

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
  const goNext = nextReady
    ? () => {
        setEpisodeIndex(episodeIndex + 1)
        setView('watch')
        setReplaySceneId(null)
      }
    : null
  const goPrevious =
    episodeIndex > 0
      ? () => {
          setEpisodeIndex(episodeIndex - 1)
          setView('watch')
          setReplaySceneId(null)
        }
      : null
  const swipe = (direction: SwipeDirection) => {
    if (direction === 'up') goNext?.()
    else goPrevious?.()
  }
  const firstWait = episodeIndex === 0 && scenes.length === 0
  const replaying = view !== 'watch' && replayScenes.length > 0

  if (view === 'quiz' || view === 'tutor') {
    return (
      <>
        {view === 'tutor' && (
          <Tutor
            state={tutor.state}
            onAsk={tutor.ask}
            onRetry={tutor.retry}
            onClose={() => {
              setView('quiz')
            }}
          />
        )}
        <div hidden={replaying || view === 'tutor'}>
          <Quiz
            key={episode.index}
            episode={episode}
            load={loads.get(episode.index)}
            language={language}
            replayableSceneIds={sceneIds}
            onRetry={() => {
              load(episode.index, quizRequest(request, language, episode, scenes), true)
            }}
            onReplayScene={setReplaySceneId}
            onRewatch={() => {
              setView('watch')
              setWatchRun((run) => run + 1)
            }}
            onNext={goNext}
            onAskTutor={() => {
              setView('tutor')
            }}
            onExit={onExit}
          />
        </div>
        {replaying && (
          <Stage
            key={`replay-${replayScenes[0]?.id ?? ''}`}
            episode={episode}
            scenes={replayScenes}
            complete
            onClose={() => {
              setReplaySceneId(null)
            }}
            finishedTitle={ru.quiz.sceneReplayed}
            endActions={(replay) => (
              <>
                <StageButton
                  onClick={() => {
                    setReplaySceneId(null)
                  }}
                >
                  {ru.quiz.backToQuiz}
                </StageButton>
                <StageButton secondary onClick={replay}>
                  {ru.feed.replay}
                </StageButton>
              </>
            )}
          />
        )}
      </>
    )
  }

  return (
    <Stage
      key={`${String(episode.index)}-${String(watchRun)}`}
      episode={episode}
      scenes={scenes}
      complete={complete}
      onClose={onExit}
      waitingTitle={firstWait ? plan.course_title : undefined}
      waitingCaption={firstWait ? ru.feed.voicingFirst : undefined}
      onSwipe={swipe}
      endActions={(replay) => (
        <>
          <StageButton
            onClick={() => {
              setView('quiz')
            }}
          >
            {ru.quiz.take}
          </StageButton>
          {goNext !== null && (
            <StageButton secondary onClick={goNext}>
              {ru.feed.nextEpisode}
            </StageButton>
          )}
          {goNext !== null && <p className="text-[3.6cqw] text-white/60">↑ {ru.feed.swipeHint}</p>}
          <StageButton secondary onClick={replay}>
            {ru.feed.replay}
          </StageButton>
          {goNext === null && (
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
