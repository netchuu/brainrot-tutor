import { describe, expect, it } from 'vitest'
import { isErrorResponse, isGradeResponse, isQuizResponse, isStreamEvent, isTutorEvent } from '@/api/guards'
import gradeText from '../../../contracts/fixtures/grade.json?raw'
import tutorText from '../../../contracts/fixtures/tutor-stream.ndjson?raw'
import { fixtureLines, fixtureQuiz, fixtureQuizValue, fixtureScene } from '@/test/fixtureEvents'

const GRADE_TEXT = gradeText
const TUTOR_TEXT = tutorText

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

describe('isQuizResponse', () => {
  const quiz = fixtureQuiz()
  const [choice, , , open] = quiz.questions

  function withQuestion(question: unknown): unknown {
    return { ...quiz, questions: [question, ...quiz.questions.slice(1)] }
  }

  it('accepts the quiz fixture', () => {
    expect(isQuizResponse(fixtureQuizValue)).toBe(true)
  })

  it('rejects fewer than 3 or more than 5 questions and duplicate ids', () => {
    expect(isQuizResponse({ ...quiz, questions: quiz.questions.slice(0, 2) })).toBe(false)
    expect(isQuizResponse({ ...quiz, questions: [...quiz.questions, { ...choice, id: 'q5' }, { ...choice, id: 'q6' }] })).toBe(
      false,
    )
    expect(isQuizResponse({ ...quiz, questions: [choice, choice, open] })).toBe(false)
  })

  it.each([
    ['three options', { ...choice, options: ['a', 'b', 'c'] }],
    ['answer_index 4', { ...choice, answer_index: 4 }],
    ['a non-integer answer_index', { ...choice, answer_index: 1.5 }],
    ['an open question without reference_answer', { ...open, reference_answer: undefined }],
    ['an unknown kind', { ...choice, kind: 'multiple_choice' }],
    ['a numeric scene_id', { ...choice, scene_id: 3 }],
  ])('rejects %s', (_, question) => {
    expect(isQuizResponse(withQuestion(question))).toBe(false)
  })
})

describe('isGradeResponse', () => {
  it('accepts the grade fixture and the contract body, and rejects others', () => {
    expect(isGradeResponse(JSON.parse(GRADE_TEXT))).toBe(true)
    expect(isGradeResponse({ correct: true, score: 0.8, feedback: 'Верно' })).toBe(true)
    expect(isGradeResponse({ correct: 'yes', score: 0.8, feedback: 'Верно' })).toBe(false)
    expect(isGradeResponse({ correct: true, score: Number.NaN, feedback: 'Верно' })).toBe(false)
    expect(isGradeResponse({ correct: true, score: 1.5, feedback: 'Верно' })).toBe(false)
    expect(isGradeResponse({ correct: false, score: -0.1, feedback: 'Нет' })).toBe(false)
    expect(isGradeResponse({ correct: true, score: 0.8 })).toBe(false)
  })
})

describe('isTutorEvent', () => {
  it('accepts every line of the tutor fixture', () => {
    const lines = TUTOR_TEXT.split('\n').filter((line) => line.trim() !== '')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((line) => isTutorEvent(JSON.parse(line)))).toBe(true)
  })

  it('accepts an error event and rejects other shapes', () => {
    expect(isTutorEvent({ type: 'error', code: 'llm_unavailable', message: 'x', retryable: true })).toBe(true)
    expect(isTutorEvent({ type: 'delta', text: 5 })).toBe(false)
    expect(isTutorEvent({ type: 'done', source_quotes: [1] })).toBe(false)
    expect(isTutorEvent({ type: 'plan' })).toBe(false)
  })
})
