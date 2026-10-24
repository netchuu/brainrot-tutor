import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { charCount, MAX_PDF_BYTES, MAX_SOURCE_CHARS } from '@/source'

export type PdfFailure = 'tooBig' | 'password' | 'unreadable' | 'noText'

export class PdfReadError extends Error {
  readonly reason: PdfFailure

  constructor(reason: PdfFailure, options?: ErrorOptions) {
    super(`PDF could not be read: ${reason}`, options)
    this.name = 'PdfReadError'
    this.reason = reason
  }
}

export interface PdfText {
  text: string
  pagesRead: number
  totalPages: number
}

type TextPart = { str: string; hasEOL: boolean } | { type: string }

const SOFT_HYPHEN = new RegExp(String.fromCodePoint(0xad), 'g')

export function textFromItems(items: readonly TextPart[]): string {
  let text = ''
  for (const item of items) {
    if (!('str' in item)) continue
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text
}

// Rejoins words a textbook hyphenated at a line end, so quotes from the text match what the reader sees.
export function joinPages(pages: readonly string[]): string {
  return pages
    .join('\n\n')
    .replace(SOFT_HYPHEN, '')
    .replace(/(\p{Ll})-[ \t]*\n[ \t]*(\p{Ll})/gu, '$1$2')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toPdfError(error: unknown): PdfReadError {
  if (error instanceof Error && error.name === 'PasswordException') return new PdfReadError('password', { cause: error })
  if (error instanceof Error && error.name === 'InvalidPDFException') return new PdfReadError('unreadable', { cause: error })
  throw error
}

// The legacy build polyfills Promise.try and other APIs that older iPhones lack.
export async function extractPdfText(file: File, onProgress: (page: number, total: number) => void): Promise<PdfText> {
  if (file.size > MAX_PDF_BYTES) throw new PdfReadError('tooBig')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const pdf = await task.promise.catch((error: unknown) => {
      throw toPdfError(error)
    })
    const pages: string[] = []
    let text = ''
    while (pages.length < pdf.numPages && charCount(text) < MAX_SOURCE_CHARS) {
      onProgress(pages.length + 1, pdf.numPages)
      const page = await pdf.getPage(pages.length + 1)
      pages.push(textFromItems((await page.getTextContent()).items))
      page.cleanup()
      text = joinPages(pages)
    }
    if (text === '') throw new PdfReadError('noText')
    return { text, pagesRead: pages.length, totalPages: pdf.numPages }
  } finally {
    await task.destroy()
  }
}
