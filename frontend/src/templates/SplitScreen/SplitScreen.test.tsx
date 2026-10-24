import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StageFrame } from '@/player/Stage'
import { Formula } from '@/templates/SplitScreen/Formula'
import { SplitScreen } from '@/templates/SplitScreen/SplitScreen'
import { fixtureEvents, fixtureScene } from '@/test/fixtureEvents'
import type { EpisodeOutline, Scene } from '@/types/contract'

const plan = fixtureEvents[0]
if (plan?.type !== 'plan' || plan.episodes[1] === undefined) throw new Error('fixture must plan a second episode')
const episode: EpisodeOutline = plan.episodes[1]

function renderScene(scene: Scene) {
  return render(<SplitScreen episode={episode} scene={scene} sceneIndex={0} timeMs={300} history={[]} />)
}

describe('SplitScreen', () => {
  it('shows the KaTeX formula first', async () => {
    renderScene(fixtureScene('e1s1'))
    const formula = screen.getByTestId('formula')
    await waitFor(() => {
      expect(formula.querySelector('.katex')).not.toBeNull()
    })
    expect(screen.queryByTestId('term-card')).not.toBeInTheDocument()
  })

  it('shows the term card when there is no formula', () => {
    renderScene(fixtureScene('e1s0'))
    expect(screen.getByTestId('term-card')).toHaveTextContent('Чип-тюнинг = изменение карт ЭБУ')
  })

  it('falls back to the picture, then to the highlight card', () => {
    const withPicture = fixtureScene('e0s0')
    const { rerender } = renderScene({ ...withPicture, formula: null, term: null })
    expect(screen.getByRole('img', { name: withPicture.picture?.query })).toBeInTheDocument()
    rerender(
      <SplitScreen
        episode={episode}
        scene={{ ...withPicture, picture: null, formula: null, term: null }}
        sceneIndex={0}
        timeMs={300}
        history={[]}
      />,
    )
    expect(screen.getByTestId('picture-fallback')).toHaveTextContent('мозг')
  })

  it('shows the cast character of the speaking role and the caption', () => {
    renderScene({ ...fixtureScene('e1s1'), speaker: 'student' })
    expect(screen.getByTestId('speaker-avatar')).toHaveAttribute('data-character', episode.cast.student)
    expect(screen.getByText('Мощность')).toBeInTheDocument()
  })

  it('keeps the background clip in the bottom half', () => {
    render(
      <StageFrame background="/assets/backgrounds/satisfying-1.mp4" backgroundArea="bottom">
        <span />
      </StageFrame>,
    )
    expect(screen.getByTestId('background')).toHaveAttribute('data-area', 'bottom')
  })
})

describe('Formula', () => {
  it('shows the TeX source until KaTeX is ready, then shrinks a wide formula to fit', async () => {
    render(<Formula tex={'P = \\frac{M \\times n}{7023}'} />)
    const box = screen.getByTestId('formula')
    const output = screen.getByTestId('formula-output')
    expect(box).toHaveTextContent('P = \\frac{M \\times n}{7023}')
    Object.defineProperty(output, 'clientWidth', { configurable: true, value: 300 })
    Object.defineProperty(output, 'scrollWidth', { configurable: true, value: 600 })
    await waitFor(() => {
      expect(output.querySelector('.katex')).not.toBeNull()
    })
    await waitFor(() => {
      expect(box.style.getPropertyValue('--fit')).toBe('0.5')
    })
  })

  it('renders invalid TeX as text instead of throwing', async () => {
    render(<Formula tex={'\\frac{1}{'} />)
    const formula = screen.getByTestId('formula')
    expect(formula).toHaveTextContent('\\frac{1}{')
    await waitFor(() => {
      expect(formula.querySelector('.katex, .katex-error')).not.toBeNull()
    })
  })
})
