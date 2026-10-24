import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchQuiz } from '@/api/client'
import { toFailure } from '@/api/failure'
import type { Failure } from '@/api/failure'
import type { QuizRequest, QuizResponse } from '@/types/contract'

export type QuizLoad =
  | { status: 'loading' }
  | { status: 'ready'; quiz: QuizResponse }
  | { status: 'failed'; failure: Failure }

export function useQuizzes() {
  const [loads, setLoads] = useState<ReadonlyMap<number, QuizLoad>>(() => new Map())
  const controllers = useRef(new Map<number, AbortController>())

  useEffect(() => {
    const active = controllers.current
    return () => {
      for (const controller of active.values()) controller.abort()
      active.clear()
    }
  }, [])

  const load = useCallback((episodeIndex: number, request: QuizRequest, retry = false) => {
    if (!retry && controllers.current.has(episodeIndex)) return
    controllers.current.get(episodeIndex)?.abort()
    const controller = new AbortController()
    controllers.current.set(episodeIndex, controller)
    const settle = (next: QuizLoad) => {
      setLoads((current) => new Map(current).set(episodeIndex, next))
    }
    settle({ status: 'loading' })
    fetchQuiz(request, controller.signal).then(
      (quiz) => {
        if (!controller.signal.aborted) settle({ status: 'ready', quiz })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = toFailure(error)
        settle({ status: 'failed', failure })
        if (failure.kind === 'unknown') throw error
      },
    )
  }, [])

  return { loads, load }
}
