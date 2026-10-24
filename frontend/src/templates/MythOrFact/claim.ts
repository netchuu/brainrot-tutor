import type { Scene, Verdict } from '@/types/contract'

export type ClaimPhase =
  | { kind: 'intro' }
  | { kind: 'claim'; claim: Scene }
  | { kind: 'guess'; claim: Scene }
  | { kind: 'reveal'; claim: Scene; verdict: Verdict }

interface ClaimState {
  claim: Scene | null
  verdict: Verdict | null
  guessed: boolean
  revealed: boolean
}

const NO_CLAIM: ClaimState = { claim: null, verdict: null, guessed: false, revealed: false }

// A claim carries the verdict and is stamped on the teacher's next line, whether or not the model repeats the
// verdict there. A teacher verdict line before anyone guessed, or after the reveal, starts a new claim.
function phaseOf(state: ClaimState, scene: Scene): ClaimPhase {
  const { claim, verdict } = state
  if (claim === null || verdict === null) return scene.verdict === null ? { kind: 'intro' } : { kind: 'claim', claim: scene }
  if (state.revealed) return scene.verdict === null ? { kind: 'reveal', claim, verdict } : { kind: 'claim', claim: scene }
  if (scene.speaker === 'student') return { kind: 'guess', claim }
  if (scene.verdict !== null && !state.guessed) return { kind: 'claim', claim: scene }
  return { kind: 'reveal', claim, verdict }
}

function advance(state: ClaimState, scene: Scene, phase: ClaimPhase): ClaimState {
  switch (phase.kind) {
    case 'intro':
      return state
    case 'claim':
      return { claim: scene, verdict: scene.verdict, guessed: false, revealed: false }
    case 'guess':
      return { ...state, guessed: true }
    case 'reveal':
      return { ...state, revealed: true }
  }
}

export function claimPhase(scene: Scene, history: readonly Scene[]): ClaimPhase {
  const state = history.reduce((current, previous) => advance(current, previous, phaseOf(current, previous)), NO_CLAIM)
  return phaseOf(state, scene)
}
