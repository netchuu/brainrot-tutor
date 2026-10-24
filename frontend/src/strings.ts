import { MAX_PDF_BYTES, MAX_SOURCE_CHARS, MIN_SOURCE_CHARS } from '@/source'
import type { ErrorCode } from '@/types/contract'

const numberFormat = new Intl.NumberFormat('ru-RU')
const pluralRules = new Intl.PluralRules('ru-RU')

export function formatCount(count: number): string {
  return numberFormat.format(count)
}

function plural(count: number, one: string, few: string, many: string): string {
  const rule = pluralRules.select(count)
  if (rule === 'one') return one
  if (rule === 'few') return few
  return many
}

function chars(count: number): string {
  return `${formatCount(count)} ${plural(count, 'символ', 'символа', 'символов')}`
}

export type FailureKind = ErrorCode | 'network' | 'broken' | 'timeout' | 'unknown'

export const ru = {
  upload: {
    title: 'Brainrot Tutor',
    subtitle: 'Вставь конспект или выбери PDF — получишь короткие видео-уроки, тест и репетитора',
    placeholder: 'Вставь сюда текст лекции, конспекта или статьи…',
    pickPdf: 'Выбрать PDF',
    readingPdf: (page: number, total: number) =>
      total === 0 ? 'Открываем PDF…' : `Читаем PDF… стр. ${String(page)} из ${String(total)}`,
    count: (count: number) => chars(count),
    tooShort: (missing: number) => `Нужно ещё ${chars(missing)} — минимум ${chars(MIN_SOURCE_CHARS)}`,
    truncated: (total: number) => `Используем первую часть текста (${chars(MAX_SOURCE_CHARS)} из ${formatCount(total)})`,
    truncatedPdf: (pagesRead: number, totalPages: number) =>
      `Используем первую часть файла: стр. 1–${String(pagesRead)} из ${String(totalPages)}`,
    language: 'Язык уроков',
    generate: 'Сделать видео-уроки',
    fixtureMode: 'Режим фикстур: сервер не используется',
  },
  pdf: {
    tooBig: `Файл больше ${String(MAX_PDF_BYTES / 1024 / 1024)} МБ. Выбери файл поменьше или вставь текст.`,
    password: 'PDF защищён паролем. Сними пароль или вставь текст.',
    unreadable: 'Не получилось прочитать этот PDF. Вставь текст вручную.',
    noText: 'В этом PDF нет текста — похоже, это скан. Вставь текст вручную.',
  },
  feed: {
    writingScript: 'Пишем сценарий…',
    voicingFirst: 'Озвучиваем первую сцену…',
    close: 'Закрыть',
    retry: 'Повторить',
    editText: 'Изменить текст',
    nextEpisode: 'Следующий эпизод',
    replay: 'Ещё раз',
    newText: 'Новый текст',
  },
  stage: {
    cooking: 'готовим…',
    tapForSound: 'Нажми, чтобы включить звук',
    errorTitle: 'Что-то пошло не так',
    episodeDone: (number: number) => `Эпизод ${String(number)} готов`,
  },
  errors: {
    bad_input: 'Этот текст не подошёл. Проверь его и попробуй снова.',
    too_long: `Текст слишком длинный — сократи его до ${chars(MAX_SOURCE_CHARS)}.`,
    rate_limited: 'Слишком много запросов, попробуй через минуту.',
    llm_unavailable: 'ИИ сейчас недоступен, попробуй ещё раз.',
    internal: 'На сервере что-то сломалось. Попробуй ещё раз.',
    network: 'Нет связи с сервером. Проверь интернет и попробуй снова.',
    broken: 'Поток уроков оборвался. Попробуй ещё раз.',
    timeout: 'Сервер долго молчит. Попробуй ещё раз.',
    unknown: 'Что-то пошло не так при создании урока.',
  } satisfies Record<FailureKind, string>,
}
