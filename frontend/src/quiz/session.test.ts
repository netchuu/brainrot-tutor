import { describe, expect, it } from 'vitest'
import { initialQuizSession, isCorrect, quizScore, quizSessionReducer } from '@/quiz/session'
import { fixtureQuiz } from '@/test/fixtureEvents'
import type { OpenQuestion, SingleChoiceQuestion } from '@/types/contract'

const quiz = fixtureQuiz()
const choices = quiz.questions.filter((question): question is SingleChoiceQuestion => question.kind === 'single_choice')
const open = quiz.questions.find((question): question is OpenQuestion => question.kind === 'open')
if (choices[0] === undefined || choices[1] === undefined || open === undefined) throw new Error('quiz fixture changed')
const [first, second] = [choices[0], choices[1]]

describe('quizSessionReducer', () => {
  it('grades a single choice in the browser and locks the answer', () => {
    const answered = quizSessionReducer(initialQuizSession, { type: 'chose', question: first, selected: first.answer_index })
    expect(answered.answers[first.id]).toEqual({ kind: 'choice', selected: first.answer_index, correct: true })
    const again = quizSessionReducer(answered, { type: 'chose', question: first, selected: 0 })
    expect(again).toBe(answered)
  })

  it('records a wrong choice', () => {
    const wrong = (second.answer_index + 1) % 4
    const answered = quizSessionReducer(initialQuizSession, { type: 'chose', question: second, selected: wrong })
    expect(answered.answers[second.id]).toEqual({ kind: 'choice', selected: wrong, correct: false })
  })

  it('records a graded open answer once and moves on', () => {
    const grade = { correct: true, score: 0.8, feedback: 'Верно' }
    const graded = quizSessionReducer(initialQuizSession, { type: 'graded', question: open, text: 'ответ', grade })
    expect(graded.answers[open.id]).toEqual({ kind: 'open', text: 'ответ', grade })
    expect(quizSessionReducer(graded, { type: 'graded', question: open, text: 'другой', grade })).toBe(graded)
    expect(quizSessionReducer(graded, { type: 'next' }).position).toBe(1)
  })
})

describe('quizScore', () => {
  it('counts right choices and open answers graded correct', () => {
    let session = quizSessionReducer(initialQuizSession, { type: 'chose', question: first, selected: first.answer_index })
    session = quizSessionReducer(session, { type: 'chose', question: second, selected: (second.answer_index + 1) % 4 })
    session = quizSessionReducer(session, {
      type: 'graded',
      question: open,
      text: 'ответ',
      grade: { correct: true, score: 0.7, feedback: 'ok' },
    })
    expect(quizScore(quiz.questions, session.answers)).toEqual({ correct: 2, total: quiz.questions.length })
  })

  it('counts a skipped question as wrong and locks it', () => {
    const skipped = quizSessionReducer(initialQuizSession, { type: 'skipped', question: open })
    expect(skipped.answers[open.id]).toEqual({ kind: 'skipped' })
    expect(isCorrect({ kind: 'skipped' })).toBe(false)
    expect(quizSessionReducer(skipped, { type: 'skipped', question: open })).toBe(skipped)
  })

  it('treats an open answer below the threshold as wrong', () => {
    expect(isCorrect({ kind: 'open', text: 'x', grade: { correct: false, score: 0.4, feedback: 'нет' } })).toBe(false)
  })
})
