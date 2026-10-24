import { useState } from 'react'
import type { ReactNode } from 'react'

const failedSources = new Set<string>()

interface FallbackImageProps {
  src: string
  alt: string
  className?: string
  fallback: ReactNode
}

export function FallbackImage({ src, alt, className, fallback }: FallbackImageProps) {
  const [, setFailures] = useState(0)
  if (failedSources.has(src)) return fallback
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => {
        failedSources.add(src)
        setFailures((count) => count + 1)
      }}
    />
  )
}
