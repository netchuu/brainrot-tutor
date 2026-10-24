import fixtureText from '../../../contracts/fixtures/episode-stream.ndjson?raw'
import { isStreamEvent } from '@/api/guards'
import type { Scene, StreamEvent } from '@/types/contract'

export const FIXTURE_TEXT = fixtureText

export const fixtureLines: unknown[] = fixtureText
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line): unknown => JSON.parse(line))

export const fixtureEvents: StreamEvent[] = fixtureLines.filter(isStreamEvent)

export function wordStart(scene: Scene, text: string): number {
  const word = scene.words.find((candidate) => candidate.text === text)
  if (word === undefined) throw new Error(`Scene ${scene.id} has no word ${text}`)
  return word.start_ms
}

export function fixtureScene(id: string): Scene {
  for (const event of fixtureEvents) {
    if (event.type === 'scene' && event.scene.id === id) return event.scene
  }
  throw new Error(`Fixture has no scene ${id}`)
}
