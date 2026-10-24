import type { GradeResponse, OpenQuestion, Question, SingleChoiceQuestion } from '@/types/contract'

export type QuizAnswer =
  | { kind: 'choice'; selected: number; correct: boolean }
  | { kind: 'open'; text: string; grade: GradeResponse }
  | { kind: 'skipped' }

export interface QuizSession {
  position: number
  answers: Readonly<Record<string, QuizAnswer>>
}

export type QuizSessionAction =
  | { type: 'chose'; question: SingleChoiceQuestion; selected: number }
  | { type: 'graded'; question: OpenQuestion; text: string; grade: GradeResponse }
  | { type: 'skipped'; question: Question }
  | { type: 'next' }

export const initialQuizSession: QuizSession = { position: 0, answers: {} }

export function quizSessionReducer(session: QuizSession, action: QuizSessionAction): QuizSession {
  switch (action.type) {
    case 'chose': {
      if (session.answers[action.question.id] !== undefined) return session
      const answer: QuizAnswer = {
        kind: 'choice',
        selected: action.selected,
        correct: action.selected === action.question.answer_index,
      }
      return { ...session, answers: { ...session.answers, [action.question.id]: answer } }
    }
    case 'graded': {
      if (session.answers[action.question.id] !== undefined) return session
      const answer: QuizAnswer = { kind: 'open', text: action.text, grade: action.grade }
      return { ...session, answers: { ...session.answers, [action.question.id]: answer } }
    }
    case 'skipped': {
      if (session.answers[action.question.id] !== undefined) return session
      const answer: QuizAnswer = { kind: 'skipped' }
      return { ...session, answers: { ...session.answers, [action.question.id]: answer } }
    }
    case 'next':
      return { ...session, position: session.position + 1 }
  }
}

export function isCorrect(answer: QuizAnswer): boolean {
  switch (answer.kind) {
    case 'choice':
      return answer.correct
    case 'open':
      return answer.grade.correct
    case 'skipped':
      return false
  }
}

export function quizScore(
  questions: readonly Question[],
  answers: Readonly<Record<string, QuizAnswer>>,
): { correct: number; total: number } {
  const correct = questions.filter((question) => {
    const answer = answers[question.id]
    return answer !== undefined && isCorrect(answer)
  }).length
  return { correct, total: questions.length }
}
