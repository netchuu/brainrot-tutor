import { useCallback, useEffect, useReducer, useRef } from 'react'
import { ApiError, ContractError, StreamParseError, streamEpisodes } from '@/api/client'
import type { EpisodesRequest, ErrorCode, PlanEvent, Scene, StreamEvent } from '@/types/contract'

export interface StreamFailure {
  code: ErrorCode
  message: string
  retryable: boolean
}

export interface StreamState {
  status: 'idle' | 'streaming' | 'done' | 'failed'
  plan: PlanEvent | null
  scenes: Scene[][]
  episodeDone: boolean[]
  elapsedMs: number | null
  error: StreamFailure | null
}

export type StreamAction =
  | { type: 'started' }
  | { type: 'event'; event: StreamEvent }
  | { type: 'failed'; error: StreamFailure }

export const initialStreamState: StreamState = {
  status: 'idle',
  plan: null,
  scenes: [],
  episodeDone: [],
  elapsedMs: null,
  error: null,
}

function replaceAt<T>(items: T[], index: number, value: T, filler: T): T[] {
  const length = Math.max(items.length, index + 1)
  return Array.from({ length }, (_, i) => (i === index ? value : (items[i] ?? filler)))
}

function applyEvent(state: StreamState, event: StreamEvent): StreamState {
  switch (event.type) {
    case 'plan':
      return {
        ...state,
        plan: event,
        scenes: event.episodes.map(() => []),
        episodeDone: event.episodes.map(() => false),
      }
    case 'scene': {
      const received = state.scenes[event.episode] ?? []
      return { ...state, scenes: replaceAt(state.scenes, event.episode, [...received, event.scene], []) }
    }
    case 'episode_done':
      return { ...state, episodeDone: replaceAt(state.episodeDone, event.episode, true, false) }
    case 'done':
      return { ...state, status: 'done', elapsedMs: event.elapsed_ms }
    case 'error':
      return {
        ...state,
        status: 'failed',
        error: { code: event.code, message: event.message, retryable: event.retryable },
      }
  }
}

export function streamReducer(state: StreamState, action: StreamAction): StreamState {
  switch (action.type) {
    case 'started':
      return { ...initialStreamState, status: 'streaming' }
    case 'event':
      return applyEvent(state, action.event)
    case 'failed':
      return { ...state, status: 'failed', error: action.error }
  }
}

export function toFailure(error: unknown): StreamFailure {
  if (error instanceof ApiError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof ContractError || error instanceof StreamParseError) {
    return { code: 'internal', message: 'The lesson stream broke off. Try again.', retryable: true }
  }
  if (error instanceof TypeError) {
    return { code: 'internal', message: 'Network problem. Check the connection and try again.', retryable: true }
  }
  return { code: 'internal', message: 'Something went wrong while making the lesson.', retryable: true }
}

async function consume(
  request: EpisodesRequest | Promise<EpisodesRequest>,
  signal: AbortSignal,
  dispatch: (action: StreamAction) => void,
) {
  try {
    for await (const event of streamEpisodes(await request, signal)) {
      if (signal.aborted) return
      dispatch({ type: 'event', event })
    }
  } catch (error) {
    if (signal.aborted) return
    dispatch({ type: 'failed', error: toFailure(error) })
  }
}

export function useEpisodeStream() {
  const [state, dispatch] = useReducer(streamReducer, initialStreamState)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => controllerRef.current?.abort(), [])

  const start = useCallback((request: EpisodesRequest | Promise<EpisodesRequest>) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'started' })
    void consume(request, controller.signal, dispatch)
  }, [])

  return { state, start }
}
