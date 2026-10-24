import { MAX_PDF_BYTES, MAX_SOURCE_CHARS, MIN_SOURCE_CHARS } from '@/source'
import type { CharacterId, ErrorCode } from '@/types/contract'

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
    swipeHint: 'или смахни вверх',
  },
  quiz: {
    take: 'Пройти тест',
    loading: 'Готовим тест…',
    progress: (number: number, total: number) => `Вопрос ${String(number)} из ${String(total)}`,
    correct: 'Верно!',
    wrong: 'Не совсем',
    fromText: 'Из текста',
    replayScene: 'Пересмотреть сцену',
    next: 'Дальше',
    results: 'Результат',
    check: 'Проверить',
    skip: 'Пропустить вопрос',
    skipped: 'Вопрос пропущен',
    checking: 'Проверяем…',
    answerPlaceholder: 'Напиши ответ своими словами…',
    reference: 'Эталонный ответ',
    scorePercent: (score: number) => `Оценка: ${String(Math.round(Math.min(1, Math.max(0, score)) * 100))}%`,
    summary: (correct: number, total: number) => `Правильно ${String(correct)} из ${String(total)}`,
    backToQuiz: 'Назад к тесту',
    sceneReplayed: 'Сцена пересмотрена',
    rewatch: 'Пересмотреть эпизод',
  },
  tutor: {
    open: 'Спросить репетитора',
    title: 'Репетитор',
    subtitle: 'Отвечает только по твоему тексту',
    placeholder: 'Спроси что-нибудь по тексту…',
    send: 'Отправить',
    typing: 'Печатает…',
    sources: (count: number) => `Из текста (${String(count)})`,
    suggestions: ['Объясни проще', 'Приведи пример из жизни', 'Что здесь самое важное?'],
    back: 'Назад',
  },
  chat: {
    title: (teacher: string, student: string) => `${teacher} и ${student}`,
    online: 'в сети',
  },
  top3: {
    title: 'ТОП-3',
  },
  myth: {
    question: 'Миф или факт?',
    verdicts: { myth: 'МИФ', fact: 'ФАКТ' },
  },
  characters: {
    professor: 'Профессор',
    mechanic: 'Механик',
    robot: 'Робот',
    kid: 'Малой',
    gamer: 'Геймер',
    cat: 'Кот',
  } satisfies Record<CharacterId, string>,
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
    broken: 'Ответ сервера оборвался. Попробуй ещё раз.',
    timeout: 'Сервер долго молчит. Попробуй ещё раз.',
    unknown: 'Что-то пошло не так. Попробуй ещё раз.',
  } satisfies Record<FailureKind, string>,
}
