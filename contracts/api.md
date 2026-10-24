# API contract

Source of truth for both sides. Machine-readable version: `schemas/contract.schema.json` (`$defs` names in brackets below). Example data: `fixtures/`. Validate with `uv run --with jsonschema python contracts/tools/validate.py`.

- Base path `/api`. JSON in, JSON or NDJSON out. Field names are snake_case on both sides.
- Streams use `Content-Type: application/x-ndjson`: one JSON object per line, `\n` after each, flushed as soon as it is ready.
- The backend is stateless. The client keeps the source text and sends it with each call.
- Limits: `source_text` 200–60,000 characters. Above that the client tells the user and sends the first 60,000 (it says so on screen); the backend answers `too_long` and never truncates silently.

## Enums

| Name | Values |
|---|---|
| Language | `ru`, `en` |
| TemplateId | `parkour_duo`, `split_screen`, `fake_chat`, `top3_countdown`, `myth_or_fact` |
| Speaker | `teacher`, `student` |
| CharacterId | `professor`, `mechanic`, `robot`, `kid`, `gamer`, `cat` |
| BackgroundId | `parkour`, `surf`, `runner`, `satisfying` |
| Reaction | `none`, `mind_blown`, `shocked`, `laugh`, `thinking`, `fire`, `check`, `cross` |
| Sfx | `none`, `whoosh`, `pop`, `boom`, `drumroll`, `ding`, `buzzer` |
| ErrorCode | `bad_input`, `too_long`, `rate_limited`, `llm_unavailable`, `internal` |

Enum values are also the asset file names: `stickers/<reaction>.png`, `sfx/<sfx>.mp3`, `mascots/<character>-<pose>.png` (pose `neutral`, `shocked`, `pointing`), `backgrounds/<background>-<n>.mp4` (the player may rotate between the numbered clips of one background).

## POST /api/episodes/stream

Request [`EpisodesRequest`]:

```json
{"source_text": "…", "language": "ru", "episode_count": 3, "template": null}
```

`template: null` lets the AI choose per episode; a value forces that template for all episodes.

Response: NDJSON [`StreamEvent`], always in this order:

1. one `plan` [`PlanEvent`]: course title and the outline of every episode
2. for each episode in index order: its `scene` events [`SceneEvent`] in index order, then `episode_done` [`EpisodeDoneEvent`]
3. one `done` [`DoneEvent`]

An `error` [`ErrorEvent`] can replace any event; it is always the last line.

```json
{"type": "plan", "course_title": "Чип-тюнинг ЭБУ за 3 минуты", "language": "ru", "episodes": [{"index": 0, "title": "ЭБУ — мозг машины", "template": "parkour_duo", "scene_count": 4, "cast": {"teacher": "professor", "student": "kid"}, "background": "parkour"}]}
{"type": "scene", "episode": 0, "index": 0, "scene": {"id": "e0s0", "speaker": "teacher", "text": "Представь, что у машины есть мозг.", "highlight": "мозг", "words": [{"text": "Представь", "start_ms": 100, "end_ms": 650}], "words_estimated": false, "audio": {"mime": "audio/mpeg", "base64": "…", "duration_ms": 3400}, "picture": {"query": "car engine control unit", "url": "https://…", "credit": "Photo by … on Pexels"}, "formula": null, "term": null, "rank": null, "verdict": null, "reaction": "mind_blown", "sfx": "whoosh", "source_quote": "Электронный блок управления (ЭБУ) — это компьютер, …"}}
{"type": "episode_done", "episode": 0}
{"type": "done", "elapsed_ms": 9120}
```

### Cast and background [`EpisodeOutline`, `Cast`]

- Each episode in `plan` names its `cast` (which character plays the `teacher` and the `student` role) and its `background` clip.
- The backend picks both and varies them between the episodes of one course. A scene's `speaker` is the role; the character speaking it is `cast[speaker]`.
- Each character has its own voice, chosen by the backend; the frontend shows that character's mascot.
- `split_screen` episodes use the `satisfying` background; other templates use gameplay backgrounds (`parkour`, `surf`, `runner`).

### Scene fields [`Scene`]

| Field | Type | Meaning |
|---|---|---|
| `id` | string `e<episode>s<index>` | Stable id; quiz questions point to it |
| `speaker` | Speaker | Which mascot or chat side talks |
| `text` | string ≤ 220 chars | The spoken line, exactly what the voice reads |
| `highlight` | string or null | One word from `text`, shown in the accent colour |
| `words` | Word[] | Every spoken word with `start_ms` / `end_ms` from the start of this scene's audio |
| `words_estimated` | boolean | `true` when timings were estimated because voice failed |
| `audio` | Audio or null | Base64 MP3 and its duration; null when voice failed (play captions on estimated timings) |
| `picture` | Picture or null | Pexels result with credit; null when none was found |
| `formula` | string or null | TeX for `split_screen` |
| `term` | string or null | Term card text for `split_screen` |
| `rank` | 1–3 or null | Only for `top3_countdown` |
| `verdict` | `myth`, `fact` or null | Only for `myth_or_fact` |
| `reaction` | Reaction | Sticker to pop in |
| `sfx` | Sfx | Sound to play when the scene starts |
| `source_quote` | string or null | Verbatim sentence from `source_text` that backs the line; null only for questions or jokes with no fact |

Rules the backend guarantees:

- `source_quote`, when not null, appears in `source_text` (compared after collapsing whitespace).
- `highlight`, when not null, appears in `text`.
- `words` are the spoken words of `text` in order; punctuation is not included. Timing values are integer milliseconds.
- Scenes of an episode may be generated concurrently but are always emitted in index order.

## POST /api/quiz

Request [`QuizRequest`]: source text, language, `question_count` (3–5, default 4) and the episode's scenes (`id`, `text`, `source_quote`). Limits: at most 8 scenes, `title` ≤ 200 characters, scene `text` ≤ 220, scene `source_quote` ≤ 500 (the episode stream's own values always fit).

Response [`QuizResponse`]: 3–5 questions, at most one `open`.

```json
{"episode": 0, "questions": [
  {"id": "q1", "kind": "single_choice", "prompt": "Что такое ЭБУ?", "options": ["Датчик", "Тип топлива", "Компьютер, который управляет двигателем", "Коробка передач"], "answer_index": 2, "explanation": "…", "source_quote": "…", "scene_id": "e0s0"},
  {"id": "q4", "kind": "open", "prompt": "…", "reference_answer": "…", "source_quote": "…", "scene_id": "e0s2"}
]}
```

The answer is included on purpose: grading single-choice happens in the browser.

## POST /api/quiz/grade

Request [`GradeRequest`]: `{"language": "ru", "question": <OpenQuestion>, "answer": "…"}`. Limits: `answer` ≤ 1,000 characters; the open question's `prompt`, `reference_answer` and `source_quote` ≤ 500 each (the quiz's own values always fit).
Response [`GradeResponse`]: `{"correct": true, "score": 0.8, "feedback": "…"}`. `correct` is `score >= 0.6`.

Fixture: `fixtures/grade.json` is the response for the open question `q4` of `fixtures/quiz.json`.

## POST /api/tutor

Request [`TutorRequest`]: source text, language, and the chat so far (`messages`, last one from `user`, at most 20).
Response: NDJSON [`TutorEvent`]: `delta` events with text pieces, then one `done` with the `source_quotes` used. The tutor answers only from `source_text`; if the text does not cover the question it says so.

## GET /api/health

`{"status": "ok"}`

## Errors

- Non-stream endpoints: HTTP 4xx/5xx with [`ErrorResponse`] `{"error": {"code": "too_long", "message": "…", "retryable": false}}`.
- Streams: an `error` event as the last line (HTTP status stays 200 once streaming started).
- `rate_limited` and `llm_unavailable` are `retryable: true`; the client offers a retry button.
- Voice or picture failures are not errors: the scene comes with `audio: null` or `picture: null`.
