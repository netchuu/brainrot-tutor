import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fitScale, FormulaLoadError, loadRenderer } from '@/templates/SplitScreen/formulaRenderer'

export function Formula({ tex }: { tex: string }) {
  const box = useRef<HTMLDivElement>(null)
  const output = useRef<HTMLDivElement>(null)
  const [renderedTex, setRenderedTex] = useState<string | null>(null)
  const ready = renderedTex === tex

  useEffect(() => {
    let active = true
    loadRenderer().then(
      (render) => {
        const element = output.current
        if (!active || element === null) return
        render(tex, element)
        setRenderedTex(tex)
      },
      (error: unknown) => {
        if (!(error instanceof FormulaLoadError)) throw error
      },
    )
    return () => {
      active = false
    }
  }, [tex])

  useLayoutEffect(() => {
    const boxElement = box.current
    const content = output.current
    if (!ready || boxElement === null || content === null) return
    const fit = () => {
      boxElement.style.setProperty('--fit', '1')
      boxElement.style.setProperty('--fit', String(fitScale(content.clientWidth, content.scrollWidth)))
    }
    fit()
    let mounted = true
    const observer = new ResizeObserver(fit)
    observer.observe(boxElement)
    void document.fonts.ready.then(() => {
      if (mounted) fit()
    })
    return () => {
      mounted = false
      observer.disconnect()
    }
  }, [ready])

  return (
    <div
      ref={box}
      data-testid="formula"
      className="w-full overflow-hidden rounded-[4cqw] bg-white px-[4cqw] py-[3cqw] text-center text-[length:calc(7cqw*var(--fit,1))] text-black shadow-2xl"
    >
      <div ref={output} data-testid="formula-output" className={ready ? '' : 'hidden'} />
      {!ready && <code className="font-mono text-[4cqw] break-all text-black/70">{tex}</code>}
    </div>
  )
}
