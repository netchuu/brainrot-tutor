import type { Word } from '@/types/contract'

export interface CaptionChunk {
  words: Word[]
  firstIndex: number
  startMs: number
}

const MAX_WORDS = 3
const MAX_CHARS = 18
const PAUSE_BREAK_MS = 300

function charCount(words: readonly Word[]): number {
  return words.reduce((sum, word) => sum + word.text.length, 0) + Math.max(0, words.length - 1)
}

function pauseBefore(words: readonly Word[], index: number): boolean {
  const previous = words[index - 1]
  const current = words[index]
  if (previous === undefined || current === undefined) return false
  return current.start_ms - previous.end_ms >= PAUSE_BREAK_MS
}

export function chunkWords(words: readonly Word[]): CaptionChunk[] {
  const groups: { firstIndex: number; words: Word[] }[] = []
  words.forEach((word, index) => {
    const current = groups.at(-1)
    const startNew =
      current === undefined ||
      current.words.length >= MAX_WORDS ||
      pauseBefore(words, index) ||
      (current.words.length >= 2 && charCount([...current.words, word]) > MAX_CHARS)
    if (startNew) groups.push({ firstIndex: index, words: [word] })
    else current.words.push(word)
  })

  for (let i = groups.length - 1; i > 0; i -= 1) {
    const orphan = groups[i]
    const previous = groups[i - 1]
    if (orphan === undefined || previous === undefined) continue
    if (orphan.words.length !== 1 || pauseBefore(words, orphan.firstIndex)) continue
    if (previous.words.length === MAX_WORDS) {
      const moved = previous.words.pop()
      if (moved !== undefined) {
        orphan.words.unshift(moved)
        orphan.firstIndex -= 1
      }
    } else {
      previous.words.push(...orphan.words)
      groups.splice(i, 1)
    }
  }

  return groups.flatMap((group) => {
    const first = group.words[0]
    return first === undefined ? [] : [{ words: group.words, firstIndex: group.firstIndex, startMs: first.start_ms }]
  })
}

export function chunkAt(chunks: readonly CaptionChunk[], timeMs: number): CaptionChunk | undefined {
  let current = chunks[0]
  for (const chunk of chunks) {
    if (chunk.startMs > timeMs) break
    current = chunk
  }
  return current
}

function normalize(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

export function highlightIndex(words: readonly Word[], highlight: string | null): number {
  if (highlight === null) return -1
  const target = normalize(highlight)
  if (target === '') return -1
  const exact = words.findIndex((word) => normalize(word.text) === target)
  return exact !== -1 ? exact : words.findIndex((word) => normalize(word.text).includes(target))
}

export function activeWordIndex(words: readonly Word[], timeMs: number): number {
  let active = -1
  words.forEach((word, index) => {
    if (word.start_ms <= timeMs) active = index
  })
  return active
}
