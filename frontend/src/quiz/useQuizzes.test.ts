import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchQuiz } from '@/api/client'
import { useQuizzes } from '@/quiz/useQuizzes'
import { ru } from '@/strings'
import { fixtureQuiz } from '@/test/fixtureEvents'
import type { QuizRequest } from '@/types/contract'

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchQuiz: vi.fn() }))

const request: QuizRequest = {
  source_text: 'x'.repeat(300),
  language: 'ru',
  question_count: 4,
  episode: { index: 0, title: 'Эпизод', scenes: [{ id: 'e0s0', text: 'Текст', source_quote: null }] },
}

beforeEach(() => {
  vi.mocked(fetchQuiz).mockReset()
})

describe('useQuizzes', () => {
  it('fetches once per episode and stores the quiz', async () => {
    vi.mocked(fetchQuiz).mockResolvedValue(fixtureQuiz())
    const { result } = renderHook(() => useQuizzes())
    act(() => {
      result.current.load(0, request)
      result.current.load(0, request)
    })
    expect(fetchQuiz).toHaveBeenCalledOnce()
    expect(result.current.loads.get(0)).toEqual({ status: 'loading' })
    await waitFor(() => {
      expect(result.current.loads.get(0)).toEqual({ status: 'ready', quiz: fixtureQuiz() })
    })
  })

  it('reports a failure in Russian and retries on demand', async () => {
    vi.mocked(fetchQuiz).mockRejectedValueOnce(new ApiError('llm_unavailable', 'down', true))
    const { result } = renderHook(() => useQuizzes())
    act(() => {
      result.current.load(1, request)
    })
    await waitFor(() => {
      expect(result.current.loads.get(1)).toEqual({
        status: 'failed',
        failure: { kind: 'llm_unavailable', message: ru.errors.llm_unavailable, retryable: true },
      })
    })
    vi.mocked(fetchQuiz).mockResolvedValueOnce(fixtureQuiz())
    act(() => {
      result.current.load(1, request, true)
    })
    await waitFor(() => {
      expect(result.current.loads.get(1)?.status).toBe('ready')
    })
    expect(fetchQuiz).toHaveBeenCalledTimes(2)
  })

  it('aborts pending requests on unmount', () => {
    const signals: AbortSignal[] = []
    vi.mocked(fetchQuiz).mockImplementation((_, signal) => {
      signals.push(signal)
      return new Promise(() => undefined)
    })
    const { result, unmount } = renderHook(() => useQuizzes())
    act(() => {
      result.current.load(0, request)
      result.current.load(1, request)
    })
    unmount()
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
  })
})
