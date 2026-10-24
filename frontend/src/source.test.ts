import { describe, expect, it } from 'vitest'
import { charCount, detectLanguage, MAX_SOURCE_CHARS, MIN_SOURCE_CHARS, prepareSource } from '@/source'

describe('prepareSource', () => {
  it('trims and flags text under the minimum', () => {
    const source = prepareSource(`  ${'а'.repeat(MIN_SOURCE_CHARS - 1)}  `)
    expect(source).toEqual({ text: 'а'.repeat(MIN_SOURCE_CHARS - 1), total: 199, truncated: false, tooShort: true })
    expect(prepareSource('а'.repeat(MIN_SOURCE_CHARS)).tooShort).toBe(false)
  })

  it('keeps exactly the maximum and cuts anything longer', () => {
    expect(prepareSource('a'.repeat(MAX_SOURCE_CHARS)).truncated).toBe(false)
    const long = prepareSource('a'.repeat(MAX_SOURCE_CHARS + 500))
    expect(long.text).toHaveLength(MAX_SOURCE_CHARS)
    expect(long.total).toBe(MAX_SOURCE_CHARS + 500)
    expect(long.truncated).toBe(true)
  })

  it('counts an emoji as one character and never cuts it in half', () => {
    const source = prepareSource(`${'a'.repeat(MAX_SOURCE_CHARS - 1)}🙂tail`)
    expect(source.total).toBe(MAX_SOURCE_CHARS + 4)
    expect(source.text.endsWith('a🙂')).toBe(true)
    expect(charCount(source.text)).toBe(MAX_SOURCE_CHARS)
    expect(prepareSource('🙂'.repeat(MIN_SOURCE_CHARS)).tooShort).toBe(false)
  })
})

describe('detectLanguage', () => {
  it('detects Russian and English by script', () => {
    expect(detectLanguage('Электронный блок управления — это компьютер')).toBe('ru')
    expect(detectLanguage('The engine control unit is a computer')).toBe('en')
  })

  it('follows the majority in mixed text and defaults to Russian', () => {
    expect(detectLanguage('ЭБУ (ECU) управляет двигателем и читает датчики')).toBe('ru')
    expect(detectLanguage('ECU firmware tuning: правила')).toBe('en')
    expect(detectLanguage('12345 — 678')).toBe('ru')
  })
})
