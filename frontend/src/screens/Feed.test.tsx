import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialStreamState, streamReducer } from '@/player/useEpisodeStream'
import type { StreamFailure, StreamState } from '@/player/useEpisodeStream'
import { Feed } from '@/screens/Feed'
import { ru } from '@/strings'
import { fixtureEvents } from '@/test/fixtureEvents'
import type { EpisodeOutline, Scene } from '@/types/contract'

interface StageStubProps {
  episode: EpisodeOutline
  scenes: readonly Scene[]
  complete: boolean
  waitingTitle?: string
  waitingCaption?: string
  endActions: (replay: () => void) => ReactNode
  children?: ReactNode
}

vi.mock('@/player/Stage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Stage: ({ episode, scenes, complete, waitingTitle, waitingCaption, endActions, children }: StageStubProps) => (
    <div data-testid="stage" data-episode={episode.index} data-scenes={scenes.length} data-complete={complete}>
      {waitingTitle}
      {waitingCaption}
      {endActions(() => undefined)}
      {children}
    </div>
  ),
}))

const onRetry = vi.fn()
const onExit = vi.fn()

function streamed(count: number): StreamState {
  return fixtureEvents
    .slice(0, count)
    .reduce(
      (state, event) => streamReducer(state, { type: 'event', event }),
      streamReducer(initialStreamState, { type: 'started' }),
    )
}

function failed(state: StreamState, retryable: boolean): StreamState {
  const error: StreamFailure = { kind: 'llm_unavailable', message: ru.errors.llm_unavailable, retryable }
  return streamReducer(state, { type: 'failed', error })
}

function renderFeed(state: StreamState) {
  return render(<Feed state={state} onRetry={onRetry} onExit={onExit} />)
}

beforeEach(() => {
  onRetry.mockReset()
  onExit.mockReset()
})

describe('Feed', () => {
  it('says the script is being written before the plan and closes on ✕', () => {
    renderFeed(streamed(0))
    expect(screen.getByText(ru.feed.writingScript)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.close }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('shows the course title while the first scene is being voiced', () => {
    renderFeed(streamed(1))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-scenes', '0')
    expect(screen.getByText(/Чип-тюнинг ЭБУ за 3 минуты/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(ru.feed.voicingFirst))).toBeInTheDocument()
  })

  it('shows a full error card with retry when nothing is playable', () => {
    renderFeed(failed(streamed(1), true))
    expect(screen.getByText(ru.errors.llm_unavailable)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.editText }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('hides retry for an error that is not retryable', () => {
    renderFeed(failed(streamed(0), false))
    expect(screen.queryByRole('button', { name: ru.feed.retry })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: ru.feed.editText })).toBeInTheDocument()
  })

  it('shows an error card instead of an empty episode once the stream has ended', () => {
    const ended = streamReducer(streamed(1), { type: 'event', event: { type: 'done', elapsed_ms: 10 } })
    renderFeed(ended)
    expect(screen.queryByTestId('stage')).not.toBeInTheDocument()
    expect(screen.getByText(ru.errors.broken)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('keeps playing arrived scenes and shows a banner when the stream fails later', () => {
    renderFeed(failed(streamed(3), true))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-scenes', '2')
    expect(screen.getByTestId('stage')).toHaveAttribute('data-complete', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(ru.errors.llm_unavailable)
    fireEvent.click(screen.getByRole('button', { name: ru.feed.retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('moves to the next episode and offers a new text after the last one', () => {
    renderFeed(streamed(fixtureEvents.length))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '0')
    fireEvent.click(screen.getByRole('button', { name: ru.feed.nextEpisode }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '1')
    fireEvent.click(screen.getByRole('button', { name: ru.feed.nextEpisode }))
    expect(screen.getByTestId('stage')).toHaveAttribute('data-episode', '2')
    expect(screen.queryByRole('button', { name: ru.feed.nextEpisode })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: ru.feed.newText }))
    expect(onExit).toHaveBeenCalledOnce()
  })
})
