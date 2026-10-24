import { useEffect, useRef, useState } from 'react'
import { ru } from '@/strings'
import { MAX_MESSAGE_CHARS } from '@/tutor/useTutor'
import type { TutorState, TutorTurn } from '@/tutor/useTutor'

function Sources({ quotes }: { quotes: string[] }) {
  if (quotes.length === 0) return null
  return (
    <details className="mt-2 rounded-xl bg-black/20 p-3 text-sm" data-testid="sources">
      <summary className="cursor-pointer font-bold text-white/80">{ru.tutor.sources(quotes.length)}</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {quotes.map((quote) => (
          <li key={quote} className="leading-relaxed text-white/80">
            «{quote}»
          </li>
        ))}
      </ul>
    </details>
  )
}

function Bubble({ turn, typing }: { turn: TutorTurn; typing: boolean }) {
  if (turn.role === 'user') {
    return (
      <div className="ml-10 self-end rounded-2xl rounded-br-md bg-sky-600 px-4 py-3 text-base whitespace-pre-wrap">
        {turn.content}
      </div>
    )
  }
  return (
    <div className="mr-6 self-start rounded-2xl rounded-bl-md bg-white/10 px-4 py-3 text-base">
      {turn.content === '' && typing ? (
        <span className="animate-pulse text-white/60">{ru.tutor.typing}</span>
      ) : (
        <p className="leading-relaxed whitespace-pre-wrap">{turn.content}</p>
      )}
      <Sources quotes={turn.sources} />
    </div>
  )
}

interface TutorProps {
  state: TutorState
  onAsk: (question: string) => void
  onRetry: () => void
  onClose: () => void
}

export function Tutor({ state, onAsk, onRetry, onClose }: TutorProps) {
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const streaming = state.status === 'streaming'
  const lastContent = state.turns.at(-1)?.content ?? ''

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [state.turns.length, lastContent])

  const send = (question: string) => {
    if (question.trim() === '' || streaming) return
    onAsk(question)
    setDraft('')
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 pt-5 pb-3">
        <button
          type="button"
          aria-label={ru.tutor.back}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg font-black active:scale-95"
          onClick={onClose}
        >
          ←
        </button>
        <div>
          <h1 className="text-lg font-black">🧠 {ru.tutor.title}</h1>
          <p className="text-xs text-white/60">{ru.tutor.subtitle}</p>
        </div>
      </header>

      <div ref={list} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {state.turns.length === 0 && (
          <div className="mt-auto flex flex-wrap gap-2">
            {ru.tutor.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold active:scale-95"
                onClick={() => {
                  send(suggestion)
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {state.turns.map((turn, index) => {
          const last = index === state.turns.length - 1
          if (turn.role === 'assistant' && !turn.complete && turn.content === '' && !(streaming && last)) return null
          return <Bubble key={index} turn={turn} typing={streaming && last} />
        })}
        {state.status === 'failed' && state.failure !== null && (
          <div role="alert" className="flex items-center gap-3 rounded-2xl bg-red-600/80 px-4 py-3 text-sm font-semibold">
            <span className="flex-1">{state.failure.message}</span>
            {state.failure.retryable && (
              <button type="button" className="rounded-full bg-white px-3 py-1 text-black" onClick={onRetry}>
                {ru.feed.retry}
              </button>
            )}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t border-white/10 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(event) => {
          event.preventDefault()
          send(draft)
        }}
      >
        <textarea
          value={draft}
          rows={1}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={ru.tutor.placeholder}
          aria-label={ru.tutor.placeholder}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send(draft)
            }
          }}
          className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl bg-white/10 px-4 py-3 text-base text-white placeholder:text-white/40 focus:ring-2 focus:ring-accent focus:outline-none"
        />
        <button
          type="submit"
          aria-label={ru.tutor.send}
          disabled={draft.trim() === '' || streaming}
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-black text-black shadow-xl active:scale-95 disabled:opacity-40"
        >
          ➤
        </button>
      </form>
    </main>
  )
}
