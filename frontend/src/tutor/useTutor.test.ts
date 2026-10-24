import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, streamTutor } from '@/api/client'
import { ru } from '@/strings'
import { chatHistory, initialTutorState, tutorReducer, useTutor } from '@/tutor/useTutor'
import type { TutorTurn } from '@/tutor/useTutor'
import type { TutorEvent } from '@/types/contract'

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<object>()), streamTutor: vi.fn() }))

async function* events(...items: TutorEvent[]): AsyncGenerator<TutorEvent> {
  for (const item of items) {
    await Promise.resolve()
    yield item
  }
}

async function* failing(error: Error, ...items: TutorEvent[]): AsyncGenerator<TutorEvent> {
  for (const item of items) yield item
  await Promise.resolve()
  throw error
}

function turn(role: TutorTurn['role'], content: string): TutorTurn {
  return { role, content, sources: [], complete: true }
}

beforeEach(() => {
  vi.mocked(streamTutor).mockReset()
})

describe('tutorReducer', () => {
  it('streams an answer into the last turn and finishes it with sources', () => {
    let state = tutorReducer(initialTutorState, { type: 'asked', question: 'Что такое ЭБУ?' })
    state = tutorReducer(state, { type: 'delta', text: 'Это ' })
    state = tutorReducer(state, { type: 'delta', text: 'компьютер.' })
    state = tutorReducer(state, { type: 'done', sources: ['ЭБУ — это компьютер'] })
    expect(state.status).toBe('idle')
    expect(state.turns).toEqual([
      turn('user', 'Что такое ЭБУ?'),
      { role: 'assistant', content: 'Это компьютер.', sources: ['ЭБУ — это компьютер'], complete: true },
    ])
  })

  it('drops an unfinished answer when the question is sent again', () => {
    let state = tutorReducer(initialTutorState, { type: 'asked', question: 'Вопрос' })
    state = tutorReducer(state, { type: 'delta', text: 'Обрыв' })
    state = tutorReducer(state, { type: 'failed', failure: { kind: 'network', message: ru.errors.network, retryable: true } })
    state = tutorReducer(state, { type: 'resent' })
    expect(state.turns).toEqual([turn('user', 'Вопрос'), { role: 'assistant', content: '', sources: [], complete: false }])
    expect(state.status).toBe('streaming')
  })
})

describe('chatHistory', () => {
  it('keeps the last 20 non-empty messages, each at most 2000 characters', () => {
    const turns = Array.from({ length: 25 }, (_, index) => turn(index % 2 === 0 ? 'user' : 'assistant', `m${String(index)}`))
    turns.push(turn('assistant', ''), turn('user', 'я'.repeat(2500)))
    const history = chatHistory(turns)
    expect(history).toHaveLength(20)
    expect(history.at(-1)).toEqual({ role: 'user', content: 'я'.repeat(2000) })
    expect(history.every((message) => message.content !== '')).toBe(true)
  })
})

describe('useTutor', () => {
  it('sends the source and the chat, then shows the answer with its quotes', async () => {
    vi.mocked(streamTutor).mockImplementation(() =>
      events({ type: 'delta', text: 'Ответ ' }, { type: 'delta', text: 'из текста.' }, { type: 'done', source_quotes: ['Цитата'] }),
    )
    const { result } = renderHook(() => useTutor('x'.repeat(300), 'ru'))
    act(() => {
      result.current.ask('  Зачем диностенд?  ')
    })
    await waitFor(() => {
      expect(result.current.state.status).toBe('idle')
    })
    expect(vi.mocked(streamTutor).mock.calls[0]?.[0]).toEqual({
      source_text: 'x'.repeat(300),
      language: 'ru',
      messages: [{ role: 'user', content: 'Зачем диностенд?' }],
    })
    expect(result.current.state.turns.at(-1)).toEqual({
      role: 'assistant',
      content: 'Ответ из текста.',
      sources: ['Цитата'],
      complete: true,
    })
  })

  it('shows an error event in Russian and retries the same question', async () => {
    vi.mocked(streamTutor)
      .mockImplementationOnce(() => events({ type: 'error', code: 'rate_limited', message: 'slow', retryable: true }))
      .mockImplementationOnce(() => events({ type: 'delta', text: 'Готово' }, { type: 'done', source_quotes: [] }))
    const { result } = renderHook(() => useTutor('x'.repeat(300), 'ru'))
    act(() => {
      result.current.ask('Вопрос')
    })
    await waitFor(() => {
      expect(result.current.state.failure?.message).toBe(ru.errors.rate_limited)
    })
    act(() => {
      result.current.retry()
    })
    await waitFor(() => {
      expect(result.current.state.status).toBe('idle')
    })
    expect(vi.mocked(streamTutor).mock.calls[1]?.[0].messages).toEqual([{ role: 'user', content: 'Вопрос' }])
    expect(result.current.state.turns).toHaveLength(2)
  })

  it('maps a broken stream to a retryable failure', async () => {
    vi.mocked(streamTutor).mockImplementation(() =>
      failing(new ApiError('llm_unavailable', 'down', true), { type: 'delta', text: 'Часть' }),
    )
    const { result } = renderHook(() => useTutor('x'.repeat(300), 'ru'))
    act(() => {
      result.current.ask('Вопрос')
    })
    await waitFor(() => {
      expect(result.current.state.status).toBe('failed')
    })
    expect(result.current.state.failure).toEqual({
      kind: 'llm_unavailable',
      message: ru.errors.llm_unavailable,
      retryable: true,
    })
  })
})
