import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FakeChat } from '@/templates/FakeChat/FakeChat'
import { revealedText, splitHighlight } from '@/templates/FakeChat/reveal'
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

describe('splitHighlight', () => {
  it('splits around the first occurrence and leaves text without it whole', () => {
    expect(splitHighlight('ведёт к детонации и', 'детонации')).toEqual(['ведёт к ', 'детонации', ' и'])
    expect(splitHighlight('без слова', 'детонации')).toEqual(['без слова', '', ''])
    expect(splitHighlight('текст', null)).toEqual(['текст', '', ''])
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

  it('adds the reaction to the bubble when the highlight word is spoken', () => {
    const scene = fixtureScene('e2s1')
    const at = wordStart(scene, 'детонации')
    const { rerender } = renderChat(scene, at - 1)
    expect(screen.queryByTestId('chat-reaction')).not.toBeInTheDocument()
    rerender(<FakeChat episode={episode} scene={scene} sceneIndex={0} timeMs={at} history={[]} />)
    expect(screen.getByTestId('chat-reaction')).toHaveTextContent('😱')
  })
})
