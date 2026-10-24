import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPdfText, PdfReadError } from '@/pdf/extractText'
import type { PdfFailure, PdfText } from '@/pdf/extractText'
import { unlockAudio } from '@/player/audioOutput'
import { Upload } from '@/screens/Upload'
import { MAX_SOURCE_CHARS } from '@/source'
import { ru } from '@/strings'
import type { EpisodesRequest } from '@/types/contract'

vi.mock('@/pdf/extractText', async (importOriginal) => ({ ...(await importOriginal<object>()), extractPdfText: vi.fn() }))
vi.mock('@/player/audioOutput', () => ({ unlockAudio: vi.fn() }))
vi.mock('@/player/sfx', () => ({ preloadSfx: vi.fn(() => Promise.resolve()) }))
vi.mock('@/api/fixtures', async (importOriginal) => ({ ...(await importOriginal<object>()), USE_FIXTURES: false }))

const RUSSIAN = 'Электронный блок управления — это компьютер, который управляет работой двигателя. '.repeat(4).trim()
const ENGLISH = 'The engine control unit is a computer that runs the engine and reads its sensors. '.repeat(4).trim()

const onGenerate = vi.fn<(request: EpisodesRequest) => void>()

function typeText(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
}

function generateButton() {
  return screen.getByRole('button', { name: ru.upload.generate })
}

function lastRequest(): EpisodesRequest | undefined {
  return onGenerate.mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  onGenerate.mockReset()
  vi.mocked(unlockAudio).mockClear()
  vi.mocked(extractPdfText).mockReset()
})

describe('Upload', () => {
  it('keeps Generate disabled until the text has 200 characters', () => {
    render(<Upload initial={null} onGenerate={onGenerate} />)
    expect(generateButton()).toBeDisabled()
    typeText('Слишком коротко')
    expect(screen.getByText(ru.upload.tooShort(200 - 'Слишком коротко'.length))).toBeInTheDocument()
    typeText(RUSSIAN)
    expect(generateButton()).toBeEnabled()
    expect(screen.getByTestId('char-count')).toHaveTextContent(ru.upload.count(RUSSIAN.length))
  })

  it('unlocks audio in the tap and sends the request with the detected language', () => {
    render(<Upload initial={null} onGenerate={onGenerate} />)
    typeText(`  ${RUSSIAN}  `)
    fireEvent.click(generateButton())
    expect(lastRequest()).toEqual({ source_text: RUSSIAN, language: 'ru', episode_count: 3, template: 'parkour_duo' })
    const unlockOrder = vi.mocked(unlockAudio).mock.invocationCallOrder[0] ?? Infinity
    const generateOrder = onGenerate.mock.invocationCallOrder[0] ?? -Infinity
    expect(unlockOrder).toBeLessThan(generateOrder)
  })

  it('lets the user override the detected language', () => {
    render(<Upload initial={null} onGenerate={onGenerate} />)
    typeText(ENGLISH)
    expect(screen.getByRole('button', { name: 'en' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'ru' }))
    fireEvent.click(generateButton())
    expect(lastRequest()?.language).toBe('ru')
  })

  it('says when it uses only the first part and sends 60,000 characters', () => {
    render(<Upload initial={null} onGenerate={onGenerate} />)
    typeText('б'.repeat(MAX_SOURCE_CHARS + 1234))
    expect(screen.getByText(ru.upload.truncated(MAX_SOURCE_CHARS + 1234).replace(/\s+/g, ' '))).toBeInTheDocument()
    fireEvent.click(generateButton())
    expect(lastRequest()?.source_text).toHaveLength(MAX_SOURCE_CHARS)
  })

  it('fills the text from a PDF and reports progress', async () => {
    let finish: (result: PdfText) => void = () => undefined
    vi.mocked(extractPdfText).mockImplementation((_, onProgress) => {
      onProgress(1, 2)
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    render(<Upload initial={null} onGenerate={onGenerate} />)
    const file = new File(['%PDF'], 'lecture.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText(new RegExp(ru.upload.pickPdf)), { target: { files: [file] } })
    expect(await screen.findByRole('status')).toHaveTextContent(ru.upload.readingPdf(1, 2))
    expect(generateButton()).toBeDisabled()
    finish({ text: RUSSIAN, pagesRead: 2, totalPages: 2 })
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue(RUSSIAN)
    })
    expect(screen.queryByText(/Используем первую часть/)).not.toBeInTheDocument()
    expect(vi.mocked(extractPdfText).mock.calls[0]?.[0]).toBe(file)
  })

  it('says which pages it used when the PDF was longer than the limit', async () => {
    vi.mocked(extractPdfText).mockResolvedValue({ text: RUSSIAN, pagesRead: 40, totalPages: 312 })
    render(<Upload initial={null} onGenerate={onGenerate} />)
    const file = new File(['%PDF'], 'book.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText(new RegExp(ru.upload.pickPdf)), { target: { files: [file] } })
    expect(await screen.findByText(ru.upload.truncatedPdf(40, 312))).toBeInTheDocument()
    typeText(ENGLISH)
    expect(screen.queryByText(ru.upload.truncatedPdf(40, 312))).not.toBeInTheDocument()
  })

  it.each<PdfFailure>(['tooBig', 'password', 'unreadable', 'noText'])('explains a %s PDF in Russian', async (reason) => {
    vi.mocked(extractPdfText).mockRejectedValue(new PdfReadError(reason))
    render(<Upload initial={null} onGenerate={onGenerate} />)
    const file = new File(['%PDF'], 'lecture.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText(new RegExp(ru.upload.pickPdf)), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(ru.pdf[reason])
  })

  it('restores the previous text and a manual language override when coming back', () => {
    const initial: EpisodesRequest = { source_text: ENGLISH, language: 'ru', episode_count: 3, template: 'parkour_duo' }
    render(<Upload initial={initial} onGenerate={onGenerate} />)
    expect(screen.getByRole('textbox')).toHaveValue(ENGLISH)
    expect(screen.getByRole('button', { name: 'ru' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('detects the language again after coming back without an override', () => {
    const initial: EpisodesRequest = { source_text: RUSSIAN, language: 'ru', episode_count: 3, template: 'parkour_duo' }
    render(<Upload initial={initial} onGenerate={onGenerate} />)
    typeText(ENGLISH)
    expect(screen.getByRole('button', { name: 'en' })).toHaveAttribute('aria-pressed', 'true')
  })
})
