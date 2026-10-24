import type { Scene, Verdict } from '@/types/contract'

export type ClaimPhase =
  | { kind: 'intro' }
  | { kind: 'claim'; claim: Scene }
  | { kind: 'guess'; claim: Scene }
  | { kind: 'reveal'; claim: Scene; verdict: Verdict }

// The claim scene carries the verdict; it stays hidden while the student guesses and is stamped on the teacher's next line.
export function claimPhase(scene: Scene, history: readonly Scene[]): ClaimPhase {
  if (scene.verdict !== null) return { kind: 'claim', claim: scene }
  const lastClaimIndex = history.findLastIndex((previous) => previous.verdict !== null)
  const claim = history[lastClaimIndex]
  if (claim?.verdict === undefined || claim.verdict === null) return { kind: 'intro' }
  const revealedEarlier = history.slice(lastClaimIndex + 1).some((previous) => previous.speaker === 'teacher')
  if (scene.speaker === 'teacher' || revealedEarlier) return { kind: 'reveal', claim, verdict: claim.verdict }
  return { kind: 'guess', claim }
}
