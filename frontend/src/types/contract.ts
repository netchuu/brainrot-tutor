export const LANGUAGES = ['ru', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const TEMPLATE_IDS = ['parkour_duo', 'split_screen', 'fake_chat', 'top3_countdown', 'myth_or_fact'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export const SPEAKERS = ['teacher', 'student'] as const
export type Speaker = (typeof SPEAKERS)[number]

export const REACTIONS = ['none', 'mind_blown', 'shocked', 'laugh', 'thinking', 'fire', 'check', 'cross'] as const
export type Reaction = (typeof REACTIONS)[number]

export const SFX = ['none', 'whoosh', 'pop', 'boom', 'drumroll', 'ding', 'buzzer'] as const
export type Sfx = (typeof SFX)[number]

export const ERROR_CODES = ['bad_input', 'too_long', 'rate_limited', 'llm_unavailable', 'internal'] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export const VERDICTS = ['myth', 'fact'] as const
export type Verdict = (typeof VERDICTS)[number]

export interface Word {
  text: string
  start_ms: number
  end_ms: number
}

export interface Audio {
  mime: 'audio/mpeg'
  base64: string
  duration_ms: number
}

export interface Picture {
  query: string
  url: string
  credit: string
}

export interface Scene {
  id: string
  speaker: Speaker
  text: string
  highlight: string | null
  words: Word[]
  words_estimated: boolean
  audio: Audio | null
  picture: Picture | null
  formula: string | null
  term: string | null
  rank: 1 | 2 | 3 | null
  verdict: Verdict | null
  reaction: Reaction
  sfx: Sfx
  source_quote: string | null
}

export interface EpisodeOutline {
  index: number
  title: string
  template: TemplateId
  scene_count: number
}

export interface PlanEvent {
  type: 'plan'
  course_title: string
  language: Language
  episodes: EpisodeOutline[]
}

export interface SceneEvent {
  type: 'scene'
  episode: number
  index: number
  scene: Scene
}

export interface EpisodeDoneEvent {
  type: 'episode_done'
  episode: number
}

export interface DoneEvent {
  type: 'done'
  elapsed_ms: number
}

export interface ErrorEvent {
  type: 'error'
  code: ErrorCode
  message: string
  retryable: boolean
}

export type StreamEvent = PlanEvent | SceneEvent | EpisodeDoneEvent | DoneEvent | ErrorEvent

export interface EpisodesRequest {
  source_text: string
  language: Language
  episode_count?: number
  template?: TemplateId | null
}

export interface QuizSceneRef {
  id: string
  text: string
  source_quote: string | null
}

export interface QuizRequest {
  source_text: string
  language: Language
  question_count?: number
  episode: {
    index: number
    title: string
    scenes: QuizSceneRef[]
  }
}

export interface SingleChoiceQuestion {
  id: string
  kind: 'single_choice'
  prompt: string
  options: [string, string, string, string]
  answer_index: 0 | 1 | 2 | 3
  explanation: string
  source_quote: string
  scene_id: string | null
}

export interface OpenQuestion {
  id: string
  kind: 'open'
  prompt: string
  reference_answer: string
  source_quote: string
  scene_id: string | null
}

export type Question = SingleChoiceQuestion | OpenQuestion

export interface QuizResponse {
  episode: number
  questions: Question[]
}

export interface GradeRequest {
  language: Language
  question: OpenQuestion
  answer: string
}

export interface GradeResponse {
  correct: boolean
  score: number
  feedback: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TutorRequest {
  source_text: string
  language: Language
  messages: ChatMessage[]
}

export interface TutorDeltaEvent {
  type: 'delta'
  text: string
}

export interface TutorDoneEvent {
  type: 'done'
  source_quotes: string[]
}

export type TutorEvent = TutorDeltaEvent | TutorDoneEvent | ErrorEvent

export interface ErrorResponse {
  error: {
    code: ErrorCode
    message: string
    retryable: boolean
  }
}

export interface HealthResponse {
  status: 'ok'
}
