import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { claimPhase } from '@/templates/MythOrFact/claim'
import { MythOrFact } from '@/templates/MythOrFact/MythOrFact'
import { fixtureEvents, fixtureScene } from '@/test/fixtureEvents'
import type { EpisodeOutline, Scene, Speaker, Verdict } from '@/types/contract'

const plan = fixtureEvents[0]
if (plan?.type !== 'plan' || plan.episodes[0] === undefined) throw new Error('fixture must start with a plan')
const episode: EpisodeOutline = { ...plan.episodes[0], template: 'myth_or_fact' }

function line(id: string, speaker: Speaker, verdict: Verdict | null, text: string): Scene {
  return { ...fixtureScene('e0s0'), id, speaker, verdict, text, picture: null }
}

const intro = line('e9s0', 'teacher', null, 'Проверим, что ты знаешь про ЭБУ.')
const claim = line('e9s1', 'teacher', 'myth', 'ЭБУ управляет только фарами.')
const guess = line('e9s2', 'student', null, 'Звучит как миф!')
const reveal = line('e9s3', 'teacher', null, 'Верно, это миф: он управляет двигателем.')
const explain = line('e9s4', 'teacher', null, 'Он читает датчики каждую миллисекунду.')

describe('claimPhase', () => {
  it('walks through intro, claim, guess and reveal', () => {
    expect(claimPhase(intro, [])).toEqual({ kind: 'intro' })
    expect(claimPhase(claim, [intro])).toEqual({ kind: 'claim', claim })
    expect(claimPhase(guess, [intro, claim])).toEqual({ kind: 'guess', claim })
    expect(claimPhase(reveal, [intro, claim, guess])).toEqual({ kind: 'reveal', claim, verdict: 'myth' })
  })

  it('keeps the stamp for the explanation after the reveal and resets on the next claim', () => {
    expect(claimPhase(explain, [intro, claim, guess, reveal])).toEqual({ kind: 'reveal', claim, verdict: 'myth' })
    const next = line('e9s5', 'teacher', 'fact', 'ЭБУ можно перепрошить.')
    expect(claimPhase(next, [intro, claim, guess, reveal])).toEqual({ kind: 'claim', claim: next })
  })
})

describe('MythOrFact', () => {
  function renderScene(scene: Scene, history: Scene[]) {
    return render(<MythOrFact episode={episode} scene={scene} sceneIndex={history.length} timeMs={300} history={history} />)
  }

  it('shows the claim with a question mark while the student guesses', () => {
    renderScene(guess, [intro, claim])
    expect(screen.getByTestId('claim-card')).toHaveTextContent(claim.text)
    expect(screen.getByTestId('verdict-unknown')).toBeInTheDocument()
    expect(screen.queryByTestId('verdict-stamp')).not.toBeInTheDocument()
  })

  it('stamps the verdict when the teacher reveals it', () => {
    renderScene(reveal, [intro, claim, guess])
    expect(screen.getByTestId('verdict-stamp')).toHaveAttribute('data-verdict', 'myth')
    expect(screen.getByTestId('verdict-stamp')).toHaveTextContent('МИФ')
  })

  it('shows the picture slot before the first claim', () => {
    renderScene(intro, [])
    expect(screen.queryByTestId('claim-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('picture-fallback')).toBeInTheDocument()
  })
})
