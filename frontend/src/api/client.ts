import { fixtureEpisodeStream, USE_FIXTURES } from '@/api/fixtures'
import { isErrorResponse, isStreamEvent } from '@/api/guards'
import type { EpisodesRequest, ErrorCode, PlanEvent, StreamEvent } from '@/types/contract'

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

export async function* streamEpisodes(request: EpisodesRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const body = USE_FIXTURES ? await fixtureEpisodeStream(signal) : await postForStream('/api/episodes/stream', request, signal)
  let plan: PlanEvent | null = null
  for await (const value of readNdjson(body)) {
    if (!isStreamEvent(value)) throw new ContractError('Episode stream sent an event that does not match the contract')
    checkOrder(plan, value)
    if (value.type === 'plan') plan = value
    yield value
    if (value.type === 'done' || value.type === 'error') return
  }
  throw new ContractError('Episode stream ended without a done or error event')
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
