# Backend agent: plan and rules

You own `backend/`. Before your first change read: the root `CLAUDE.md`, `contracts/api.md`, and this file to the end. Do not edit `frontend/`, `contracts/` or `docs/PLAN.md`. Shared rules (`.claude/rules/general.md`) apply too; the ones that matter most are repeated here.

## Rules

### Context7 first (mandatory)
- Before writing or changing code that calls any third-party library, look it up with Context7 MCP: `mcp__context7__resolve-library-id`, then `mcp__context7__query-docs` with a specific question
- Use the exact signatures from the docs, not from memory; if docs and memory disagree, the docs win
- Look up at least: FastAPI (`StreamingResponse`, lifespan, CORS), Pydantic v2 and pydantic-settings, google-genai (async client, structured output with a response schema), groq (async client, JSON mode), edge-tts (`Communicate`, `boundary="WordBoundary"`, rate and pitch), httpx (`AsyncClient`, timeouts), pytest-asyncio, respx, ruff, mypy, Vercel FastAPI deployment
- If the `mcp__context7__*` tools are missing, stop and tell the user (setup line in the root CLAUDE.md)

### Communication and scope
- Direct, concise; no preambles or apologies; evaluate a proposed solution against alternatives before implementing it
- Edit only `backend/`; report issues elsewhere instead of fixing them
- Build only what this plan lists; no extra features, no unrelated refactors
- Contract changes: stop and ask the user (process in `.claude/rules/general.md`)

### Python
- Python 3.12, FastAPI, Pydantic v2 + pydantic-settings, uv for everything (`uv add`, `uv run`)
- async/await always; no blocking I/O in request paths (no `requests`, no `time.sleep`, no sync SDK clients)
- Absolute imports only (`from app.services.narrator import narrate_scene`); no relative imports; no imports inside functions
- Type hints on every function and return; no `Any` unless a library forces it
- No docstrings; a comment only for a non-obvious why, one line; no TODO or FIXME
- Specific exceptions only, defined in `app/errors.py` (`LlmUnavailableError`, `RateLimitedError`, `SourceTooLongError`), each mapped to a contract `ErrorCode`; catch only what you handle
- Secrets only from env via `app/config.py`; never log keys or full source texts; never open `.env`

### Architecture
API route (thin: validate, call one service, shape the response) → service (logic) → client (one external API each). Routes never call clients directly.

```
backend/
  pyproject.toml  uv.lock  .env.example  vercel.json
  app/
    main.py  config.py  errors.py
    api/        health.py  episodes.py  quiz.py  tutor.py
    schemas/    contract.py          Pydantic models, same names and fields as contracts/schemas
    services/   script_writer.py  narrator.py  pictures.py  pipeline.py  quiz_maker.py  grader.py  tutor.py  grounding.py
    clients/    llm.py (Gemini, Groq fallback)  tts.py (edge-tts)  pexels.py
    prompts/    script.md  quiz.md  grade.md  tutor.md
  tests/
```

### Streaming and speed
- `/api/episodes/stream` returns `StreamingResponse(..., media_type="application/x-ndjson")` and yields one event per line as soon as it is ready; never build a whole episode first
- Event order exactly as `contracts/api.md`; voice and picture for all scenes of an episode run concurrently (`asyncio.TaskGroup`), emission stays in index order
- Target: first `scene` event within 8 s for a 10-page text; log the time of every stage
- Timeouts: LLM 30 s, voice 15 s per scene, Pexels 5 s
- Picture failure → `picture: null`. Voice failure → retry once → `audio: null`, `words_estimated: true`, timings estimated from word length

### LLM
- One LLM call per episode script (not per scene); quiz one call per episode; tutor one call per message
- Ask for JSON with a response schema; validate with the Pydantic model; on invalid output retry once with the validation error appended; then Groq; then an `error` event `llm_unavailable`
- HTTP 429 from a provider → try the other provider; both limited → `rate_limited`
- Model ids from env (`GEMINI_MODEL`, `GROQ_MODEL`); default to a Flash-Lite model and check current ids in Google AI Studio and the Groq console
- Prompts live in `app/prompts/*.md`; the script prompt asks for: short spoken lines (≤ 220 chars), a teacher/student dialogue, one highlight word per line, a picture search query in English, a reaction and sfx from the enums, and a verbatim `source_quote`
- Grounding (`services/grounding.py`): a scene or question whose `source_quote` is not in the source (whitespace-normalised) is regenerated once, then dropped; `highlight` must be in `text`
- Cache results in memory by sha256 of (source text, language, params) for the process lifetime

### Voice
- edge-tts with `boundary="WordBoundary"`; offsets are 100-ns ticks → divide by 10,000 for ms
- Each character (`CharacterId`) has its own voice, pitch and rate in `app/services/cast.py`. Multilingual voices (Brian, Emma, Florian, Remy, Vivienne, Ava) speak Russian with word timings; `ru-RU-DmitryNeural` drops sentences
- The backend picks a cast pair and a background per episode and sends them in `plan` (`contracts/api.md`, "Cast and background")
- `contracts/tools/build_fixtures.py` is a tested reference for the edge-tts calls

### Config (keep `.env.example` in sync)
`GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `PEXELS_API_KEY`, `ALLOWED_ORIGINS` (comma-separated), `MAX_SOURCE_CHARS=60000`

### Checks (run before saying done)
```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run pytest -q
```
- Contract tests validate every streamed event and every quiz, grade and tutor response against `contracts/schemas/contract.schema.json` with `jsonschema`
- External calls are mocked with respx in tests; one opt-in live test (`-m live`) hits real APIs
- For each endpoint you touched, show a curl and its output (streams: first 3 lines and the time to the first `scene`)

## Plan

Gates and times come from `docs/PLAN.md`. Tick boxes here as you finish them.

### M0 Scaffold (Day 1, 11:30)
- [x] `uv init` in `backend/`; add FastAPI, uvicorn, pydantic-settings, httpx, google-genai, groq, edge-tts; dev: pytest, pytest-asyncio, respx, jsonschema, ruff, mypy
- [x] `app/main.py` with CORS from `ALLOWED_ORIGINS` and `GET /api/health`
- [x] `app/schemas/contract.py` mirroring the schema; contract test passes on `contracts/fixtures/`
- [x] `POST /api/episodes/stream` with `?mock=1` streams `contracts/fixtures/episode-stream.ndjson` line by line, 300 ms apart, so the frontend can integrate now
- [x] Vercel entrypoint ready (zero-config FastAPI `app` in `app/main.py`; `vercel.json` with `maxDuration` 60); the user creates the Vercel project and sets env vars

### M1 Hello pipeline (Day 1, 13:00)
- [ ] `script_writer`: source text → validated episode script (Gemini), grounding checks pass on `contracts/fixtures/source.txt`
- [x] `narrator`: one line → MP3 base64 + word timings
- [ ] `pictures`: Pexels search → url + credit

### M2 End to end (Day 1, 18:00) — the key gate
- [ ] `pipeline` streams real episodes; first `scene` within 8 s; Groq fallback; errors as `error` events
- [ ] Deployed URL answers the frontend from a phone

### M3 Learning loop (Day 1 evening)
- [ ] `POST /api/quiz`: 3–5 questions per episode, at most one open, each with `source_quote` and `scene_id`
- [ ] `POST /api/quiz/grade`

### M4 MVP complete (Day 2, 12:00)
- [ ] `POST /api/tutor`: streaming answer only from the source, `done` lists the quotes used
- [ ] AI picks the template per episode from `parkour_duo`, `split_screen`, `fake_chat` (plus `top3_countdown` and `myth_or_fact` once the frontend has them; fill `rank` / `verdict` / `formula` / `term` as the template needs)
- [ ] Stage timings logged; in-memory cache

### Stretch (only if the user asks after M4)
- [ ] MP4 export with FFmpeg

## Definition of done (every milestone)
Checks pass, contract tests pass, the `reviewer` subagent ran on your diff and its findings are fixed, and curl output is shown.
