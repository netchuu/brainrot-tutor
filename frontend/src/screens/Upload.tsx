import { useEffect, useMemo, useState } from 'react'
import { fixtureSourceText, USE_FIXTURES } from '@/api/fixtures'
import { extractPdfText, PdfReadError } from '@/pdf/extractText'
import { unlockAudio } from '@/player/audioOutput'
import { preloadSfx } from '@/player/sfx'
import { detectLanguage, MIN_SOURCE_CHARS, prepareSource } from '@/source'
import { ru } from '@/strings'
import { LANGUAGES } from '@/types/contract'
import type { EpisodesRequest, Language, TemplateId } from '@/types/contract'

const EPISODE_COUNT = 3
// Parkour Duo is the only built template; send null (AI picks) once Split Screen exists.
const FORCED_TEMPLATE: TemplateId = 'parkour_duo'

type PdfState =
  | { status: 'idle' }
  | { status: 'reading'; page: number; total: number }
  | { status: 'failed'; message: string }

interface PdfPages {
  read: number
  total: number
}

interface UploadProps {
  initial: EpisodesRequest | null
  onGenerate: (request: EpisodesRequest) => void
}

export function Upload({ initial, onGenerate }: UploadProps) {
  const [text, setText] = useState(initial?.source_text ?? '')
  // Only a manual override survives a return to this screen; otherwise the language is detected again.
  const [chosenLanguage, setChosenLanguage] = useState<Language | null>(() =>
    initial !== null && initial.language !== detectLanguage(initial.source_text) ? initial.language : null,
  )
  const [pdf, setPdf] = useState<PdfState>({ status: 'idle' })
  const [pdfPages, setPdfPages] = useState<PdfPages | null>(null)
  const source = useMemo(() => prepareSource(text), [text])
  const language = chosenLanguage ?? detectLanguage(source.text)
  const reading = pdf.status === 'reading'

  useEffect(() => {
    if (!USE_FIXTURES) return
    let mounted = true
    fixtureSourceText().then(
      (sample) => {
        if (mounted) setText((current) => (current === '' ? sample : current))
      },
      // The sample text is a dev convenience; an empty textarea is the fallback.
      () => undefined,
    )
    return () => {
      mounted = false
    }
  }, [])

  const readPdf = async (file: File) => {
    setPdf({ status: 'reading', page: 0, total: 0 })
    try {
      const extracted = await extractPdfText(file, (page, total) => {
        setPdf({ status: 'reading', page, total })
      })
      setText(extracted.text)
      setPdfPages(
        extracted.pagesRead < extracted.totalPages ? { read: extracted.pagesRead, total: extracted.totalPages } : null,
      )
      setChosenLanguage(null)
      setPdf({ status: 'idle' })
    } catch (error) {
      setPdf({ status: 'failed', message: ru.pdf[error instanceof PdfReadError ? error.reason : 'unreadable'] })
      if (!(error instanceof PdfReadError)) throw error
    }
  }

  const generate = () => {
    if (source.tooShort || reading) return
    unlockAudio()
    void preloadSfx()
    onGenerate({ source_text: source.text, language, episode_count: EPISODE_COUNT, template: FORCED_TEMPLATE })
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header>
        <h1 className="text-3xl font-black uppercase">{ru.upload.title}</h1>
        <p className="mt-1 text-sm text-white/60">{ru.upload.subtitle}</p>
        {USE_FIXTURES && (
          <p className="mt-2 inline-block rounded bg-white/10 px-2 py-1 text-xs text-white/70">{ru.upload.fixtureMode}</p>
        )}
      </header>

      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setPdfPages(null)
        }}
        placeholder={ru.upload.placeholder}
        aria-label={ru.upload.placeholder}
        disabled={reading}
        className="min-h-[36dvh] flex-1 resize-none rounded-2xl bg-white/10 p-4 text-base leading-relaxed text-white placeholder:text-white/40 focus:ring-2 focus:ring-accent focus:outline-none disabled:opacity-50"
      />

      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-bold active:scale-95 has-disabled:opacity-50">
          <span aria-hidden>📄</span>
          {ru.upload.pickPdf}
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={reading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file !== undefined) void readPdf(file)
            }}
          />
        </label>
        <span className="text-sm text-white/60" data-testid="char-count">
          {ru.upload.count(source.total)}
        </span>
      </div>

      {pdf.status === 'reading' && (
        <p role="status" className="text-sm text-accent">
          {ru.upload.readingPdf(pdf.page, pdf.total)}
        </p>
      )}
      {pdf.status === 'failed' && (
        <p role="alert" className="text-sm text-red-300">
          {pdf.message}
        </p>
      )}
      {pdfPages !== null ? (
        <p className="text-sm text-amber-200">{ru.upload.truncatedPdf(pdfPages.read, pdfPages.total)}</p>
      ) : (
        source.truncated && <p className="text-sm text-amber-200">{ru.upload.truncated(source.total)}</p>
      )}
      {source.tooShort && source.total > 0 && (
        <p className="text-sm text-white/60">{ru.upload.tooShort(MIN_SOURCE_CHARS - source.total)}</p>
      )}

      <div className="flex items-center gap-2" role="group" aria-label={ru.upload.language}>
        <span className="text-sm text-white/60">{ru.upload.language}</span>
        {LANGUAGES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={language === option}
            onClick={() => {
              setChosenLanguage(option)
            }}
            className={`rounded-full px-3 py-1 text-sm font-bold uppercase ${language === option ? 'bg-accent text-black' : 'bg-white/10 text-white/70'}`}
          >
            {option}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={source.tooShort || reading}
        onClick={generate}
        className="rounded-full bg-accent py-4 text-lg font-black text-black uppercase shadow-xl active:scale-95 disabled:opacity-40"
      >
        {ru.upload.generate}
      </button>
    </main>
  )
}
