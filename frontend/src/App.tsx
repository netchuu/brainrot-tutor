import { useState } from 'react'
import { useEpisodeStream } from '@/player/useEpisodeStream'
import { Feed } from '@/screens/Feed'
import { Upload } from '@/screens/Upload'
import type { EpisodesRequest } from '@/types/contract'

export function App() {
  const { state, start, stop } = useEpisodeStream()
  const [request, setRequest] = useState<EpisodesRequest | null>(null)
  const [watching, setWatching] = useState(false)
  const [generation, setGeneration] = useState(0)

  const run = (next: EpisodesRequest) => {
    setRequest(next)
    setWatching(true)
    setGeneration((current) => current + 1)
    start(next)
  }

  if (!watching || request === null) return <Upload initial={request} onGenerate={run} />

  return (
    <Feed
      key={generation}
      state={state}
      onRetry={() => {
        run(request)
      }}
      onExit={() => {
        stop()
        setWatching(false)
      }}
    />
  )
}
