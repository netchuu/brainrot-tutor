import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Top3Countdown } from '@/templates/Top3Countdown/Top3Countdown'
import { fixtureEvents, fixtureScene } from '@/test/fixtureEvents'
import type { EpisodeOutline, Scene } from '@/types/contract'

const plan = fixtureEvents[0]
if (plan?.type !== 'plan' || plan.episodes[0] === undefined) throw new Error('fixture must start with a plan')
const episode: EpisodeOutline = { ...plan.episodes[0], template: 'top3_countdown' }

function ranked(id: string, rank: Scene['rank']): Scene {
  return { ...fixtureScene('e0s2'), id, rank }
}

describe('Top3Countdown', () => {
  it('shows the big rank and marks the countdown so far', () => {
    const third = ranked('e9s1', 3)
    const second = ranked('e9s2', 2)
    render(<Top3Countdown episode={episode} scene={second} sceneIndex={1} timeMs={300} history={[third]} />)
    expect(screen.getByTestId('rank')).toHaveTextContent('#2')
    expect(screen.getByTestId('rank-pill-2')).toHaveAttribute('data-current', 'true')
    expect(screen.getByTestId('rank-pill-3')).toHaveClass('bg-white/70')
    expect(screen.getByTestId('rank-pill-1')).toHaveClass('bg-white/15')
  })

  it('shows an opening line without a rank', () => {
    render(<Top3Countdown episode={episode} scene={ranked('e9s0', null)} sceneIndex={0} timeMs={300} history={[]} />)
    expect(screen.queryByTestId('rank')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'car engine sensors' })).toBeInTheDocument()
  })
})
