import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sceneDurationMs, usePlayback } from '@/player/usePlayback'
import { fixtureScene } from '@/test/fixtureEvents'
import type { Scene } from '@/types/contract'

const media = vi.hoisted(() => {
  let element: HTMLAudioElement | null = null
  return {
    get element(): HTMLAudioElement {
      element ??= document.createElement('audio')
      return element
    },
    reset() {
      element = null
    },
  }
})

vi.mock('@/player/audioOutput', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  audioOutput: () => ({ element: media.element, context: { resume: () => Promise.resolve() } }),
}))

vi.mock('@/player/sfx', () => ({ playSfx: vi.fn() }))

const play = vi.fn<() => Promise<void>>()
const revoke = vi.fn<(url: string) => void>()
let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
let now = 1000
let urlCount = 0

function runFrame() {
  const pending = [...frames.values()]
  frames = new Map()
  act(() => {
    for (const callback of pending) callback(now)
  })
}

function endAudio() {
  act(() => {
    media.element.dispatchEvent(new Event('ended'))
  })
}

beforeEach(() => {
  media.reset()
  const element = media.element
  Object.defineProperty(element, 'currentTime', { value: 0, writable: true })
  element.play = play
  element.pause = vi.fn()
  play.mockReset()
  play.mockResolvedValue(undefined)
  revoke.mockReset()
  frames = new Map()
  nextFrame = 0
  now = 1000
  urlCount = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame += 1
    frames.set(nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => {
      urlCount += 1
      return `blob:test/${String(urlCount)}`
    },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('usePlayback', () => {
  it('plays the scene audio, follows its clock and advances on ended', () => {
    const scenes = [fixtureScene('e0s0'), fixtureScene('e0s1')]
    const { result } = renderHook(() => usePlayback(scenes, true))
    expect(result.current.status).toBe('playing')
    expect(media.element.src).toBe('blob:test/1')
    expect(play).toHaveBeenCalledOnce()

    media.element.currentTime = 1.5
    runFrame()
    expect(result.current.timeMs).toBe(1500)

    endAudio()
    expect(result.current.scene?.id).toBe('e0s1')
    expect(media.element.src).toBe('blob:test/2')
    expect(result.current.timeMs).toBe(0)
  })

  it('holds the last frame while the next scene is cooking and resumes when it arrives', () => {
    const first = [fixtureScene('e0s0')]
    const { result, rerender } = renderHook(
      ({ scenes, complete }: { scenes: Scene[]; complete: boolean }) => usePlayback(scenes, complete),
      { initialProps: { scenes: first, complete: false } },
    )
    endAudio()
    expect(result.current.status).toBe('waiting')
    expect(result.current.scene?.id).toBe('e0s0')
    expect(result.current.timeMs).toBe(sceneDurationMs(fixtureScene('e0s0')))

    rerender({ scenes: [...first, fixtureScene('e0s1')], complete: false })
    expect(result.current.status).toBe('playing')
    expect(result.current.scene?.id).toBe('e0s1')
  })

  it('finishes after the last scene and replays from the start', () => {
    const scenes = [fixtureScene('e0s0')]
    const { result } = renderHook(() => usePlayback(scenes, true))
    endAudio()
    expect(result.current.status).toBe('finished')
    act(() => {
      result.current.replay()
    })
    expect(result.current.status).toBe('playing')
    expect(result.current.scene?.id).toBe('e0s0')
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('asks for a tap when the browser blocks playback', async () => {
    play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
    const scenes = [fixtureScene('e0s0')]
    const { result } = renderHook(() => usePlayback(scenes, true))
    await waitFor(() => {
      expect(result.current.needsTap).toBe(true)
    })
    act(() => {
      result.current.resumeSound()
    })
    expect(result.current.needsTap).toBe(false)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('runs the clock from word timings when the scene has no voice', () => {
    const silent: Scene = { ...fixtureScene('e0s0'), audio: null }
    const scenes = [silent]
    const { result } = renderHook(() => usePlayback(scenes, true))
    expect(play).not.toHaveBeenCalled()

    now = 1000 + 2000
    runFrame()
    expect(result.current.timeMs).toBe(2000)

    now = 1000 + sceneDurationMs(silent)
    runFrame()
    expect(result.current.status).toBe('finished')
  })

  it('switches to the timer clock when the audio element fails', () => {
    const scenes = [fixtureScene('e0s0')]
    const { result } = renderHook(() => usePlayback(scenes, true))
    now = 5000
    act(() => {
      media.element.dispatchEvent(new Event('error'))
    })
    now = 5000 + 1200
    runFrame()
    expect(result.current.timeMs).toBe(1200)
  })

  it('plays a scene with corrupt base64 on its word timings instead of crashing', () => {
    const broken: Scene = { ...fixtureScene('e0s0'), audio: { mime: 'audio/mpeg', base64: '%%%', duration_ms: 1000 } }
    const scenes = [broken]
    const { result } = renderHook(() => usePlayback(scenes, true))
    expect(result.current.status).toBe('playing')
    expect(play).not.toHaveBeenCalled()
    now = 1000 + 500
    runFrame()
    expect(result.current.timeMs).toBe(500)
  })

  it('revokes the scene audio URLs on unmount', () => {
    const scenes = [fixtureScene('e0s0'), fixtureScene('e0s1')]
    const { unmount } = renderHook(() => usePlayback(scenes, true))
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:test/1')
    expect(revoke).toHaveBeenCalledWith('blob:test/2')
  })
})
