import type { EpisodesRequest } from '@/types/contract'

export const USE_FIXTURES = import.meta.env.VITE_USE_FIXTURES === '1'

const EVENT_GAP_MS = 300

export class FixtureModeError extends Error {
  override name = 'FixtureModeError'
}

// The flag checks let the build drop the 440 KB fixture chunks when fixture mode is off.
export async function fixtureEpisodeStream(signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  if (!USE_FIXTURES) throw new FixtureModeError('Fixture mode is off')
  const { default: text } = await import('../../../contracts/fixtures/episode-stream.ndjson?raw')
  return replayLines(text, signal, EVENT_GAP_MS)
}

export async function fixtureEpisodesRequest(): Promise<EpisodesRequest> {
  if (!USE_FIXTURES) throw new FixtureModeError('Fixture mode is off')
  const { default: sourceText } = await import('../../../contracts/fixtures/source.txt?raw')
  return { source_text: sourceText, language: 'ru', episode_count: 3, template: null }
}

export function replayLines(text: string, signal: AbortSignal, gapMs: number): ReadableStream<Uint8Array> {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const encoder = new TextEncoder()
  const stopped = new AbortController()
  const stop = () => {
    stopped.abort()
  }
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  let next = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next > 0) await delay(gapMs, stopped.signal)
      const line = lines[next]
      if (line === undefined) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(`${line}\n`))
      next += 1
    },
    cancel() {
      signal.removeEventListener('abort', stop)
      stop()
    },
  })
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('Fixture replay aborted', 'AbortError')
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
