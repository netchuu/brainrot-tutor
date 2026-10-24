import { describe, expect, it } from 'vitest'
import { activeWordIndex, chunkAt, chunkWords, highlightIndex } from '@/player/captions'
import { fixtureEvents, fixtureScene } from '@/test/fixtureEvents'
import type { Word } from '@/types/contract'

function texts(words: readonly Word[]): string[] {
  return chunkWords(words).map((chunk) => chunk.words.map((word) => word.text).join(' '))
}

const allScenes = fixtureEvents.flatMap((event) => (event.type === 'scene' ? [event.scene] : []))

describe('chunkWords', () => {
  it('splits into 2–3 word chunks and breaks on pauses', () => {
    expect(texts(fixtureScene('e0s0').words)).toEqual(['Представь что у', 'машины есть мозг', 'Он называется ЭБУ'])
  })

  it('keeps long words to two per chunk', () => {
    expect(texts(fixtureScene('e0s2').words)).toEqual([
      'Каждую миллисекунду',
      'он читает датчики',
      'и решает сколько',
      'топлива впрыснуть',
    ])
  })

  it('joins a word stranded before a pause to its neighbours', () => {
    expect(texts(fixtureScene('e0s3').words)).toEqual([
      'А правила для',
      'этих решений',
      'записаны в таблицах',
      'Их называют картами',
    ])
  })

  it('keeps a word alone only when a pause isolates it', () => {
    expect(texts(fixtureScene('e2s1').words)).toEqual([
      'Нельзя',
      'Слишком агрессивная',
      'прошивка ведёт к',
      'детонации и перегреву',
    ])
    const singles = allScenes.flatMap((scene) => texts(scene.words).filter((chunk) => !chunk.includes(' ')))
    expect(singles).toEqual(['Нельзя'])
  })

  it('covers every word exactly once and in order for every fixture scene', () => {
    for (const scene of allScenes) {
      const chunks = chunkWords(scene.words)
      expect(chunks.flatMap((chunk) => chunk.words)).toEqual(scene.words)
      for (const chunk of chunks) {
        expect(chunk.words.length).toBeLessThanOrEqual(3)
        expect(chunk.startMs).toBe(chunk.words[0]?.start_ms)
        expect(scene.words[chunk.firstIndex]).toBe(chunk.words[0])
      }
    }
  })

  it('moves one word over when a three-word chunk would leave an orphan', () => {
    const words: Word[] = ['a', 'b', 'c', 'd'].map((text, i) => ({ text, start_ms: i * 100, end_ms: i * 100 + 90 }))
    expect(texts(words)).toEqual(['a b', 'c d'])
  })
})

describe('chunkAt', () => {
  const chunks = chunkWords(fixtureScene('e0s0').words)

  it('shows the first chunk before the first word starts', () => {
    expect(chunkAt(chunks, 0)?.firstIndex).toBe(0)
  })

  it('holds a chunk through the pause and switches at the next start', () => {
    expect(chunkAt(chunks, 3000)?.firstIndex).toBe(3)
    expect(chunkAt(chunks, 3537)?.firstIndex).toBe(3)
    expect(chunkAt(chunks, 3538)?.firstIndex).toBe(6)
  })

  it('holds the last chunk after the last word', () => {
    expect(chunkAt(chunks, 60_000)?.firstIndex).toBe(6)
  })

  it('returns undefined without words', () => {
    expect(chunkAt([], 100)).toBeUndefined()
  })
})

describe('highlightIndex', () => {
  it('matches case-insensitively', () => {
    expect(highlightIndex(fixtureScene('e1s1').words, 'Мощность')).toBe(0)
    expect(highlightIndex(fixtureScene('e0s0').words, 'эбу')).toBe(8)
  })

  it('ignores punctuation and finds a word inside a multi-word token', () => {
    expect(highlightIndex(fixtureScene('e0s0').words, 'мозг.')).toBe(5)
    expect(highlightIndex(fixtureScene('e1s2').words, 'оборотах')).toBe(4)
  })

  it('returns -1 for null or missing highlights', () => {
    expect(highlightIndex(fixtureScene('e0s0').words, null)).toBe(-1)
    expect(highlightIndex(fixtureScene('e0s0').words, 'турбина')).toBe(-1)
  })
})

describe('activeWordIndex', () => {
  const words = fixtureScene('e0s0').words

  it('is -1 before the first word and follows start times', () => {
    expect(activeWordIndex(words, 99)).toBe(-1)
    expect(activeWordIndex(words, 100)).toBe(0)
    expect(activeWordIndex(words, 2125)).toBe(5)
    expect(activeWordIndex(words, 99_999)).toBe(8)
  })
})
