import { describe, expect, it } from 'vitest'
import { isErrorResponse, isStreamEvent } from '@/api/guards'
import { fixtureLines, fixtureScene } from '@/test/fixtureEvents'

const scene = fixtureScene('e0s0')

function sceneEventWith(patch: Record<string, unknown>): unknown {
  return { type: 'scene', episode: 0, index: 0, scene: { ...scene, ...patch } }
}

describe('isStreamEvent', () => {
  it('accepts every line of the fixture stream', () => {
    expect(fixtureLines.length).toBeGreaterThan(0)
    expect(fixtureLines.every(isStreamEvent)).toBe(true)
  })

  it('accepts a scene whose voice and picture failed', () => {
    expect(isStreamEvent(sceneEventWith({ audio: null, picture: null, words_estimated: true }))).toBe(true)
  })

  it.each([1, 2, 3])('accepts rank %i', (rank) => {
    expect(isStreamEvent(sceneEventWith({ rank }))).toBe(true)
  })

  it.each(['myth', 'fact'])('accepts verdict %s', (verdict) => {
    expect(isStreamEvent(sceneEventWith({ verdict }))).toBe(true)
  })

  it.each([
    ['an unknown reaction', { reaction: 'yawn' }],
    ['an unknown sfx', { sfx: 'airhorn' }],
    ['missing words', { words: undefined }],
    ['a string timing', { words: [{ text: 'мозг', start_ms: '100', end_ms: 200 }] }],
    ['a negative timing', { words: [{ text: 'мозг', start_ms: -1, end_ms: 200 }] }],
    ['a non-mpeg audio', { audio: { mime: 'audio/wav', base64: 'AAAA', duration_ms: 100 } }],
    ['a picture without url', { picture: { query: 'car', credit: 'x' } }],
    ['rank 4', { rank: 4 }],
    ['an unknown verdict', { verdict: 'maybe' }],
    ['an unknown speaker', { speaker: 'narrator' }],
    ['a missing nullable field', { formula: undefined }],
  ])('rejects a scene with %s', (_, patch) => {
    expect(isStreamEvent(sceneEventWith(patch))).toBe(false)
  })

  it.each([
    ['without a cast', { cast: undefined }],
    ['with an unknown character', { cast: { teacher: 'wizard', student: 'kid' } }],
    ['with a missing student', { cast: { teacher: 'professor' } }],
    ['with an unknown background', { background: 'lava' }],
    ['without a background', { background: undefined }],
  ])('rejects a plan episode %s', (_, patch) => {
    const episode = {
      index: 0,
      title: 'x',
      template: 'parkour_duo',
      scene_count: 3,
      cast: { teacher: 'robot', student: 'cat' },
      background: 'surf',
    }
    expect(isStreamEvent({ type: 'plan', course_title: 'x', language: 'ru', episodes: [episode] })).toBe(true)
    expect(
      isStreamEvent({ type: 'plan', course_title: 'x', language: 'ru', episodes: [{ ...episode, ...patch }] }),
    ).toBe(false)
  })

  it('rejects an unknown event type and a plan with an unknown template', () => {
    expect(isStreamEvent({ type: 'progress', percent: 50 })).toBe(false)
    expect(
      isStreamEvent({
        type: 'plan',
        course_title: 'x',
        language: 'ru',
        episodes: [{ index: 0, title: 'x', template: 'tiktok', scene_count: 3 }],
      }),
    ).toBe(false)
  })

  it('accepts an error event with a contract code only', () => {
    expect(isStreamEvent({ type: 'error', code: 'rate_limited', message: 'slow down', retryable: true })).toBe(true)
    expect(isStreamEvent({ type: 'error', code: 'teapot', message: 'x', retryable: true })).toBe(false)
  })
})

describe('isErrorResponse', () => {
  it('accepts the contract error body and rejects others', () => {
    expect(isErrorResponse({ error: { code: 'too_long', message: 'x', retryable: false } })).toBe(true)
    expect(isErrorResponse({ detail: 'Not Found' })).toBe(false)
  })
})
