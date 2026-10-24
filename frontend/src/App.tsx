import { useState } from 'react'
import { fixtureEpisodesRequest, USE_FIXTURES } from '@/api/fixtures'
import { unlockAudio } from '@/player/audioOutput'
import { preloadSfx } from '@/player/sfx'
import { CookingSticker, ErrorCard, Stage, StageFrame } from '@/player/Stage'
import { useEpisodeStream } from '@/player/useEpisodeStream'
import type { Scene } from '@/types/contract'

const NO_SCENES: readonly Scene[] = []

export function App() {
  const { state, start } = useEpisodeStream()
  const [started, setStarted] = useState(false)

  if (!USE_FIXTURES) {
    return <p className="p-6 text-sm">Start with VITE_USE_FIXTURES=1 until the upload screen exists.</p>
  }

  const begin = () => {
    start(fixtureEpisodesRequest())
  }

  const play = () => {
    unlockAudio()
    void preloadSfx()
    setStarted(true)
    begin()
  }

  if (!started) {
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
        <h1 className="text-4xl font-black uppercase">Brainrot Tutor</h1>
        <p className="text-sm text-white/60">Fixture mode: plays episode 1 of the sample course.</p>
        <button
          type="button"
          className="rounded-full bg-accent px-10 py-4 text-xl font-black text-black uppercase shadow-xl active:scale-95"
          onClick={play}
        >
          ▶ Play
        </button>
      </main>
    )
  }

  if (state.error !== null) {
    return (
      <StageFrame background={null}>
        <ErrorCard message={state.error.message} onRetry={state.error.retryable ? begin : null} />
      </StageFrame>
    )
  }

  const episode = state.plan?.episodes[0]
  if (episode === undefined) {
    return (
      <StageFrame background={null}>
        <CookingSticker />
      </StageFrame>
    )
  }

  const scenes = state.scenes[episode.index] ?? NO_SCENES
  const complete =
    state.episodeDone[episode.index] === true || scenes.length >= episode.scene_count || state.status === 'done'
  return <Stage episode={episode} scenes={scenes} complete={complete} />
}
