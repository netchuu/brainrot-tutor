import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Tutor } from '@/screens/Tutor'
import { ru } from '@/strings'
import type { TutorState } from '@/tutor/useTutor'

const onAsk = vi.fn<(question: string) => void>()
const onRetry = vi.fn()
const onClose = vi.fn()

function renderTutor(state: TutorState) {
  return render(<Tutor state={state} onAsk={onAsk} onRetry={onRetry} onClose={onClose} />)
}

beforeEach(() => {
  onAsk.mockReset()
  onRetry.mockReset()
  onClose.mockReset()
})

describe('Tutor', () => {
  it('offers suggestions on an empty chat and sends one on tap', () => {
    renderTutor({ turns: [], status: 'idle', failure: null })
    fireEvent.click(screen.getByRole('button', { name: ru.tutor.suggestions[0] }))
    expect(onAsk).toHaveBeenCalledWith(ru.tutor.suggestions[0])
  })

  it('sends a typed question and clears the field', () => {
    renderTutor({ turns: [], status: 'idle', failure: null })
    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: 'Что такое карта?' } })
    fireEvent.click(screen.getByRole('button', { name: ru.tutor.send }))
    expect(onAsk).toHaveBeenCalledWith('Что такое карта?')
    expect(field).toHaveValue('')
  })

  it('shows typing while the answer streams and blocks sending', () => {
    renderTutor({
      turns: [
        { role: 'user', content: 'Вопрос', sources: [], complete: true },
        { role: 'assistant', content: '', sources: [], complete: false },
      ],
      status: 'streaming',
      failure: null,
    })
    expect(screen.getByText(ru.tutor.typing)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ещё вопрос' } })
    expect(screen.getByRole('button', { name: ru.tutor.send })).toBeDisabled()
  })

  it('lists the source quotes behind an answer', () => {
    renderTutor({
      turns: [
        { role: 'user', content: 'Вопрос', sources: [], complete: true },
        { role: 'assistant', content: 'Ответ', sources: ['Первая цитата', 'Вторая цитата'], complete: true },
      ],
      status: 'idle',
      failure: null,
    })
    expect(screen.getByText(ru.tutor.sources(2))).toBeInTheDocument()
    expect(screen.getByText('«Первая цитата»')).toBeInTheDocument()
  })

  it('shows a failure with retry, hides the empty unfinished answer and closes back', () => {
    renderTutor({
      turns: [
        { role: 'user', content: 'Вопрос', sources: [], complete: true },
        { role: 'assistant', content: '', sources: [], complete: false },
      ],
      status: 'failed',
      failure: { kind: 'timeout', message: ru.errors.timeout, retryable: true },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(ru.errors.timeout)
    expect(screen.queryByText(ru.tutor.typing)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: ru.tutor.back }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
