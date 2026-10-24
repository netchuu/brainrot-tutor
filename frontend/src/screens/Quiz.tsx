import { useReducer } from 'react'
import { QuestionCard } from '@/quiz/QuestionCard'
import { initialQuizSession, quizScore, quizSessionReducer } from '@/quiz/session'
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '@/quiz/styles'
import type { QuizLoad } from '@/quiz/useQuizzes'
import { ru } from '@/strings'
import type { EpisodeOutline, Language, Question } from '@/types/contract'

interface QuizProps {
  episode: EpisodeOutline
  load: QuizLoad | undefined
  language: Language
  replayableSceneIds: ReadonlySet<string>
  onRetry: () => void
  onReplayScene: (sceneId: string) => void
  onRewatch: () => void
  onNext: (() => void) | null
  onAskTutor: () => void
  onExit: () => void
}

function Header({ title, progress, onExit }: { title: string; progress: string | null; onExit: () => void }) {
  return (
    <header className="flex items-start gap-3">
      <button
        type="button"
        aria-label={ru.feed.close}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg font-black active:scale-95"
        onClick={onExit}
      >
        ✕
      </button>
      <div className="min-w-0">
        <p className="truncate text-sm text-white/60">{title}</p>
        {progress !== null && <p className="text-sm font-bold text-accent">{progress}</p>}
      </div>
    </header>
  )
}

function Summary({
  questions,
  answers,
  onNext,
  onRewatch,
  onAskTutor,
  onExit,
}: {
  questions: readonly Question[]
  answers: Parameters<typeof quizScore>[1]
  onNext: (() => void) | null
  onRewatch: () => void
  onAskTutor: () => void
  onExit: () => void
}) {
  const { correct, total } = quizScore(questions, answers)
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <p className="text-6xl" aria-hidden>
        {correct === total ? '🔥' : correct * 2 >= total ? '👍' : '📚'}
      </p>
      <p className="text-3xl font-black">{ru.quiz.summary(correct, total)}</p>
      <div className="flex w-full flex-col gap-3">
        {onNext !== null ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={onNext}>
            {ru.feed.nextEpisode}
          </button>
        ) : (
          <button type="button" className={PRIMARY_BUTTON} onClick={onExit}>
            {ru.feed.newText}
          </button>
        )}
        <button type="button" className={SECONDARY_BUTTON} onClick={onAskTutor}>
          🧠 {ru.tutor.open}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onRewatch}>
          {ru.quiz.rewatch}
        </button>
      </div>
    </section>
  )
}

export function Quiz({
  episode,
  load,
  language,
  replayableSceneIds,
  onRetry,
  onReplayScene,
  onRewatch,
  onNext,
  onAskTutor,
  onExit,
}: QuizProps) {
  const [session, dispatch] = useReducer(quizSessionReducer, initialQuizSession)
  const questions = load?.status === 'ready' ? load.quiz.questions : []
  const question = questions[session.position]
  const answer = question === undefined ? undefined : session.answers[question.id]
  const progress =
    load?.status === 'ready' && question !== undefined ? ru.quiz.progress(session.position + 1, questions.length) : null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <Header title={episode.title} progress={progress} onExit={onExit} />

      {(load === undefined || load.status === 'loading') && (
        <p role="status" className="flex flex-1 items-center justify-center text-lg font-bold">
          🍳 {ru.quiz.loading}
        </p>
      )}

      {load?.status === 'failed' && (
        <section className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-xl font-black">{ru.stage.errorTitle}</p>
          <p className="text-white/80">{load.failure.message}</p>
          {load.failure.retryable && (
            <button type="button" className={PRIMARY_BUTTON} onClick={onRetry}>
              {ru.feed.retry}
            </button>
          )}
          <button type="button" className={SECONDARY_BUTTON} onClick={onNext ?? onExit}>
            {onNext !== null ? ru.feed.nextEpisode : ru.feed.newText}
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={onRewatch}>
            {ru.quiz.rewatch}
          </button>
        </section>
      )}

      {load?.status === 'ready' && question !== undefined && (
        <>
          <QuestionCard
            key={question.id}
            question={question}
            answer={answer}
            language={language}
            canReplay={question.scene_id !== null && replayableSceneIds.has(question.scene_id)}
            onChoose={(chosen, selected) => {
              dispatch({ type: 'chose', question: chosen, selected })
            }}
            onGraded={(graded, text, grade) => {
              dispatch({ type: 'graded', question: graded, text, grade })
            }}
            onSkip={(skipped) => {
              dispatch({ type: 'skipped', question: skipped })
            }}
            onReplay={() => {
              if (question.scene_id !== null) onReplayScene(question.scene_id)
            }}
          />
          {answer !== undefined && (
            <button
              type="button"
              className={PRIMARY_BUTTON}
              onClick={() => {
                dispatch({ type: 'next' })
              }}
            >
              {session.position + 1 < questions.length ? ru.quiz.next : ru.quiz.results}
            </button>
          )}
        </>
      )}

      {load?.status === 'ready' && question === undefined && (
        <Summary
          questions={questions}
          answers={session.answers}
          onNext={onNext}
          onRewatch={onRewatch}
          onAskTutor={onAskTutor}
          onExit={onExit}
        />
      )}
    </main>
  )
}
