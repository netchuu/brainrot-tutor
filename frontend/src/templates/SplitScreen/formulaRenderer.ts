export type Renderer = (tex: string, element: HTMLElement) => void

export class FormulaLoadError extends Error {
  override name = 'FormulaLoadError'
}

type Loader = () => Promise<{ loadFormulaFonts: () => Promise<void>; renderTex: Renderer }>

const loadKatex: Loader = () => import('@/templates/SplitScreen/katex')

let pending: Promise<Renderer> | null = null

// Any failure here (chunk, its CSS preload, or a KaTeX font) leaves the TeX source on screen.
export async function createRenderer(load: Loader): Promise<Renderer> {
  try {
    const { loadFormulaFonts, renderTex } = await load()
    await loadFormulaFonts()
    return renderTex
  } catch (error) {
    throw new FormulaLoadError('KaTeX could not be loaded', { cause: error })
  }
}

export function loadRenderer(): Promise<Renderer> {
  pending ??= createRenderer(loadKatex).catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}

// Starts fetching KaTeX and its fonts before the first formula scene needs them.
export function warmRenderer(): void {
  loadRenderer().catch((error: unknown) => {
    if (!(error instanceof FormulaLoadError)) throw error
  })
}

export function fitScale(available: number, needed: number): number {
  return needed > available && available > 0 ? available / needed : 1
}
