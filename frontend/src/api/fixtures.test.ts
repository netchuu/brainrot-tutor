import { afterEach, describe, expect, it, vi } from 'vitest'
import { readNdjson } from '@/api/client'
import { replayLines } from '@/api/fixtures'
import { isStreamEvent } from '@/api/guards'
import { FIXTURE_TEXT, fixtureEvents } from '@/test/fixtureEvents'

describe('replayLines', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('replays the fixture through the NDJSON reader in the same order', async () => {
    const replayed: unknown[] = []
    for await (const value of readNdjson(replayLines(FIXTURE_TEXT, new AbortController().signal, 0))) {
      replayed.push(value)
    }
    expect(replayed.every(isStreamEvent)).toBe(true)
    expect(replayed).toEqual(fixtureEvents)
  })

  it('waits the gap between lines', async () => {
    vi.useFakeTimers()
    const reader = replayLines('{"a":1}\n{"b":2}\n', new AbortController().signal, 300).getReader()
    await reader.read()
    let settled = false
    const second = reader.read().then((result) => {
      settled = true
      return result
    })
    await vi.advanceTimersByTimeAsync(299)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await second).done).toBe(false)
  })

  it('errors with AbortError when aborted during the gap', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const reader = replayLines('{"a":1}\n{"b":2}\n', controller.signal, 300).getReader()
    await reader.read()
    const second = reader.read()
    controller.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('stops its timer when cancelled', async () => {
    vi.useFakeTimers()
    const reader = replayLines('{"a":1}\n{"b":2}\n{"c":3}\n', new AbortController().signal, 300).getReader()
    await reader.read()
    await reader.cancel()
    expect(vi.getTimerCount()).toBe(0)
  })
})
