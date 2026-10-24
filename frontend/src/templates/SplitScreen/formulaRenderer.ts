export type Renderer = (tex: string, element: HTMLElement) => void

let pending: Promise<Renderer> | null = null

export function loadRenderer(): Promise<Renderer> {
  pending ??= import('@/templates/SplitScreen/katex').then(async ({ loadFormulaFonts, renderTex }) => {
    await loadFormulaFonts()
    return renderTex
  })
  return pending
}

// Starts fetching KaTeX and its fonts before the first formula scene needs them.
export function warmRenderer(): void {
  loadRenderer().catch((error: unknown) => {
    pending = null
    if (!(error instanceof TypeError)) throw error
  })
}

export function fitScale(available: number, needed: number): number {
  return needed > available && available > 0 ? available / needed : 1
}
