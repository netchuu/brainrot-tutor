import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ContractError, StreamParseError, StreamTimeoutError } from '@/api/client'
import { initialStreamState, streamReducer, toFailure, useEpisodeStream } from '@/player/useEpisodeStream'
import { ru } from '@/strings'
import { FIXTURE_TEXT, fixtureEvents } from '@/test/fixtureEvents'
import type { EpisodesRequest } from '@/types/contract'

vi.mock('@/api/fixtures', async (importOriginal) => ({ ...(await importOriginal<object>()), USE_FIXTURES: false }))

const request: EpisodesRequest ={ source_text: 'x'.repeat(200), language: 'ru', episode_count: 3, template: null }

describe('streamReducer', () => {
  it('collects the whole fixture into episodes', () => {
    const plan = fixtureEvents.find((event) => event.type === 'plan')
    const done = fixtureEvents.find((event) => event.type === 'done')
    if (plan?.type !== 'plan' || done?.type !== 'done') throw new Error('fixture needs a plan and a done event')

    const state = fixtureEvents.reduce(
      (current, event) => streamReducer(current, { type: 'event', event }),
      streamReducer(initialStreamState, { type: 'started' }),
    )
    expect(state.status).toBe('done')
    expect(state.plan).toEqual(plan)
    expect(state.scenes.map((scenes) => scenes.length)).toEqual(plan.episodes.map((episode) => episode.scene_count))
    expect(state.scenes.flat().map((scene) => scene.id)).toEqual(
      fixtureEvents.flatMap((event) => (event.type === 'scene' ? [event.scene.id] : [])),
    )
    expect(state.episodeDone.every(Boolean)).toBe(true)
    expect(state.elapsedMs).toBe(done.elapsed_ms)
    expect(state.error).toBeNull()
  })

  it('records an error event as a failure', () => {
    const state = streamReducer(initialStreamState, {
      type: 'event',
      event: { type: 'error', code: 'llm_unavailable', message: 'Both providers failed', retryable: true },
    })
    expect(state.status).toBe('failed')
    expect(state.error).toEqual({ kind: 'llm_unavailable', message: ru.errors.llm_unavailable, retryable: true })
  })

  it('resets everything when a new stream starts', () => {
    const finished = fixtureEvents.reduce(
      (current, event) => streamReducer(current, { type: 'event', event }),
      initialStreamState,
    )
    expect(streamReducer(finished, { type: 'started' })).toEqual({ ...initialStreamState, status: 'streaming' })
  })
})

describe('toFailure', () => {
  it.each([
    [new ApiError('too_long', 'Text is too long', false), 'too_long', false],
    [new ApiError('rate_limited', 'slow down', true), 'rate_limited', true],
    [new StreamTimeoutError('silent'), 'timeout', true],
    [new ContractError('internal detail'), 'broken', true],
    [new StreamParseError('bad line'), 'broken', true],
    [new TypeError('Load failed'), 'network', true],
    [new RangeError('odd'), 'unknown', true],
  ] as const)('maps %s to a Russian %s message', (error, kind, retryable) => {
    expect(toFailure(error)).toEqual({ kind, message: ru.errors[kind], retryable })
  })
})

describe('useEpisodeStream', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams the response into state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(FIXTURE_TEXT))))
    const { result } = renderHook(() => useEpisodeStream())
    act(() => {
      result.current.start(request)
    })
    await waitFor(() => {
      expect(result.current.state.status).toBe('done')
    })
    expect(result.current.state.scenes.flat()).toHaveLength(
      fixtureEvents.filter((event) => event.type === 'scene').length,
    )
  })

  it('reports an ErrorResponse with its Russian message and stop resets the state', async () => {
    const body = JSON.stringify({ error: { code: 'bad_input', message: 'source_text: too short', retryable: false } })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 422 }))))
    const { result } = renderHook(() => useEpisodeStream())
    act(() => {
      result.current.start(request)
    })
    await waitFor(() => {
      expect(result.current.state.error).toEqual({ kind: 'bad_input', message: ru.errors.bad_input, retryable: false })
    })
    act(() => {
      result.current.stop()
    })
    expect(result.current.state).toEqual(initialStreamState)
  })

  it('fails as retryable when the stream ends without a terminal event', async () => {
    const firstLine = FIXTURE_TEXT.split('\n')[0] ?? ''
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`${firstLine}\n`))))
    const { result } = renderHook(() => useEpisodeStream())
    act(() => {
      result.current.start(request)
    })
    await waitFor(() => {
      expect(result.current.state.status).toBe('failed')
    })
    expect(result.current.state.error?.retryable).toBe(true)
  })

  it('aborts the previous stream on restart and on unmount', () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init: RequestInit) => {
        if (init.signal) signals.push(init.signal)
        return new Promise<Response>(() => undefined)
      }),
    )
    const { result, unmount } = renderHook(() => useEpisodeStream())
    act(() => {
      result.current.start(request)
    })
    act(() => {
      result.current.start(request)
    })
    return waitFor(() => {
      expect(signals).toHaveLength(2)
    }).then(() => {
      expect(signals[0]?.aborted).toBe(true)
      expect(signals[1]?.aborted).toBe(false)
      unmount()
      expect(signals[1]?.aborted).toBe(true)
    })
  })
})
