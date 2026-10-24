# Brainrot Tutor

Web app that turns a PDF or pasted notes into short TikTok-style lessons built from our own video templates, then checks what stuck with a quiz and a tutor chat. Built in 2 days for the SkillLab AI Hackathon.

- AI never generates video. It writes an episode script as JSON and fills template slots: text, picture, reaction, sound, voice.
- The browser plays the layers live, so the first scene starts about 10 s after upload. No MP4 rendering to watch.
- Full plan, templates and demo script: https://claude.ai/artifact/UmSgcqcC8vrieeyFrsuX7w (summary in `docs/PLAN.md`).

## Repo map and ownership

| Path | Owner | What |
|---|---|---|
| `backend/` | Backend agent | FastAPI API: script writing, voice, pictures, quiz, tutor |
| `frontend/` | Frontend agent | React app: upload, template player, feed, quiz, tutor chat |
| `frontend/public/assets/` | Content lead (human) | Background clips, mascots, stickers, sound effects, fonts |
| `contracts/` | Shared | API contract (`api.md`), JSON Schema, fixtures, validator. Source of truth for both sides |
| `docs/` | Shared | `PLAN.md` (scope, milestones, asset names), `decisions.md` (one line per decision) |

- **Your plan and rules are in your folder's CLAUDE.md**: backend → `backend/CLAUDE.md`, frontend → `frontend/CLAUDE.md`. Read it fully before your first change.
- Edit only your own folder. Read anything.
- `contracts/` changes follow the process in `.claude/rules/general.md` (CONTRACT).

## Stack

- **Backend:** Python 3.12, FastAPI, Pydantic v2, uv, httpx; Gemini API free tier with Groq fallback; edge-tts for voice; Pexels for pictures. Stateless, no database.
- **Frontend:** Vite, React 19, TypeScript strict, Tailwind CSS 4, Vitest, pdfjs-dist. Own player, no Remotion.
- **Deploy:** Vercel Hobby, two projects: root `frontend/` (static) and root `backend/` (FastAPI, zero-config).

## Contract at a glance (details: `contracts/api.md`)

| Endpoint | Request | Response |
|---|---|---|
| `POST /api/episodes/stream` | source text, language, episode count | NDJSON: `plan`, then per episode `scene`… `episode_done`, then `done` |
| `POST /api/quiz` | source text + one episode | quiz questions |
| `POST /api/quiz/grade` | open question + answer | score + feedback |
| `POST /api/tutor` | source text + chat messages | NDJSON: `delta`… `done` |
| `GET /api/health` | none | `{"status": "ok"}` |

## Run locally (after each side's M0 scaffold)

```bash
cd backend && uv run fastapi dev app/main.py --port 8000
cd frontend && npm run dev
cd frontend && VITE_USE_FIXTURES=1 npm run dev
uv run --with jsonschema python contracts/tools/validate.py
```

- The frontend dev server runs on 5173 and proxies `/api` to 8000.
- `VITE_USE_FIXTURES=1` plays `contracts/fixtures/` with no backend.
- Backend secrets live in `backend/.env` (template: `backend/.env.example`). The user fills it; agents never open it.

## Context7 MCP (every agent, every library call)

- Check current library docs with Context7 before writing code that uses any third-party library: `mcp__context7__resolve-library-id`, then `mcp__context7__query-docs`. Training data is outdated; the docs win.
- The tools must be available in every session. If `mcp__context7__*` tools are missing, stop and ask the user to run:
  `claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp` (an API key in an `Authorization: Bearer` header raises rate limits).
- Each agent plan lists the libraries it must look up.

## Priorities (in order)

1. The demo flow works on a phone on the live URL: upload → video → quiz → tutor.
2. Speed: first scene plays within 10 s of upload.
3. Faithful to the source: every fact scene and quiz answer carries a verbatim quote from the uploaded text.
4. Free: no paid APIs; stay inside free-tier limits (one LLM call per episode script, caching, fallbacks).

## Facts already tested (do not re-research)

- edge-tts `ru-RU-SvetlanaNeural` returns MP3 and WordBoundary timings; 6 lines (31 s of speech) took 3.3 s in parallel.
- edge-tts `ru-RU-DmitryNeural` returned no audio for some sentences. Use Svetlana with a different pitch for the second character.
- edge-tts has no Kyrgyz voice (Kazakh and Uzbek exist).
- Keyless Pollinations images take about 9 s each, allow 1 image per 45 s per IP and add a watermark: not in the live path.
- FFmpeg export of 30 s at 1080×1920 with a green-screen key took 6.5 s on an Apple M5. MP4 export is a stretch goal.
- Remotion's free license covers teams of up to 3 people, so we use our own player.
- The Tenor GIF API shut down on 2026-06-30.

## Git

- Both agents share one checkout on `main`. Never create, switch or rebase branches here: it would change the other agent's files.
- Commit only your own folder, limited by path so the other agent's staged files stay out: `git add backend && git commit -m "…" -- backend` (frontend: same with `frontend`).
- If `git commit` fails on `index.lock`, the other agent is committing: wait a few seconds and retry. Never delete the lock file.
- Commit after each milestone or green checkpoint; push only when the user asks.
- Never force-push. Never commit `.env`, `node_modules/`, `.venv/` or generated MP4s.
