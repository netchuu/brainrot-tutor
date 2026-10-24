import { describe, expect, it } from 'vitest'
import { createRenderer, fitScale, FormulaLoadError } from '@/templates/SplitScreen/formulaRenderer'

describe('createRenderer', () => {
  const renderTex = () => undefined

  it('returns the renderer once KaTeX and its fonts are ready', async () => {
    await expect(createRenderer(() => Promise.resolve({ loadFormulaFonts: () => Promise.resolve(), renderTex }))).resolves.toBe(
      renderTex,
    )
  })

  it.each([
    ['a failed chunk or CSS preload', () => Promise.reject(new Error('Unable to preload CSS'))],
    [
      'a font that fails to load',
      () =>
        Promise.resolve({
          loadFormulaFonts: () => Promise.reject(new DOMException('font', 'NetworkError')),
          renderTex,
        }),
    ],
  ])('wraps %s in FormulaLoadError', async (_, load) => {
    await expect(createRenderer(load)).rejects.toBeInstanceOf(FormulaLoadError)
  })
})

describe('fitScale', () => {
  it('shrinks only content wider than the box', () => {
    expect(fitScale(300, 600)).toBe(0.5)
    expect(fitScale(300, 200)).toBe(1)
    expect(fitScale(0, 600)).toBe(1)
  })
})
