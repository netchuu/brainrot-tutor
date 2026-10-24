import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom has no layout APIs; the caption fit only needs them to exist.
if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class {
      observe() {
        return undefined
      }
      disconnect() {
        return undefined
      }
    },
  })
}
if (!('fonts' in document)) {
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() } })
}

afterEach(() => {
  cleanup()
})
