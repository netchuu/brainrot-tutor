import { describe, expect, it } from 'vitest'
import { cursorReducer, playbackStatus, reactionAtMs, sceneDurationMs, SILENT_TAIL_MS } from '@/player/usePlayback'
import { fixtureScene } from '@/test/fixtureEvents'

describe('sceneDurationMs', () => {
  it('uses the audio duration when voice exists', () => {
    expect(sceneDurationMs(fixtureScene('e0s0'))).toBe(6000)
  })

  it('runs from word timings plus a tail when voice failed', () => {
    expect(sceneDurationMs({ ...fixtureScene('e0s0'), audio: null })).toBe(5075 + SILENT_TAIL_MS)
  })
})

describe('reactionAtMs', () => {
  it('pops the reaction when the highlight word starts', () => {
    expect(reactionAtMs(fixtureScene('e0s2'))).toBe(525)
  })

  it('falls back to 40 % of the scene without a highlight', () => {
    expect(reactionAtMs({ ...fixtureScene('e0s0'), highlight: null })).toBe(2400)
  })
})

describe('playbackStatus', () => {
  it('plays an arrived scene, waits for a missing one and finishes when the episode is complete', () => {
    expect(playbackStatus(0, 1, false)).toBe('playing')
    expect(playbackStatus(1, 1, false)).toBe('waiting')
    expect(playbackStatus(4, 4, true)).toBe('finished')
  })

  it('finishes early when the episode ends with fewer scenes than planned', () => {
    expect(playbackStatus(3, 3, true)).toBe('finished')
  })

  it('waits for scene 0 before anything arrived', () => {
    expect(playbackStatus(0, 0, false)).toBe('waiting')
  })
})

describe('cursorReducer', () => {
  it('advances once per ended scene and ignores a stale end', () => {
    const first = cursorReducer({ position: 0, run: 0 }, { type: 'sceneEnded', from: 0 })
    expect(first).toEqual({ position: 1, run: 0 })
    expect(cursorReducer(first, { type: 'sceneEnded', from: 0 })).toBe(first)
  })

  it('replays from the first scene with a new run', () => {
    expect(cursorReducer({ position: 4, run: 0 }, { type: 'replay' })).toEqual({ position: 0, run: 1 })
  })
})
