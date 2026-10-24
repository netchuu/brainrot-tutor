import { useRef } from 'react'
import type { PointerEvent } from 'react'

const MIN_DISTANCE_PX = 60
const MAX_DURATION_MS = 800

export type SwipeDirection = 'up' | 'down'

export function swipeDirection(dx: number, dy: number, durationMs: number): SwipeDirection | null {
  if (durationMs > MAX_DURATION_MS || Math.abs(dy) < MIN_DISTANCE_PX || Math.abs(dy) < Math.abs(dx) * 1.5) return null
  return dy < 0 ? 'up' : 'down'
}

export function useSwipe(onSwipe: ((direction: SwipeDirection) => void) | undefined) {
  const start = useRef<{ x: number; y: number; time: number } | null>(null)
  return {
    onPointerDown: (event: PointerEvent) => {
      start.current = { x: event.clientX, y: event.clientY, time: event.timeStamp }
    },
    onPointerUp: (event: PointerEvent) => {
      const from = start.current
      start.current = null
      if (from === null || onSwipe === undefined) return
      const direction = swipeDirection(event.clientX - from.x, event.clientY - from.y, event.timeStamp - from.time)
      if (direction !== null) onSwipe(direction)
    },
    onPointerCancel: () => {
      start.current = null
    },
  }
}
