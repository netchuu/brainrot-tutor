import fixtureText from '../../../contracts/fixtures/episode-stream.ndjson?raw'
import { isStreamEvent } from '@/api/guards'
import type { Scene, StreamEvent } from '@/types/contract'

export const FIXTURE_TEXT = fixtureText

export const fixtureLines: unknown[] = fixtureText
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line): unknown => JSON.parse(line))

export const fixtureEvents: StreamEvent[] = fixtureLines.filter(isStreamEvent)

export function fixtureScene(id: string): Scene {
  for (const event of fixtureEvents) {
    if (event.type === 'scene' && event.scene.id === id) return event.scene
  }
  throw new Error(`Fixture has no scene ${id}`)
}
