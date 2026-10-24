import { useLayoutEffect, useMemo, useRef } from 'react'
import { activeWordIndex, chunkAt, chunkWords, highlightIndex } from '@/player/captions'
import type { Word } from '@/types/contract'

interface CaptionProps {
  words: Word[]
  highlight: string | null
  timeMs: number
}

export function Caption({ words, highlight, timeMs }: CaptionProps) {
  const chunks = useMemo(() => chunkWords(words), [words])
  const highlighted = useMemo(() => highlightIndex(words, highlight), [words, highlight])
  const chunk = chunkAt(chunks, timeMs)
  const active = activeWordIndex(words, timeMs)
  const ref = useRef<HTMLParagraphElement>(null)
  const chunkStart = chunk?.firstIndex ?? -1

  useLayoutEffect(() => {
    const element = ref.current
    const container = element?.parentElement
    if (!element || !container) return
    const fit = () => {
      element.style.setProperty('--fit', '1')
      const available = element.clientWidth
      const widest = Math.max(0, ...Array.from(element.children, (child) => child.scrollWidth))
      element.style.setProperty('--fit', widest > available && available > 0 ? String(available / widest) : '1')
    }
    fit()
    let mounted = true
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    void document.fonts.ready.then(() => {
      if (mounted) fit()
    })
    return () => {
      mounted = false
      observer.disconnect()
    }
  }, [chunkStart, words])

  if (chunk === undefined) return null
  return (
    <p
      ref={ref}
      className="text-outline flex w-full flex-wrap items-center justify-center gap-x-[0.3em] text-center text-[length:calc(11cqw*var(--fit,1))] leading-[1.08] font-black text-white uppercase"
    >
      {chunk.words.map((word, offset) => {
        const index = chunk.firstIndex + offset
        return (
          <span
            key={index}
            data-highlight={index === highlighted}
            className={`inline-block origin-bottom whitespace-nowrap transition-transform duration-100 ${index === highlighted ? 'text-accent' : ''} ${index === active ? 'scale-105' : ''}`}
          >
            {word.text}
          </span>
        )
      })}
    </p>
  )
}
