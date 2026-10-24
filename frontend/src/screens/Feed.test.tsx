import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialStreamState, streamReducer } from '@/player/useEpisodeStream'
import type { StreamFailure, StreamState } from '@/player/useEpisodeStream'
import type { QuizLoad } from '@/quiz/useQuizzes'
import { Feed } from '@/screens/Feed'
import { ru } from '@/strings'
import { fixtureEvents, fixtureQuiz } from '@/test/fixtureEvents'
import type { EpisodeOutline, EpisodesRequest, QuizRequest, Scene } from '@/types/contract'

interface StageStubProps {
  episode: EpisodeOutline
  scenes: readonly Scene[]
  complete: boolean
  waitingTitle?: string
  waitingCaption?: string
  finishedTitle?: string
  endActions: (replay: () => void) => ReactNode
  onSwipe?: (direction: 'up' | 'down') => void
  children?: ReactNode
}

const quizzes = vi.hoisted(() => ({
  loads: new Map<number, QuizLoad>(),
  load: vi.fn<(episodeIndex: number, request: QuizRequest, retry?: boolean) => void>(),
}))

vi.mock('@/quiz/useQuizzes', () => ({ useQuizzes: () => ({ loads: quizzes.loads, load: quizzes.load }) }))

vi.mock('@/player/Stage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Stage: ({
    episode,
    scenes,
    complete,
    waitingTitle,
    waitingCaption,
    finishedTitle,
    endActions,
    onSwipe,
    children,
  }: StageStubProps) => (
    <div
      data-testid="stage"
      data-episode={episode.index}
      data-scenes={scenes.length}
      data-first-scene={scenes[0]?.id}
      data-complete={complete}
    >
      {waitingTitle}
      {waitingCaption}
      {finishedTitle}
      <button type="button" onClick={() => onSwipe?.('up')}>
        swipe-up
      </button>
      <button type="button" onClick={() => onSwipe?.('down')}>
        swipe-down
      </button>
      {endActions(() => undefined)}
      {children}
    </div>
  ),
}))

const onRetry = vi.fn()
const onExit = vi.fn()

function streamed(count: number): StreamState {
  return fixtureEvents
    .slice(0, count)
    .reduce(
      (state, event) => streamReducer(state, { type: 'event', event }),
      streamReducer(initialStreamState, { type: 'started' }),
    )
}

function failed(state: StreamState, retryable: boolean): StreamState {
  const error: StreamFailure = { kind: 'llm_unavailable', message: ru.errors.llm_unavailable, retryable }
  return streamReducer(state, { type: 'failed', error })
}

const request: EpisodesRequest = { source_text: 'x'.repeat(300), language: 'ru', episode_count: 3, template: null }

function renderFeed(state: StreamState) {
  return render(<Feed state={state} request={request} onRetry={onRetry} onExit={onExit} />)
}

beforeEach(() => {
  onRetry.mockReset()
  onExit.mockReset()
  quizzes.load.mockReset()
  quizzes.loads.clear()
})

describe('Feed', () => {
  it('says the script is being written before the plan and closes on ✕', () => {
    renderFeed(streamed(0))
    expect(screen.getByText(ru.feed.writingScript)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.close }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('shows the course title while the first scene is being voiced', () => {
    renderFeed(streamed(1))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-scenes', '0')
    expect(screen.getByText(/Чип-тюнинг ЭБУ за 3 минуты/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(ru.feed.voicingFirst))).toBeInTheDocument()
  })

  it('shows a full error card with retry when nothing is playable', () => {
    renderFeed(failed(streamed(1), true))
    expect(screen.getByText(ru.errors.llm_unavailable)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.editText }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('hides retry for an error that is not retryable', () => {
    renderFeed(failed(streamed(0), false))
    expect(screen.queryByRole('button', { name: ru.feed.retry })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: ru.feed.editText })).toBeInTheDocument()
  })

  it('shows an error card instead of an empty episode once the stream has ended', () => {
    const ended = streamReducer(streamed(1), { type: 'event', event: { type: 'done', elapsed_ms: 10 } })
    renderFeed(ended)
    expect(screen.queryByTestId('stage')).not.toBeInTheDocument()
    expect(screen.getByText(ru.errors.broken)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps playing arrived scenes and shows a banner when the stream fails later', () => {
    renderFeed(failed(streamed(3), true))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-scenes', '2')
    expect(screen.getByTestId('stage')).toHaveAttribute('data-complete', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(ru.errors.llm_unavailable)
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('moves to the next episode and offers a new text after the last one', () => {
    renderFeed(streamed(fixtureEvents.length))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '0')
    fireEvent.click(screen.getByRole('button', { name: ru.feed.nextEpisode }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '1')
    fireEvent.click(screen.getByRole('button', { name: ru.feed.nextEpisode }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '2')
    expect(screen.queryByRole('button', { name: ru.feed.nextEpisode })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.newText }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('prefetches the quiz once the episode has all its scenes', () => {
    const firstEpisodeDone = fixtureEvents.findIndex((event) => event.type === 'episode_done') + 1
    const { rerender } = renderFeed(streamed(firstEpisodeDone - 1))
    expect(quizzes.load).not.toHaveBeenCalled()
    rerender(<Feed state={streamed(firstEpisodeDone)} request={request} onRetry={onRetry} onExit={onExit} />)
    expect(quizzes.load).toHaveBeenCalledOnce()
    const [episodeIndex, quizRequest] = quizzes.load.mock.calls[0] ?? []
    expect(episodeIndex).toBe(0)
    expect(quizRequest?.source_text).toBe(request.source_text)
    expect(quizRequest?.episode.scenes.map((scene) => scene.id)).toEqual(['e0s0', 'e0s1', 'e0s2', 'e0s3'])
  })

  it('opens the quiz, replays a missed scene and comes back with the answer kept', () => {
    quizzes.loads.set(0, { status: 'ready', quiz: fixtureQuiz() })
    renderFeed(streamed(fixtureEvents.length))
    fireEvent.click(screen.getByRole('button', { name: ru.quiz.take }))
    expect(screen.getByText(ru.quiz.progress(1, 4))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Тип топлива' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ru.quiz.replayScene) }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-first-scene', 'e0s0')
    expect(screen.getByTestId('stage')).toHaveAttribute('data-scenes', '1')
    expect(screen.getByText(ru.quiz.sceneReplayed)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.quiz.backToQuiz }))
    expect(screen.queryByTestId('stage')).not.toBeInTheDocument()
    expect(screen.getByText(ru.quiz.wrong)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Тип топлива' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('retries a failed quiz with a fresh request', () => {
    quizzes.loads.set(0, {
      status: 'failed',
      failure: { kind: 'llm_unavailable', message: ru.errors.llm_unavailable, retryable: true },
    })
    renderFeed(streamed(fixtureEvents.length))
    quizzes.load.mockClear()
    fireEvent.click(screen.getByRole('button', { name: ru.quiz.take }))
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(quizzes.load).toHaveBeenCalledWith(0, expect.objectContaining({ question_count: 4 }), true)
  })

  it('swipes between episodes', () => {
    renderFeed(streamed(fixtureEvents.length))
    fireEvent.click(screen.getByRole('button', { name: 'swipe-down' }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '0')
    fireEvent.click(screen.getByRole('button', { name: 'swipe-up' }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '1')
    fireEvent.click(screen.getByRole('button', { name: 'swipe-down' }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '0')
  })

  it('opens the tutor from the quiz summary and returns to the same summary', () => {
    const quiz = fixtureQuiz()
    quizzes.loads.set(0, { status: 'ready', quiz: { ...quiz, questions: quiz.questions.slice(0, 3) } })
    renderFeed(streamed(fixtureEvents.length))
    fireEvent.click(screen.getByRole('button', { name: ru.quiz.take }))
    const answers = ['Компьютер, который управляет двигателем', 'Каждую миллисекунду', 'Карты']
    answers.forEach((option, index) => {
      fireEvent.click(screen.getByRole('button', { name: option }))
      fireEvent.click(screen.getByRole('button', { name: index < answers.length - 1 ? ru.quiz.next : ru.quiz.results }))
    })
    expect(screen.getByText(ru.quiz.summary(3, 3))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ru.tutor.open) }))
    expect(screen.getByRole('heading', { name: new RegExp(ru.tutor.title) })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.tutor.back }))
    expect(screen.getByText(ru.quiz.summary(3, 3))).toBeVisible()
  })
})
