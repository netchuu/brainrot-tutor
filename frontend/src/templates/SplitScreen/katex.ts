import katex from 'katex'
import 'katex/dist/katex.min.css'

const MAX_SIZE_EM = 10
const MAX_EXPAND = 100

// Model-written TeX is untrusted: trust stays false and size and macro expansion are capped.
export function renderTex(tex: string, element: HTMLElement): void {
  katex.render(tex, element, {
    throwOnError: false,
    displayMode: true,
    maxSize: MAX_SIZE_EM,
    maxExpand: MAX_EXPAND,
  })
}

// KaTeX fonts use font-display: block, so wait for them before swapping the TeX source for glyphs.
export async function loadFormulaFonts(): Promise<void> {
  await document.fonts.load('1em KaTeX_Main')
  await document.fonts.load('italic 1em KaTeX_Math')
}
