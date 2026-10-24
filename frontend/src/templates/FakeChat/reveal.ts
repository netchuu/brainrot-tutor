import type { Word } from '@/types/contract'

// Maps spoken words back onto the written line, so punctuation shows up as the words are typed.
export function revealedText(text: string, words: readonly Word[], activeIndex: number): string {
  if (activeIndex < 0) return ''
  if (activeIndex >= words.length - 1) return text
  let cursor = 0
  for (let index = 0; index <= activeIndex; index += 1) {
    const word = words[index]
    if (word === undefined) break
    const found = text.indexOf(word.text, cursor)
    if (found === -1) continue
    cursor = found + word.text.length
  }
  const nextWord = text.slice(cursor).search(/\s/)
  const end = nextWord === -1 ? text.length : cursor + nextWord
  return text.slice(0, end)
}

export function splitHighlight(text: string, highlight: string | null): [string, string, string] {
  if (highlight === null || highlight === '') return [text, '', '']
  const index = text.indexOf(highlight)
  if (index === -1) return [text, '', '']
  return [text.slice(0, index), highlight, text.slice(index + highlight.length)]
}
