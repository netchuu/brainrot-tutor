import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, gradeOpenAnswer } from '@/api/client'
import type { QuizLoad } from '@/quiz/useQuizzes'
import { Quiz } from '@/screens/Quiz'
import { ru } from '@/strings'
import { fixtureEvents, fixtureQuiz } from '@/test/fixtureEvents'
import type { EpisodeOutline } from '@/types/contract'

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<object>()), gradeOpenAnswer: vi.fn() }))

const plan = fixtureEvents[0]
if (plan?.type !== 'plan' || plan.episodes[0] === undefined) throw new Error('fixture must start with a plan')
const episode: EpisodeOutline = plan.episodes[0]
const ready: QuizLoad = { status: 'ready', quiz: fixtureQuiz() }

const onReplayScene = vi.fn<(sceneId: string) => void>()
const onNext = vi.fn()
const onRetry = vi.fn()
const onExit = vi.fn()

function renderQuiz(load: QuizLoad | undefined, sceneIds: string[] = ['e0s0', 'e0s1', 'e0s2', 'e0s3']) {
  return render(
    <Quiz
      episode={episode}
      load={load}
      language="ru"
      replayableSceneIds={new Set(sceneIds)}
      onRetry={onRetry}
      onReplayScene={onReplayScene}
      onRewatch={vi.fn()}
      onNext={onNext}
      onAskTutor={vi.fn()}
      onExit={onExit}
    />,
  )
}

function next() {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^(${ru.quiz.next}|${ru.quiz.results})$`) }))
}

beforeEach(() => {
  onReplayScene.mockReset()
  onNext.mockReset()
  onRetry.mockReset()
  vi.mocked(gradeOpenAnswer).mockReset()
})

describe('Quiz', () => {
  it('waits for the prefetched quiz and offers retry when it failed', () => {
    const { rerender } = renderQuiz(undefined)
    expect(screen.getByRole('status')).toHaveTextContent(ru.quiz.loading)
    rerender(
      <Quiz
        episode={episode}
        load={{ status: 'failed', failure: { kind: 'timeout', message: ru.errors.timeout, retryable: true } }}
        language="ru"
        replayableSceneIds={new Set()}
        onRetry={onRetry}
        onReplayScene={onReplayScene}
        onRewatch={vi.fn()}
        onNext={onNext}
        onAskTutor={vi.fn()}
        onExit={onExit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows the right answer, the explanation and the source quote after a wrong pick', () => {
    renderQuiz(ready)
    fireEvent.click(screen.getByRole('button', { name: 'Тип топлива' }))
    expect(screen.getByRole('button', { name: 'Компьютер, который управляет двигателем' })).toHaveClass('bg-emerald-600')
    expect(screen.getByRole('button', { name: 'Тип топлива' })).toHaveClass('bg-red-600')
    expect(screen.getByText(ru.quiz.wrong)).toBeInTheDocument()
    expect(screen.getByText(/компьютер, который управляет работой двигателя\.$/)).toBeInTheDocument()
    expect(screen.getByText(/«Электронный блок управления \(ЭБУ\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ru.quiz.replayScene) }))
    expect(onReplayScene).toHaveBeenCalledWith('e0s0')
  })

  it('hides replay for a right answer and for scenes outside the episode', () => {
    const { unmount } = renderQuiz(ready)
    fireEvent.click(screen.getByRole('button', { name: 'Компьютер, который управляет двигателем' }))
    expect(screen.getByText(ru.quiz.correct)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: new RegExp(ru.quiz.replayScene) })).not.toBeInTheDocument()
    unmount()
    renderQuiz(ready, [])
    fireEvent.click(screen.getByRole('button', { name: 'Тип топлива' }))
    expect(screen.queryByRole('button', { name: new RegExp(ru.quiz.replayScene) })).not.toBeInTheDocument()
  })

  it('lets the learner skip an open question whose grading keeps failing', async () => {
    vi.mocked(gradeOpenAnswer).mockRejectedValue(new ApiError('bad_input', 'too long', false))
    renderQuiz(ready)
    fireEvent.click(screen.getByRole('button', { name: 'Компьютер, который управляет двигателем' }))
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Каждую миллисекунду' }))
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Логи' }))
    next()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ответ' } })
    fireEvent.click(screen.getByRole('button', { name: ru.quiz.check }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ru.errors.bad_input)
    fireEvent.click(screen.getByRole('button', { name: ru.quiz.skip }))
    expect(screen.getByText(ru.quiz.skipped)).toBeInTheDocument()
    expect(screen.getByText(ru.quiz.reference)).toBeInTheDocument()
    next()
    expect(screen.getByText(ru.quiz.summary(2, 4))).toBeInTheDocument()
  })

  it('offers the next episode when the quiz itself failed', () => {
    renderQuiz({ status: 'failed', failure: { kind: 'bad_input', message: ru.errors.bad_input, retryable: false } })
    expect(screen.queryByRole('button', { name: ru.feed.retry })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.nextEpisode }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('grades the open answer through the backend, retries a failure and scores the quiz', async () => {
    vi.mocked(gradeOpenAnswer)
      .mockRejectedValueOnce(new ApiError('rate_limited', 'slow down', true))
      .mockResolvedValueOnce({ correct: true, score: 0.85, feedback: 'Всё верно, про топливо и зажигание.' })
    renderQuiz(ready)
    fireEvent.click(screen.getByRole('button', { name: 'Компьютер, который управляет двигателем' }))
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Раз в минуту' }))
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Карты' }))
    next()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Сколько топлива и когда поджечь  ' } })
    fireEvent.click(screen.getByRole('button', { name: ru.quiz.check }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ru.errors.rate_limited)
    fireEvent.click(screen.getByRole('button', { name: ru.quiz.check }))
    expect(await screen.findByText('Всё верно, про топливо и зажигание.')).toBeInTheDocument()
    expect(screen.getByText(ru.quiz.scorePercent(0.85))).toBeInTheDocument()
    expect(vi.mocked(gradeOpenAnswer).mock.calls[1]?.[0]).toMatchObject({
      language: 'ru',
      answer: 'Сколько топлива и когда поджечь',
      question: { id: 'q4' },
    })
    next()
    expect(screen.getByText(ru.quiz.summary(3, 4))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.nextEpisode }))
    await waitFor(() => {
      expect(onNext).toHaveBeenCalledOnce()
    })
  })
})
