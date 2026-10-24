import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readNdjson, StreamParseError } from '@/api/client'
import { QUIZ_TEXT } from '@/test/fixtureEvents'
import type { EpisodesRequest } from '@/types/contract'

const encoder = new TextEncoder()

const PLAN_LINE = JSON.stringify({
  type: 'plan',
  course_title: 'Course',
  language: 'ru',
  episodes: [
    {
      index: 0,
      title: 'Episode',
      template: 'parkour_duo',
      scene_count: 1,
      cast: { teacher: 'professor', student: 'kid' },
      background: 'parkour',
    },
  ],
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

  beforeEach(() => {
    vi.stubEnv('VITE_USE_FIXTURES', '0')
    vi.stubEnv('VITE_API_URL', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function respondWith(response: Response) {
    const fetchMock = vi.fn(() => Promise.resolve(response))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  async function load() {
    const client = await import('@/api/client')
    return { client, run: () => collect(client.streamEpisodes(request, new AbortController().signal)) }
  }

  it('posts the request and yields contract events', async () => {
    const fetchMock = respondWith(new Response(`${PLAN_LINE}\n${DONE_LINE}\n`))
    const { run } = await load()
    expect((await run()).map((event) => event.type)).toEqual(['plan', 'done'])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/episodes/stream',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    )
  })

  it('joins VITE_API_URL without a double slash', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/')
    const fetchMock = respondWith(new Response(`${PLAN_LINE}\n${DONE_LINE}\n`))
    const { run } = await load()
    await run()
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/episodes/stream', expect.anything())
  })

  it('stops at an error event', async () => {
    respondWith(new Response(`${PLAN_LINE}\n{"type":"error","code":"rate_limited","message":"x","retryable":true}\n`))
    const { run } = await load()
    expect((await run()).map((event) => event.type)).toEqual(['plan', 'error'])
  })

  it('turns an ErrorResponse into ApiError', async () => {
    const body = JSON.stringify({ error: { code: 'too_long', message: 'Text is too long', retryable: false } })
    respondWith(new Response(body, { status: 413 }))
    const { client, run } = await load()
    const failure = run()
    await expect(failure).rejects.toBeInstanceOf(client.ApiError)
    await expect(failure).rejects.toMatchObject({ code: 'too_long', retryable: false })
  })

  it('maps a non-contract 5xx body to a retryable internal error', async () => {
    respondWith(new Response('Bad Gateway', { status: 502 }))
    const { run } = await load()
    await expect(run()).rejects.toMatchObject({ code: 'internal', retryable: true })
  })

  it('maps a non-contract 429 to a retryable rate limit', async () => {
    respondWith(new Response('Too Many Requests', { status: 429 }))
    const { run } = await load()
    await expect(run()).rejects.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('throws ContractError on an event that breaks the schema', async () => {
    respondWith(new Response(`${PLAN_LINE}\n{"type":"scene"}\n`))
    const { client, run } = await load()
    await expect(run()).rejects.toBeInstanceOf(client.ContractError)
  })

  it('throws ContractError when the stream ends without done or error', async () => {
    respondWith(new Response(`${PLAN_LINE}\n{"type":"episode_done","episode":0}\n`))
    const { client, run } = await load()
    await expect(run()).rejects.toBeInstanceOf(client.ContractError)
  })

  it('fails with StreamTimeoutError when no event arrives within the idle limit', async () => {
    vi.useFakeTimers()
    let lastEventAt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                setTimeout(() => {
                  lastEventAt = Date.now()
                  controller.enqueue(encoder.encode(`${PLAN_LINE}\n`))
                }, 900)
                init?.signal?.addEventListener('abort', () => {
                  controller.error(new DOMException('aborted', 'AbortError'))
                })
              },
            }),
          ),
        ),
      ),
    )
    const { client } = await load()
    const startedAt = Date.now()
    const failure = collect(client.streamEpisodes(request, new AbortController().signal, 1000))
    const assertion = expect(failure).rejects.toBeInstanceOf(client.StreamTimeoutError)
    await vi.advanceTimersByTimeAsync(2000)
    await assertion
    expect(lastEventAt - startedAt).toBe(900)
  })

  it('posts the quiz request and returns the guarded quiz', async () => {
    const quiz: unknown = JSON.parse(QUIZ_TEXT)
    const fetchMock = respondWith(new Response(JSON.stringify(quiz), { headers: { 'Content-Type': 'application/json' } }))
    const { client } = await load()
    const quizRequest = {
      source_text: 'x'.repeat(300),
      language: 'ru' as const,
      question_count: 4,
      episode: { index: 0, title: 'Эпизод', scenes: [{ id: 'e0s0', text: 'Текст', source_quote: null }] },
    }
    expect(await client.fetchQuiz(quizRequest, new AbortController().signal)).toEqual(quiz)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/quiz',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(quizRequest) }),
    )
  })

  it('posts an open answer for grading and rejects a body that breaks the contract', async () => {
    const gradeRequest = {
      language: 'ru' as const,
      question: {
        id: 'q4',
        kind: 'open' as const,
        prompt: 'Что решает ЭБУ?',
        reference_answer: 'Сколько топлива впрыснуть',
        source_quote: 'По этим данным блок решает',
        scene_id: 'e0s2',
      },
      answer: 'Сколько топлива',
    }
    const fetchMock = respondWith(new Response('{"correct":true,"score":0.9,"feedback":"Верно"}'))
    const { client } = await load()
    expect(await client.gradeOpenAnswer(gradeRequest, new AbortController().signal)).toEqual({
      correct: true,
      score: 0.9,
      feedback: 'Верно',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/quiz/grade', expect.objectContaining({ body: JSON.stringify(gradeRequest) }))
    respondWith(new Response('{"correct":"maybe"}'))
    await expect(client.gradeOpenAnswer(gradeRequest, new AbortController().signal)).rejects.toBeInstanceOf(
      client.ContractError,
    )
    respondWith(new Response('<html>oops</html>'))
    await expect(client.gradeOpenAnswer(gradeRequest, new AbortController().signal)).rejects.toBeInstanceOf(
      client.ContractError,
    )
  })

  it('maps a quiz ErrorResponse to ApiError and times out a silent server', async () => {
    const body = JSON.stringify({ error: { code: 'llm_unavailable', message: 'down', retryable: true } })
    respondWith(new Response(body, { status: 503 }))
    const { client } = await load()
    const quizRequest = {
      source_text: 'x'.repeat(300),
      language: 'ru' as const,
      episode: { index: 0, title: 'Эпизод', scenes: [{ id: 'e0s0', text: 'Текст', source_quote: null }] },
    }
    await expect(client.fetchQuiz(quizRequest, new AbortController().signal)).rejects.toMatchObject({
      code: 'llm_unavailable',
      retryable: true,
    })

    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'))
            })
          }),
      ),
    )
    const pending = client.fetchQuiz(quizRequest, new AbortController().signal, 1000)
    const assertion = expect(pending).rejects.toBeInstanceOf(client.RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('streams tutor deltas and the closing quotes', async () => {
    const lines = [
      '{"type":"delta","text":"Ответ "}',
      '{"type":"delta","text":"из текста"}',
      '{"type":"done","source_quotes":["Цитата"]}',
    ]
    const fetchMock = respondWith(new Response(`${lines.join('\n')}\n`))
    const { client } = await load()
    const tutorRequest = {
      source_text: 'x'.repeat(300),
      language: 'ru' as const,
      messages: [{ role: 'user' as const, content: 'Вопрос' }],
    }
    const events = await collect(client.streamTutor(tutorRequest, new AbortController().signal))
    expect(events.map((event) => event.type)).toEqual(['delta', 'delta', 'done'])
    expect(fetchMock).toHaveBeenCalledWith('/api/tutor', expect.objectContaining({ body: JSON.stringify(tutorRequest) }))
    respondWith(new Response('{"type":"delta","text":"обрыв"}\n'))
    await expect(collect(client.streamTutor(tutorRequest, new AbortController().signal))).rejects.toBeInstanceOf(
      client.ContractError,
    )
  })

  it('throws ContractError on events before the plan or outside it', async () => {
    const { client, run } = await load()
    respondWith(new Response(`${DONE_LINE}\n`))
    await expect(run()).rejects.toBeInstanceOf(client.ContractError)
    respondWith(new Response(`${PLAN_LINE}\n{"type":"episode_done","episode":5}\n${DONE_LINE}\n`))
    await expect(run()).rejects.toBeInstanceOf(client.ContractError)
  })
})
