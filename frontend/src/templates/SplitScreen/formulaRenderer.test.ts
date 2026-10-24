import { describe, expect, it } from 'vitest'
import { fitScale } from '@/templates/SplitScreen/formulaRenderer'

describe('fitScale', () => {
  it('shrinks only content wider than the box', () => {
    expect(fitScale(300, 600)).toBe(0.5)
    expect(fitScale(300, 200)).toBe(1)
    expect(fitScale(0, 600)).toBe(1)
  })
})
