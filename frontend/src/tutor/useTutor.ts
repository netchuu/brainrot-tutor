import { useCallback, useEffect, useReducer, useRef } from 'react'
import { streamTutor } from '@/api/client'
import { failure, toFailure } from '@/api/failure'
import type { Failure } from '@/api/failure'
import type { ChatMessage, Language } from '@/types/contract'

const MAX_MESSAGES = 20
export const MAX_MESSAGE_CHARS = 2000

export interface TutorTurn {
  role: ChatMessage['role']
  content: string
  sources: string[]
  complete: boolean
}

export interface TutorState {
  turns: TutorTurn[]
  status: 'idle' | 'streaming' | 'failed'
  failure: Failure | null
}

export type TutorAction =
  | { type: 'asked'; question: string }
  | { type: 'resent' }
  | { type: 'delta'; text: string }
  | { type: 'done'; sources: string[] }
  | { type: 'failed'; failure: Failure }

export const initialTutorState: TutorState = { turns: [], status: 'idle', failure: null }

function withoutPendingAnswer(turns: TutorTurn[]): TutorTurn[] {
  const last = turns.at(-1)
  return last?.role === 'assistant' && !last.complete ? turns.slice(0, -1) : turns
}

function userTurn(content: string): TutorTurn {
  return { role: 'user', content, sources: [], complete: true }
}

function updateAnswer(turns: TutorTurn[], update: (answer: TutorTurn) => TutorTurn): TutorTurn[] {
  const last = turns.at(-1)
  if (last?.role !== 'assistant') return turns
  return [...turns.slice(0, -1), update(last)]
}

export function tutorReducer(state: TutorState, action: TutorAction): TutorState {
  const emptyAnswer: TutorTurn = { role: 'assistant', content: '', sources: [], complete: false }
  switch (action.type) {
    case 'asked':
      return {
        turns: [...withoutPendingAnswer(state.turns), userTurn(action.question), emptyAnswer],
        status: 'streaming',
        failure: null,
      }
    case 'resent':
      return { turns: [...withoutPendingAnswer(state.turns), emptyAnswer], status: 'streaming', failure: null }
    case 'delta':
      return { ...state, turns: updateAnswer(state.turns, (answer) => ({ ...answer, content: answer.content + action.text })) }
    case 'done':
      return {
        ...state,
        status: 'idle',
        turns: updateAnswer(state.turns, (answer) => ({ ...answer, sources: action.sources, complete: true })),
      }
    case 'failed':
      return { ...state, status: 'failed', failure: action.failure }
  }
}

// The contract takes at most 20 messages, each 1–2000 characters, ending with the user's question.
export function chatHistory(turns: readonly TutorTurn[]): ChatMessage[] {
  return turns
    .filter((turn) => turn.content.trim() !== '')
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_MESSAGES)
}

export function useTutor(sourceText: string, language: Language) {
  const [state, dispatch] = useReducer(tutorReducer, initialTutorState)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const run = useCallback(
    async (turns: readonly TutorTurn[]) => {
      controller.current?.abort()
      const current = new AbortController()
      controller.current = current
      try {
        const request = { source_text: sourceText, language, messages: chatHistory(turns) }
        for await (const event of streamTutor(request, current.signal)) {
          if (current.signal.aborted) return
          if (event.type === 'delta') dispatch({ type: 'delta', text: event.text })
          else if (event.type === 'done') dispatch({ type: 'done', sources: event.source_quotes })
          else dispatch({ type: 'failed', failure: failure(event.code, event.retryable) })
        }
      } catch (error) {
        if (current.signal.aborted) return
        const reason = toFailure(error)
        dispatch({ type: 'failed', failure: reason })
        if (reason.kind === 'unknown') throw error
      }
    },
    [sourceText, language],
  )

  const ask = useCallback(
    (question: string) => {
      const text = question.trim().slice(0, MAX_MESSAGE_CHARS)
      if (text === '' || state.status === 'streaming') return
      dispatch({ type: 'asked', question: text })
      void run([...withoutPendingAnswer(state.turns), userTurn(text)])
    },
    [run, state.status, state.turns],
  )

  const retry = useCallback(() => {
    if (state.status !== 'failed') return
    dispatch({ type: 'resent' })
    void run(withoutPendingAnswer(state.turns))
  }, [run, state.status, state.turns])

  return { state, ask, retry }
}
