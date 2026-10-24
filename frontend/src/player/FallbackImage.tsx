import { useState } from 'react'
import type { ReactNode } from 'react'
import { isLocalAsset } from '@/assets'

// Only our own asset files are remembered as missing; a remote picture may fail transiently and gets retried.
const missingAssets = new Set<string>()

interface FallbackImageProps {
  src: string
  alt: string
  className?: string
  fallback: ReactNode
  children?: ReactNode
}

export function FallbackImage({ src, alt, className, fallback, children }: FallbackImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src || missingAssets.has(src)) return fallback
  return (
    <>
      <img
        src={src}
        alt={alt}
        className={className}
        draggable={false}
        onError={() => {
          if (isLocalAsset(src)) missingAssets.add(src)
          setFailedSrc(src)
        }}
      />
      {children}
    </>
  )
}
