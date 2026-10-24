import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ContractError, readNdjson, StreamParseError, streamEpisodes } from '@/api/client'
import type { EpisodesRequest } from '@/types/contract'

const encoder = new TextEncoder()

const PLAN_LINE = JSON.stringify({
  type: 'plan',
  course_title: 'Course',
  language: 'ru',
  episodes: [{ index: 0, title: 'Episode', template: 'parkour_duo', scene_count: 1 }],
})
const DONE_LINE = '{"type":"done","elapsed_ms":5}'

function streamOf(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      controller.close()
    },
  })
}

function trackedStream(text: string) {
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
    },
    cancel,
  })
  return { stream, cancel }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iterable) items.push(item)
  return items
}

describe('readNdjson', () => {
  it('joins a line split across chunks', async () => {
    expect(await collect(readNdjson(streamOf('{"a":', '1}\n{"b"', ':2}\n')))).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('decodes a Cyrillic character split between chunks', async () => {
    const bytes = encoder.encode('{"t":"мозг"}\n')
    const cut = 7
    expect(await collect(readNdjson(streamOf(bytes.slice(0, cut), bytes.slice(cut))))).toEqual([{ t: 'мозг' }])
  })

  it('handles CRLF line endings and blank lines', async () => {
    expect(await collect(readNdjson(streamOf('{"a":1}\r\n\r\n\n{"b":2}\r\n')))).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('flushes a last line without a trailing newline', async () => {
    expect(await collect(readNdjson(streamOf('{"a":1}\n{"b":2}')))).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('throws StreamParseError with the cause on a line that is not JSON', async () => {
    const failure = collect(readNdjson(streamOf('{"a":1}\nnot json\n')))
    await expect(failure).rejects.toBeInstanceOf(StreamParseError)
    await expect(failure).rejects.toHaveProperty('cause')
  })

  it('cancels the stream when a line is not JSON', async () => {
    const { stream, cancel } = trackedStream('not json\n')
    await expect(collect(readNdjson(stream))).rejects.toBeInstanceOf(StreamParseError)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels the stream when the consumer stops early', async () => {
    const { stream, cancel } = trackedStream('{"a":1}\n{"b":2}\n')
    for await (const value of readNdjson(stream)) {
      expect(value).toEqual({ a: 1 })
      break
    }
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not cancel a stream that ended normally', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"a":1}\n'))
        controller.close()
      },
      cancel,
    })
    await collect(readNdjson(stream))
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('streamEpisodes', () => {
  const request: EpisodesRequest = { source_text: 'x'.repeat(200), language: 'ru', episode_count: 1, template: null }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function respondWith(response: Response) {
    const fetchMock = vi.fn(() => Promise.resolve(response))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function run() {
    return collect(streamEpisodes(request, new AbortController().signal))
  }

  it('posts the request and yields contract events', async () => {
    const fetchMock = respondWith(new Response(`${PLAN_LINE}\n${DONE_LINE}\n`))
    const events = await run()
    expect(events.map((event) => event.type)).toEqual(['plan', 'done'])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/episodes/stream',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    )
  })

  it('stops at an error event', async () => {
    respondWith(new Response(`${PLAN_LINE}\n{"type":"error","code":"rate_limited","message":"x","retryable":true}\n`))
    expect((await run()).map((event) => event.type)).toEqual(['plan', 'error'])
  })

  it('turns an ErrorResponse into ApiError', async () => {
    const body = JSON.stringify({ error: { code: 'too_long', message: 'Text is too long', retryable: false } })
    respondWith(new Response(body, { status: 413 }))
    const failure = run()
    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({ code: 'too_long', retryable: false })
  })

  it('maps a non-contract 5xx body to a retryable internal error', async () => {
    respondWith(new Response('Bad Gateway', { status: 502 }))
    await expect(run()).rejects.toMatchObject({ code: 'internal', retryable: true })
  })

  it('maps a non-contract 429 to a retryable rate limit', async () => {
    respondWith(new Response('Too Many Requests', { status: 429 }))
    await expect(run()).rejects.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('throws ContractError on an event that breaks the schema', async () => {
    respondWith(new Response(`${PLAN_LINE}\n{"type":"scene"}\n`))
    await expect(run()).rejects.toBeInstanceOf(ContractError)
  })

  it('throws ContractError when the stream ends without done or error', async () => {
    respondWith(new Response(`${PLAN_LINE}\n{"type":"episode_done","episode":0}\n`))
    await expect(run()).rejects.toBeInstanceOf(ContractError)
  })

  it('throws ContractError on events before the plan or outside it', async () => {
    respondWith(new Response(`${DONE_LINE}\n`))
    await expect(run()).rejects.toBeInstanceOf(ContractError)
    respondWith(new Response(`${PLAN_LINE}\n{"type":"episode_done","episode":5}\n${DONE_LINE}\n`))
    await expect(run()).rejects.toBeInstanceOf(ContractError)
  })
})
