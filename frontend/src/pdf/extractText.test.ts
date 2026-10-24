import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPdfText, joinPages, PdfReadError, textFromItems } from '@/pdf/extractText'
import { charCount, MAX_PDF_BYTES, MAX_SOURCE_CHARS } from '@/source'

const pdfjs = vi.hoisted(() => {
  let task: unknown = null
  return {
    use(next: unknown) {
      task = next
    },
    getDocument: () => task,
  }
})

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdfjs.getDocument,
}))

const destroy = vi.fn(() => Promise.resolve())
const SOFT_HYPHEN = String.fromCodePoint(0xad)

function loads(pages: string[]) {
  pdfjs.use({
    destroy,
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: (number: number) =>
        Promise.resolve({
          cleanup: () => undefined,
          getTextContent: () => Promise.resolve({ items: [{ str: pages[number - 1] ?? '', hasEOL: true }] }),
        }),
    }),
  })
}

function failsWith(name: string) {
  const error = new Error('pdf.js failure')
  error.name = name
  pdfjs.use({ destroy, promise: Promise.reject(error) })
}

function pdfFile(): File {
  return new File(['%PDF-1.7'], 'lecture.pdf', { type: 'application/pdf' })
}

beforeEach(() => {
  destroy.mockClear()
})

describe('textFromItems', () => {
  it('joins text items, breaks lines on hasEOL and skips marked content', () => {
    const items = [
      { type: 'beginMarkedContent' },
      { str: 'Электронный блок', hasEOL: false },
      { str: ' управления', hasEOL: true },
      { str: '(ЭБУ)', hasEOL: false },
      { type: 'endMarkedContent' },
    ]
    expect(textFromItems(items)).toBe('Электронный блок управления\n(ЭБУ)')
  })

  it('returns an empty string for a page without text', () => {
    expect(textFromItems([])).toBe('')
  })
})

describe('joinPages', () => {
  it('rejoins words hyphenated at a line end and drops soft hyphens', () => {
    expect(joinPages([`работой дви-\nгателя и ре${SOFT_HYPHEN}жимами`, 'Ньютон-\nМетр'])).toBe(
      'работой двигателя и режимами\n\nНьютон-\nМетр',
    )
  })

  it('separates pages, collapses spaces and trims blank lines', () => {
    expect(joinPages(['Первая   страница \n', '', `  Вторая${String.fromCodePoint(0xa0)}страница  `])).toBe(
      'Первая страница\n\nВторая страница',
    )
  })
})

describe('extractPdfText', () => {
  it('rejects files over the size limit before loading pdf.js', async () => {
    const file = pdfFile()
    Object.defineProperty(file, 'size', { value: MAX_PDF_BYTES + 1 })
    await expect(extractPdfText(file, () => undefined)).rejects.toMatchObject({ reason: 'tooBig' })
  })

  it('reads every page, reports progress and frees the document', async () => {
    loads(['Первая страница', 'Вторая страница'])
    const progress: [number, number][] = []
    const result = await extractPdfText(pdfFile(), (page, total) => progress.push([page, total]))
    expect(result).toEqual({ text: 'Первая страница\n\nВторая страница', pagesRead: 2, totalPages: 2 })
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('stops reading once the text reaches the source limit', async () => {
    loads(Array.from({ length: 5 }, () => 'а'.repeat(25_000)))
    const result = await extractPdfText(pdfFile(), () => undefined)
    expect(result.pagesRead).toBe(3)
    expect(result.totalPages).toBe(5)
    expect(charCount(result.text)).toBeGreaterThanOrEqual(MAX_SOURCE_CHARS)
  })

  it.each([
    ['PasswordException', 'password'],
    ['InvalidPDFException', 'unreadable'],
  ])('maps %s to %s and frees the document', async (name, reason) => {
    failsWith(name)
    const failure = extractPdfText(pdfFile(), () => undefined)
    await expect(failure).rejects.toBeInstanceOf(PdfReadError)
    await expect(failure).rejects.toMatchObject({ reason })
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('reports a PDF without a text layer', async () => {
    loads(['', '  '])
    await expect(extractPdfText(pdfFile(), () => undefined)).rejects.toMatchObject({ reason: 'noText' })
  })
})
