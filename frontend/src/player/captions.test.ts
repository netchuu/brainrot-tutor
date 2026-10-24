import { describe, expect, it } from 'vitest'
import { activeWordIndex, chunkAt, chunkWords, highlightIndex } from '@/player/captions'
import { fixtureEvents, fixtureScene } from '@/test/fixtureEvents'
import type { Word } from '@/types/contract'

const WORD_MS = 200
const GAP_MS = 50
const PAUSE_MS = 700

// "|" marks a pause long enough to break a caption.
function spoken(script: string): Word[] {
  const words: Word[] = []
  let time = 100
  for (const token of script.split(' ')) {
    if (token === '|') {
      time += PAUSE_MS
      continue
    }
    words.push({ text: token, start_ms: time, end_ms: time + WORD_MS })
    time += WORD_MS + GAP_MS
  }
  return words
}

function texts(words: readonly Word[]): string[] {
  return chunkWords(words).map((chunk) => chunk.words.map((word) => word.text).join(' '))
}

const allScenes = fixtureEvents.flatMap((event) => (event.type === 'scene' ? [event.scene] : []))

describe('chunkWords', () => {
  it('splits into 2–3 word chunks and breaks on pauses', () => {
    expect(texts(spoken('Представь что у машины есть мозг | Он называется ЭБУ'))).toEqual([
      'Представь что у',
      'машины есть мозг',
      'Он называется ЭБУ',
    ])
  })

  it('keeps long words to two per chunk', () => {
    expect(texts(spoken('Каждую миллисекунду он читает датчики и решает сколько топлива впрыснуть'))).toEqual([
      'Каждую миллисекунду',
      'он читает датчики',
      'и решает сколько',
      'топлива впрыснуть',
    ])
  })

  it('joins a word stranded before a pause to its neighbours', () => {
    expect(texts(spoken('А правила для этих решений записаны в таблицах | Их называют картами'))).toEqual([
      'А правила для',
      'этих решений',
      'записаны в таблицах',
      'Их называют картами',
    ])
  })

  it('keeps a word alone when a pause isolates it', () => {
    expect(texts(spoken('Нельзя | Слишком агрессивная прошивка ведёт к детонации и перегреву'))).toEqual([
      'Нельзя',
      'Слишком агрессивная',
      'прошивка ведёт к',
      'детонации и перегреву',
    ])
  })

  it('moves one word over when a three-word chunk would leave an orphan', () => {
    expect(texts(spoken('a b c d'))).toEqual(['a b', 'c d'])
  })

  it('covers every fixture scene in order with 1–3 word chunks, single words only next to a pause', () => {
    for (const scene of allScenes) {
      const chunks = chunkWords(scene.words)
      expect(chunks.flatMap((chunk) => chunk.words)).toEqual(scene.words)
      for (const chunk of chunks) {
        expect(chunk.words.length).toBeLessThanOrEqual(3)
        expect(chunk.startMs).toBe(chunk.words[0]?.start_ms)
        expect(scene.words[chunk.firstIndex]).toBe(chunk.words[0])
        if (chunk.words.length > 1 || scene.words.length === 1) continue
        const before = scene.words[chunk.firstIndex - 1]
        const word = scene.words[chunk.firstIndex]
        const after = scene.words[chunk.firstIndex + 1]
        const pauseBefore = before !== undefined && word !== undefined && word.start_ms - before.end_ms >= 300
        const pauseAfter = after !== undefined && word !== undefined && after.start_ms - word.end_ms >= 300
        expect(pauseBefore || pauseAfter).toBe(true)
      }
    }
  })
})

describe('chunkAt', () => {
  const words = spoken('Представь что у машины есть мозг | Он называется ЭБУ')
  const chunks = chunkWords(words)
  const thirdStart = words[6]?.start_ms ?? 0

  it('shows the first chunk before the first word starts', () => {
    expect(chunkAt(chunks, 0)?.firstIndex).toBe(0)
  })

  it('holds a chunk through the pause and switches at the next start', () => {
    expect(chunkAt(chunks, thirdStart - 1)?.firstIndex).toBe(3)
    expect(chunkAt(chunks, thirdStart)?.firstIndex).toBe(6)
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
    const words = spoken('на 5000_оборотах дают').map((word) => ({ ...word, text: word.text.replace('_', ' ') }))
    expect(highlightIndex(words, 'оборотах')).toBe(1)
  })

  it('returns -1 for null or missing highlights', () => {
    expect(highlightIndex(fixtureScene('e0s0').words, null)).toBe(-1)
    expect(highlightIndex(fixtureScene('e0s0').words, 'турбина')).toBe(-1)
  })
})

describe('activeWordIndex', () => {
  const words = spoken('один два три')

  it('is -1 before the first word and follows start times', () => {
    expect(activeWordIndex(words, 99)).toBe(-1)
    expect(activeWordIndex(words, 100)).toBe(0)
    expect(activeWordIndex(words, words[1]?.start_ms ?? 0)).toBe(1)
    expect(activeWordIndex(words, 99_999)).toBe(2)
  })
})
