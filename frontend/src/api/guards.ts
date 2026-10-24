import {
  BACKGROUND_IDS,
  CHARACTER_IDS,
  ERROR_CODES,
  LANGUAGES,
  REACTIONS,
  SFX,
  SPEAKERS,
  TEMPLATE_IDS,
  VERDICTS,
} from '@/types/contract'
import type {
  Audio,
  Cast,
  EpisodeOutline,
  ErrorResponse,
  Picture,
  Scene,
  StreamEvent,
  Word,
} from '@/types/contract'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return values.some((candidate) => candidate === value)
}

function isNullable<T>(value: unknown, guard: (candidate: unknown) => candidate is T): value is T | null {
  return value === null || guard(value)
}

function isWord(value: unknown): value is Word {
  return isObject(value) && isString(value.text) && isNonNegativeInteger(value.start_ms) && isNonNegativeInteger(value.end_ms)
}

function isAudio(value: unknown): value is Audio {
  return (
    isObject(value) &&
    value.mime === 'audio/mpeg' &&
    isString(value.base64) &&
    isNonNegativeInteger(value.duration_ms)
  )
}

function isPicture(value: unknown): value is Picture {
  return isObject(value) && isString(value.query) && isString(value.url) && isString(value.credit)
}

function isRank(value: unknown): value is Scene['rank'] {
  return value === null || value === 1 || value === 2 || value === 3
}

// Structural checks only: length and pattern limits are the backend's job and must not drop a playable scene.
function isScene(value: unknown): value is Scene {
  return (
    isObject(value) &&
    isString(value.id) &&
    isOneOf(SPEAKERS, value.speaker) &&
    isString(value.text) &&
    isNullable(value.highlight, isString) &&
    Array.isArray(value.words) &&
    value.words.every(isWord) &&
    typeof value.words_estimated === 'boolean' &&
    isNullable(value.audio, isAudio) &&
    isNullable(value.picture, isPicture) &&
    isNullable(value.formula, isString) &&
    isNullable(value.term, isString) &&
    isRank(value.rank) &&
    (value.verdict === null || isOneOf(VERDICTS, value.verdict)) &&
    isOneOf(REACTIONS, value.reaction) &&
    isOneOf(SFX, value.sfx) &&
    isNullable(value.source_quote, isString)
  )
}

function isCast(value: unknown): value is Cast {
  return isObject(value) && isOneOf(CHARACTER_IDS, value.teacher) && isOneOf(CHARACTER_IDS, value.student)
}

function isEpisodeOutline(value: unknown): value is EpisodeOutline {
  return (
    isObject(value) &&
    isNonNegativeInteger(value.index) &&
    isString(value.title) &&
    isOneOf(TEMPLATE_IDS, value.template) &&
    isNonNegativeInteger(value.scene_count) &&
    isCast(value.cast) &&
    isOneOf(BACKGROUND_IDS, value.background)
  )
}

export function isStreamEvent(value: unknown): value is StreamEvent {
  if (!isObject(value)) return false
  switch (value.type) {
    case 'plan':
      return (
        isString(value.course_title) &&
        isOneOf(LANGUAGES, value.language) &&
        Array.isArray(value.episodes) &&
        value.episodes.every(isEpisodeOutline)
      )
    case 'scene':
      return isNonNegativeInteger(value.episode) && isNonNegativeInteger(value.index) && isScene(value.scene)
    case 'episode_done':
      return isNonNegativeInteger(value.episode)
    case 'done':
      return isNonNegativeInteger(value.elapsed_ms)
    case 'error':
      return isOneOf(ERROR_CODES, value.code) && isString(value.message) && typeof value.retryable === 'boolean'
    default:
      return false
  }
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!isObject(value) || !isObject(value.error)) return false
  const { code, message, retryable } = value.error
  return isOneOf(ERROR_CODES, code) && isString(message) && typeof retryable === 'boolean'
}
