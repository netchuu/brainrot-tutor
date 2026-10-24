import { fixtureEpisodeStream, fixtureGradeText, fixtureQuizText, fixtureTutorStream, USE_FIXTURES } from '@/api/fixtures'
import { isErrorResponse, isGradeResponse, isQuizResponse, isStreamEvent, isTutorEvent } from '@/api/guards'
import type {
  EpisodesRequest,
  ErrorCode,
  GradeRequest,
  GradeResponse,
  PlanEvent,
  QuizRequest,
  QuizResponse,
  StreamEvent,
  TutorEvent,
  TutorRequest,
} from '@/types/contract'

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean

  constructor(code: ErrorCode, message: string, retryable: boolean) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.retryable = retryable
  }
}

export class ContractError extends Error {
  override name = 'ContractError'
}

export class StreamParseError extends Error {
  override name = 'StreamParseError'
}

export class StreamTimeoutError extends Error {
  override name = 'StreamTimeoutError'
}

export class RequestTimeoutError extends Error {
  override name = 'RequestTimeoutError'
}

// Above the backend's 50 s quiz and grade deadline, below Vercel's 60 s function limit.
export const REQUEST_TIMEOUT_MS = 55_000

export async function* readNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown, void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let settled = false
  try {
    for (;;) {
      const result = await reader.read().catch((error: unknown) => {
        settled = true
        throw error
      })
      if (result.done) {
        settled = true
        break
      }
      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() !== '') yield parseLine(line)
      }
    }
    buffer += decoder.decode()
    if (buffer.trim() !== '') yield parseLine(buffer)
  } finally {
    // An early exit (bad line, consumer stopped) cancels the body so the backend stops generating.
    if (!settled) await reader.cancel()
    reader.releaseLock()
  }
}

function parseLine(line: string): unknown {
  try {
    const value: unknown = JSON.parse(line)
    return value
  } catch (error) {
    if (error instanceof SyntaxError) throw new StreamParseError('Stream sent a line that is not JSON', { cause: error })
    throw error
  }
}

function checkOrder(plan: PlanEvent | null, event: StreamEvent): void {
  if (event.type === 'error') return
  if (event.type === 'plan') {
    if (plan !== null) throw new ContractError('Episode stream sent a second plan')
    return
  }
  if (plan === null) throw new ContractError('Episode stream sent an event before the plan')
  if (
    (event.type === 'scene' || event.type === 'episode_done') &&
    !plan.episodes.some((episode) => episode.index === event.episode)
  ) {
    throw new ContractError('Episode stream referenced an episode that is not in the plan')
  }
}

// Above the backend's 30 s LLM timeout, below Vercel's 60 s function limit.
export const STREAM_IDLE_MS = 45_000

async function* streamEvents<T extends { type: string }>(
  open: (signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>,
  guard: (value: unknown) => value is T,
  name: string,
  signal: AbortSignal,
  idleMs: number,
): AsyncGenerator<T> {
  const controller = new AbortController()
  const forwardAbort = () => {
    controller.abort()
  }
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', forwardAbort, { once: true })
  const idleTimeout = new StreamTimeoutError(`No stream event for ${String(idleMs)} ms`)
  let timer: ReturnType<typeof setTimeout> | undefined
  const restartIdleTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      controller.abort(idleTimeout)
    }, idleMs)
  }

  try {
    restartIdleTimer()
    const body = await open(controller.signal)
    for await (const value of readNdjson(body)) {
      restartIdleTimer()
      if (!guard(value)) throw new ContractError(`${name} sent an event that does not match the contract`)
      yield value
      if (value.type === 'done' || value.type === 'error') return
    }
    throw new ContractError(`${name} ended without a done or error event`)
  } catch (error) {
    if (controller.signal.reason === idleTimeout) throw idleTimeout
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', forwardAbort)
  }
}

export async function* streamEpisodes(
  request: EpisodesRequest,
  signal: AbortSignal,
  idleMs = STREAM_IDLE_MS,
): AsyncGenerator<StreamEvent> {
  const open = (inner: AbortSignal) =>
    USE_FIXTURES ? fixtureEpisodeStream(inner) : postForStream('/api/episodes/stream', request, inner)
  let plan: PlanEvent | null = null
  for await (const event of streamEvents(open, isStreamEvent, 'Episode stream', signal, idleMs)) {
    checkOrder(plan, event)
    if (event.type === 'plan') plan = event
    yield event
  }
}

export function streamTutor(request: TutorRequest, signal: AbortSignal, idleMs = STREAM_IDLE_MS): AsyncGenerator<TutorEvent> {
  const open = (inner: AbortSignal) => (USE_FIXTURES ? fixtureTutorStream(inner) : postForStream('/api/tutor', request, inner))
  return streamEvents(open, isTutorEvent, 'Tutor stream', signal, idleMs)
}

async function postForStream(path: string, payload: unknown, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) throw await errorFromResponse(response)
  if (response.body === null) throw new ContractError(`${path} answered without a body`)
  return response.body
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  const text = await response.text()
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorResponse(body)) return new ApiError(body.error.code, body.error.message, body.error.retryable)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  if (response.status === 429) return new ApiError('rate_limited', 'Too many requests, try again in a minute', true)
  return new ApiError('internal', `Server answered HTTP ${String(response.status)}`, response.status >= 500)
}

async function postJson<T>(
  path: string,
  payload: unknown,
  guard: (value: unknown) => value is T,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  const forwardAbort = () => {
    controller.abort()
  }
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', forwardAbort, { once: true })
  const timeout = new RequestTimeoutError(`${path} did not answer within ${String(timeoutMs)} ms`)
  const timer = setTimeout(() => {
    controller.abort(timeout)
  }, timeoutMs)
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) throw await errorFromResponse(response)
    const body: unknown = await response.json()
    if (!guard(body)) throw new ContractError(`${path} answered with a body that does not match the contract`)
    return body
  } catch (error) {
    if (controller.signal.reason === timeout) throw timeout
    if (error instanceof SyntaxError) throw new ContractError(`${path} answered with invalid JSON`, { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', forwardAbort)
  }
}

function parseFixture<T>(text: string, guard: (value: unknown) => value is T, name: string): T {
  const value: unknown = JSON.parse(text)
  if (!guard(value)) throw new ContractError(`Fixture ${name} does not match the contract`)
  return value
}

export async function fetchQuiz(
  request: QuizRequest,
  signal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<QuizResponse> {
  if (USE_FIXTURES) return parseFixture(await fixtureQuizText(), isQuizResponse, 'quiz.json')
  return postJson('/api/quiz', request, isQuizResponse, signal, timeoutMs)
}

export async function gradeOpenAnswer(
  request: GradeRequest,
  signal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<GradeResponse> {
  if (USE_FIXTURES) return parseFixture(await fixtureGradeText(), isGradeResponse, 'grade.json')
  return postJson('/api/quiz/grade', request, isGradeResponse, signal, timeoutMs)
}
