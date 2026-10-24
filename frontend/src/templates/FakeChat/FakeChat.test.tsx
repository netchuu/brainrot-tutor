import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FakeChat } from '@/templates/FakeChat/FakeChat'
import { highlightRange, revealedText, splitHighlight } from '@/templates/FakeChat/reveal'
import { fixtureEvents, fixtureScene, wordStart } from '@/test/fixtureEvents'
import type { EpisodeOutline, Scene } from '@/types/contract'

const plan = fixtureEvents[0]
if (plan?.type !== 'plan' || plan.episodes[2] === undefined) throw new Error('fixture must plan a third episode')
const episode: EpisodeOutline = plan.episodes[2]

function renderChat(scene: Scene, timeMs: number, history: Scene[] = []) {
  return render(<FakeChat episode={episode} scene={scene} sceneIndex={history.length} timeMs={timeMs} history={history} />)
}

describe('revealedText', () => {
  const scene = fixtureScene('e2s1')

  it('is empty before the first word and full after the last one', () => {
    expect(revealedText(scene.text, scene.words, -1)).toBe('')
    expect(revealedText(scene.text, scene.words, scene.words.length - 1)).toBe(scene.text)
  })

  it('keeps the punctuation that follows a spoken word', () => {
    expect(revealedText(scene.text, scene.words, 0)).toBe('Нельзя.')
    expect(revealedText(scene.text, scene.words, 2)).toBe('Нельзя. Слишком агрессивная')
  })
})

describe('highlightRange and splitHighlight', () => {
  const words = [
    { text: 'карта', start_ms: 0, end_ms: 100 },
    { text: 'и', start_ms: 100, end_ms: 200 },
    { text: 'кар', start_ms: 200, end_ms: 300 },
  ]

  it('marks the highlighted word itself, not a match inside an earlier word', () => {
    const range = highlightRange('Карта и кар.', words, 'кар')
    expect(range).toEqual([8, 11])
    expect(splitHighlight('Карта и кар.', range)).toEqual(['Карта и ', 'кар', '.'])
  })

  it('leaves text whole before the word is typed or without a highlight', () => {
    expect(splitHighlight('Карта и', highlightRange('Карта и кар.', words, 'кар'))).toEqual(['Карта и', '', ''])
    expect(splitHighlight('текст', highlightRange('текст', words, null))).toEqual(['текст', '', ''])
  })
})

describe('FakeChat', () => {
  it('names the cast in the header', () => {
    renderChat(fixtureScene('e2s0'), 0)
    expect(screen.getByText('Робот и Кот')).toBeInTheDocument()
  })

  it('shows typing dots before the first word, then types the line on the speaker side', () => {
    const scene = fixtureScene('e2s0')
    const { rerender } = renderChat(scene, 0)
    expect(screen.getByTestId('typing')).toBeInTheDocument()
    rerender(<FakeChat episode={episode} scene={scene} sceneIndex={0} timeMs={60_000} history={[]} />)
    expect(screen.getByTestId('current-message')).toHaveTextContent(scene.text)
    expect(screen.getByTestId('current-message').closest('[data-speaker]')).toHaveAttribute('data-speaker', 'student')
    expect(screen.getByText(scene.highlight ?? '')).toHaveClass('text-accent')
  })

  it('keeps earlier lines as bubbles and sends the picture as an image message', () => {
    const scene = fixtureScene('e2s1')
    renderChat(scene, 300, [fixtureScene('e2s0')])
    expect(screen.getByText(fixtureScene('e2s0').text)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: scene.picture?.query })).toBeInTheDocument()
  })

  it('replaces a picture that fails to load with the highlight card', () => {
    const scene = fixtureScene('e2s1')
    renderChat(scene, 300)
    fireEvent.error(screen.getByRole('img', { name: scene.picture?.query }))
    expect(screen.getByTestId('picture-fallback')).toHaveTextContent('детонации')
  })

  it('adds the reaction to the bubble when the highlight word is spoken', () => {
    const scene = fixtureScene('e2s1')
    const at = wordStart(scene, 'детонации')
    const { rerender } = renderChat(scene, at - 1)
    expect(screen.queryByTestId('chat-reaction')).not.toBeInTheDocument()
    rerender(<FakeChat episode={episode} scene={scene} sceneIndex={0} timeMs={at} history={[]} />)
    expect(screen.getByTestId('chat-reaction')).toHaveTextContent('😱')
  })
})
