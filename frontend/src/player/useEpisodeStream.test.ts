import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ContractError } from '@/api/client'
import { initialStreamState, streamReducer, toFailure, useEpisodeStream } from '@/player/useEpisodeStream'
import { FIXTURE_TEXT, fixtureEvents } from '@/test/fixtureEvents'
import type { EpisodesRequest } from '@/types/contract'

const request: EpisodesRequest = { source_text: 'x'.repeat(200), language: 'ru', episode_count: 3, template: null }

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
    expect(state.error).toEqual({ code: 'llm_unavailable', message: 'Both providers failed', retryable: true })
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
  it('keeps the contract error code and hides raw messages of other errors', () => {
    expect(toFailure(new ApiError('too_long', 'Text is too long', false))).toEqual({
      code: 'too_long',
      message: 'Text is too long',
      retryable: false,
    })
    expect(toFailure(new ContractError('internal detail'))).toMatchObject({ code: 'internal', retryable: true })
    expect(toFailure(new TypeError('Load failed')).message).not.toContain('Load failed')
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

  it('awaits a request promise and reports its failure', async () => {
    const { result } = renderHook(() => useEpisodeStream())
    act(() => {
      result.current.start(Promise.reject(new ApiError('bad_input', 'Empty text', false)))
    })
    await waitFor(() => {
      expect(result.current.state.error).toEqual({ code: 'bad_input', message: 'Empty text', retryable: false })
    })
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
