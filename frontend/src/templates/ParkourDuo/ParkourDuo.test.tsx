import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CHARACTER_EMOJI } from '@/assets'
import { ParkourDuo } from '@/templates/ParkourDuo/ParkourDuo'
import { fixtureEvents, fixtureScene, wordStart } from '@/test/fixtureEvents'
import type { EpisodeOutline, Scene } from '@/types/contract'

const plan = fixtureEvents[0]
if (plan?.type !== 'plan' || plan.episodes[0] === undefined) throw new Error('fixture must start with a plan')
const episode: EpisodeOutline = plan.episodes[0]
const brainAt = wordStart(fixtureScene('e0s0'), 'мозг')

function renderScene(scene: Scene, timeMs: number) {
  return render(<ParkourDuo episode={episode} scene={scene} sceneIndex={0} timeMs={timeMs} history={[]} />)
}

describe('ParkourDuo', () => {
  it('shows the current 2–3 word chunk', () => {
    renderScene(fixtureScene('e0s0'), 300)
    expect(screen.getByText('Представь')).toBeInTheDocument()
    expect(screen.getByText('у')).toBeInTheDocument()
    expect(screen.queryByText('машины')).not.toBeInTheDocument()
  })

  it('paints the highlight word in the accent colour', () => {
    renderScene(fixtureScene('e0s0'), brainAt)
    expect(screen.getByText('мозг')).toHaveClass('text-accent')
    expect(screen.getByText('машины')).not.toHaveClass('text-accent')
  })

  it('shows the cast character for each role', () => {
    renderScene(fixtureScene('e0s0'), 300)
    expect(screen.getByRole('img', { name: episode.cast.teacher })).toHaveAttribute(
      'src',
      `/assets/mascots/${episode.cast.teacher}-shocked.png`,
    )
    expect(screen.getByRole('img', { name: episode.cast.student })).toHaveAttribute(
      'src',
      `/assets/mascots/${episode.cast.student}-neutral.png`,
    )
  })

  it('makes the speaking mascot active', () => {
    const { rerender } = renderScene(fixtureScene('e0s0'), 300)
    expect(screen.getByTestId('mascot-teacher')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('mascot-student')).toHaveAttribute('data-active', 'false')
    rerender(<ParkourDuo episode={episode} scene={fixtureScene('e0s1')} sceneIndex={1} timeMs={300} history={[]} />)
    expect(screen.getByTestId('mascot-student')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('mascot-teacher')).toHaveAttribute('data-active', 'false')
  })

  it('pops the reaction sticker when the highlight word starts', () => {
    const { rerender } = renderScene(fixtureScene('e0s0'), brainAt - 1)
    expect(screen.queryByTestId('reaction')).not.toBeInTheDocument()
    rerender(<ParkourDuo episode={episode} scene={fixtureScene('e0s0')} sceneIndex={0} timeMs={brainAt} history={[]} />)
    expect(screen.getByTestId('reaction')).toBeInTheDocument()
  })

  it('replaces a picture that fails to load with the highlight card', () => {
    renderScene(fixtureScene('e0s2'), 300)
    fireEvent.error(screen.getByRole('img', { name: 'car engine sensors' }))
    expect(screen.getByTestId('picture-fallback')).toHaveTextContent('миллисекунду')
  })

  it('hides the photo credit once the picture failed', () => {
    renderScene(fixtureScene('e0s3'), 300)
    expect(screen.getByText('Lorem Picsum (fixture only)')).toBeInTheDocument()
    fireEvent.error(screen.getByRole('img', { name: 'data table chart' }))
    expect(screen.queryByText('Lorem Picsum (fixture only)')).not.toBeInTheDocument()
  })

  it('shows the highlight card when the scene has no picture', () => {
    renderScene(fixtureScene('e0s1'), 300)
    expect(screen.getByTestId('picture-fallback')).toHaveTextContent('делает')
  })

  it('falls back to the term, then to the reaction emoji, when there is no highlight', () => {
    const { rerender } = renderScene({ ...fixtureScene('e0s1'), highlight: null, term: 'ЭБУ = мозг' }, 300)
    expect(screen.getByTestId('picture-fallback')).toHaveTextContent('ЭБУ = мозг')
    rerender(
      <ParkourDuo
        episode={episode}
        scene={{ ...fixtureScene('e0s1'), highlight: null, term: null }}
        sceneIndex={1}
        timeMs={300}
        history={[]}
      />,
    )
    expect(screen.getByTestId('picture-fallback')).toHaveTextContent('🤔')
  })

  it('replaces a missing mascot or sticker file with an emoji', () => {
    renderScene(fixtureScene('e0s0'), brainAt + 500)
    fireEvent.error(screen.getByRole('img', { name: 'mind_blown' }))
    expect(screen.getByTestId('reaction')).toHaveTextContent('🤯')
    fireEvent.error(screen.getByRole('img', { name: episode.cast.teacher }))
    expect(screen.getByTestId('mascot-teacher')).toHaveTextContent(CHARACTER_EMOJI[episode.cast.teacher])
  })
})
