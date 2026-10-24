import type { Language } from '@/types/contract'

export const MIN_SOURCE_CHARS = 200
export const MAX_SOURCE_CHARS = 60_000
export const MAX_PDF_BYTES = 30 * 1024 * 1024

const LANGUAGE_SAMPLE_CHARS = 5_000

export interface PreparedSource {
  text: string
  total: number
  truncated: boolean
  tooShort: boolean
}

// Counts code points like the backend does, so an emoji is one character and is never cut in half.
export function charCount(text: string): number {
  return Array.from(text).length
}

export function prepareSource(raw: string): PreparedSource {
  const trimmed = raw.trim()
  const chars = Array.from(trimmed)
  const total = chars.length
  const truncated = total > MAX_SOURCE_CHARS
  return {
    text: truncated ? chars.slice(0, MAX_SOURCE_CHARS).join('') : trimmed,
    total,
    truncated,
    tooShort: total < MIN_SOURCE_CHARS,
  }
}

export function detectLanguage(text: string): Language {
  const sample = text.slice(0, LANGUAGE_SAMPLE_CHARS)
  const cyrillic = sample.match(/\p{Script=Cyrillic}/gu)?.length ?? 0
  const latin = sample.match(/\p{Script=Latin}/gu)?.length ?? 0
  return latin > cyrillic ? 'en' : 'ru'
}
