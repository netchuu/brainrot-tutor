import { describe, expect, it } from 'vitest'
import { swipeDirection } from '@/player/useSwipe'

describe('swipeDirection', () => {
  it('reads a quick vertical drag as a swipe', () => {
    expect(swipeDirection(5, -120, 200)).toBe('up')
    expect(swipeDirection(-10, 90, 300)).toBe('down')
  })

  it('ignores taps, slow drags and mostly horizontal moves', () => {
    expect(swipeDirection(0, -20, 100)).toBeNull()
    expect(swipeDirection(0, -200, 1500)).toBeNull()
    expect(swipeDirection(150, -90, 200)).toBeNull()
  })
})
