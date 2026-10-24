import { useEffect, useRef, useState } from 'react'
import { gradeOpenAnswer } from '@/api/client'
import { toFailure } from '@/api/failure'
import type { Failure } from '@/api/failure'
import { isCorrect } from '@/quiz/session'
import type { QuizAnswer } from '@/quiz/session'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/quiz/styles'
import { ru } from '@/strings'
import type { GradeResponse, Language, OpenQuestion, Question, SingleChoiceQuestion } from '@/types/contract'

const MAX_ANSWER_CHARS = 1000

function SourceQuote({ quote }: { quote: string }) {
  return (
    <figure className="rounded-2xl bg-white/5 p-4">
      <figcaption className="text-xs font-bold tracking-wide text-white/50 uppercase">{ru.quiz.fromText}</figcaption>
      <blockquote className="mt-1 text-sm leading-relaxed text-white/85">«{quote}»</blockquote>
    </figure>
  )
}

function optionClass(index: number, question: SingleChoiceQuestion, answer: QuizAnswer | undefined): string {
  const base = 'w-full rounded-2xl px-4 py-3 text-left text-base font-semibold transition-colors'
  if (answer?.kind !== 'choice') return `${base} bg-white/10 active:bg-white/20`
  if (index === question.answer_index) return `${base} bg-emerald-600 text-white`
  if (index === answer.selected) return `${base} bg-red-600 text-white`
  return `${base} bg-white/5 text-white/50`
}

function ChoiceOptions({
  question,
  answer,
  onChoose,
}: {
  question: SingleChoiceQuestion
  answer: QuizAnswer | undefined
  onChoose: (selected: number) => void
}) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={question.prompt}>
      {question.options.map((option, index) => (
        <button
          key={`${String(index)}-${option}`}
          type="button"
          disabled={answer !== undefined}
          aria-pressed={answer?.kind === 'choice' && answer.selected === index}
          className={optionClass(index, question, answer)}
          onClick={() => {
            onChoose(index)
          }}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

type GradeStatus = { kind: 'idle' } | { kind: 'grading' } | { kind: 'failed'; failure: Failure }

function OpenAnswerForm({
  question,
  answer,
  language,
  onGraded,
  onSkip,
}: {
  question: OpenQuestion
  answer: QuizAnswer | undefined
  language: Language
  onGraded: (text: string, grade: GradeResponse) => void
  onSkip: () => void
}) {
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<GradeStatus>({ kind: 'idle' })
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  if (answer?.kind === 'open') {
    return <p className="rounded-2xl bg-white/10 p-4 text-base whitespace-pre-wrap">{answer.text}</p>
  }
  if (answer !== undefined) return null

  const text = draft.trim()
  const submit = () => {
    if (text === '' || status.kind === 'grading') return
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setStatus({ kind: 'grading' })
    gradeOpenAnswer({ language, question, answer: text }, current.signal).then(
      (grade) => {
        if (current.signal.aborted) return
        setStatus({ kind: 'idle' })
        onGraded(text, grade)
      },
      (error: unknown) => {
        if (current.signal.aborted) return
        const failure = toFailure(error)
        setStatus({ kind: 'failed', failure })
        if (failure.kind === 'unknown') throw error
      },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={draft}
        maxLength={MAX_ANSWER_CHARS}
        disabled={status.kind === 'grading'}
        placeholder={ru.quiz.answerPlaceholder}
        aria-label={ru.quiz.answerPlaceholder}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        className="min-h-32 resize-none rounded-2xl bg-white/10 p-4 text-base text-white placeholder:text-white/40 focus:ring-2 focus:ring-accent focus:outline-none"
      />
      {status.kind === 'failed' && (
        <p role="alert" className="text-sm text-red-300">
          {status.failure.message}
        </p>
      )}
      <button type="button" className={PRIMARY_BUTTON} disabled={text === '' || status.kind === 'grading'} onClick={submit}>
        {status.kind === 'grading' ? ru.quiz.checking : ru.quiz.check}
      </button>
      {status.kind === 'failed' && (
        <button type="button" className={SECONDARY_BUTTON} onClick={onSkip}>
          {ru.quiz.skip}
        </button>
      )}
    </div>
  )
}

function Verdict({
  question,
  answer,
  canReplay,
  onReplay,
}: {
  question: Question
  answer: QuizAnswer
  canReplay: boolean
  onReplay: () => void
}) {
  const correct = isCorrect(answer)
  const label = answer.kind === 'skipped' ? ru.quiz.skipped : correct ? ru.quiz.correct : ru.quiz.wrong
  return (
    <div className="flex flex-col gap-3" data-testid="verdict">
      <p className={`text-lg font-black ${correct ? 'text-emerald-400' : 'text-amber-300'}`}>{label}</p>
      {question.kind === 'single_choice' && <p className="text-base leading-relaxed">{question.explanation}</p>}
      {question.kind === 'open' && answer.kind === 'skipped' && (
        <div className="rounded-2xl bg-white/5 p-4">
          <p className="text-xs font-bold tracking-wide text-white/50 uppercase">{ru.quiz.reference}</p>
          <p className="mt-1 text-sm leading-relaxed text-white/85">{question.reference_answer}</p>
        </div>
      )}
      {question.kind === 'open' && answer.kind === 'open' && (
        <>
          <p className="text-base leading-relaxed">{answer.grade.feedback}</p>
          <p className="text-sm text-white/60">{ru.quiz.scorePercent(answer.grade.score)}</p>
          <div className="rounded-2xl bg-white/5 p-4">
            <p className="text-xs font-bold tracking-wide text-white/50 uppercase">{ru.quiz.reference}</p>
            <p className="mt-1 text-sm leading-relaxed text-white/85">{question.reference_answer}</p>
          </div>
        </>
      )}
      <SourceQuote quote={question.source_quote} />
      {!correct && canReplay && (
        <button type="button" className={SECONDARY_BUTTON} onClick={onReplay}>
          ▶ {ru.quiz.replayScene}
        </button>
      )}
    </div>
  )
}

interface QuestionCardProps {
  question: Question
  answer: QuizAnswer | undefined
  language: Language
  canReplay: boolean
  onChoose: (question: SingleChoiceQuestion, selected: number) => void
  onGraded: (question: OpenQuestion, text: string, grade: GradeResponse) => void
  onSkip: (question: Question) => void
  onReplay: () => void
}

export function QuestionCard({
  question,
  answer,
  language,
  canReplay,
  onChoose,
  onGraded,
  onSkip,
  onReplay,
}: QuestionCardProps) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl leading-snug font-black">{question.prompt}</h2>
      {question.kind === 'single_choice' ? (
        <ChoiceOptions
          question={question}
          answer={answer}
          onChoose={(selected) => {
            onChoose(question, selected)
          }}
        />
      ) : (
        <OpenAnswerForm
          question={question}
          answer={answer}
          language={language}
          onGraded={(text, grade) => {
            onGraded(question, text, grade)
          }}
          onSkip={() => {
            onSkip(question)
          }}
        />
      )}
      {answer !== undefined && <Verdict question={question} answer={answer} canReplay={canReplay} onReplay={onReplay} />}
    </section>
  )
}
