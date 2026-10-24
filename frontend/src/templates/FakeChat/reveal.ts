import { highlightIndex } from '@/player/captions'
import type { Word } from '@/types/contract'

// Maps spoken words back onto the written line, so punctuation shows up as the words are typed.
export function revealedText(text: string, words: readonly Word[], activeIndex: number): string {
  if (activeIndex < 0) return ''
  if (activeIndex >= words.length - 1) return text
  const haystack = text.toLocaleLowerCase()
  let cursor = 0
  for (let index = 0; index <= activeIndex; index += 1) {
    const word = words[index]
    if (word === undefined) break
    const found = haystack.indexOf(word.text.toLocaleLowerCase(), cursor)
    if (found === -1) continue
    cursor = found + word.text.length
  }
  const nextWord = text.slice(cursor).search(/\s/)
  const end = nextWord === -1 ? text.length : cursor + nextWord
  return text.slice(0, end)
}

// Finds the written span of the highlighted spoken word, so a match inside an earlier word is never marked.
export function highlightRange(text: string, words: readonly Word[], highlight: string | null): [number, number] | null {
  const target = highlightIndex(words, highlight)
  if (target === -1) return null
  const haystack = text.toLocaleLowerCase()
  let cursor = 0
  for (let index = 0; index <= target; index += 1) {
    const word = words[index]
    if (word === undefined) return null
    const found = haystack.indexOf(word.text.toLocaleLowerCase(), cursor)
    if (found === -1) return null
    if (index === target) return [found, found + word.text.length]
    cursor = found + word.text.length
  }
  return null
}

export function splitHighlight(text: string, range: [number, number] | null): [string, string, string] {
  if (range === null || text.length <= range[0]) return [text, '', '']
  const [start, end] = range
  return [text.slice(0, start), text.slice(start, Math.min(end, text.length)), text.slice(end)]
}
