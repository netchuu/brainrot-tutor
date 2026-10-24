# Frontend agent: plan and rules

You own `frontend/` except `frontend/public/assets/`, which the content lead fills (you read it and keep `src/assets.ts` in sync with `docs/PLAN.md`). Before your first change read: the root `CLAUDE.md`, `contracts/api.md`, `docs/PLAN.md` (templates and asset names), and this file to the end. Shared rules (`.claude/rules/general.md`) apply too; the ones that matter most are repeated here.

## Rules

### Context7 first (mandatory)
- Before writing or changing code that calls any third-party library, look it up with Context7 MCP: `mcp__context7__resolve-library-id`, then `mcp__context7__query-docs` with a specific question
- Use the exact APIs from the docs, not from memory; if docs and memory disagree, the docs win
- Look up at least: Vite (config, proxy, `?raw` imports, `server.fs.allow`, env vars), React 19, Tailwind CSS v4 (Vite plugin, `@theme`), Vitest and Testing Library, pdfjs-dist (worker setup with Vite, `getTextContent`), KaTeX, ESLint flat config, Vercel static deploy for Vite
- If the `mcp__context7__*` tools are missing, stop and tell the user (setup line in the root CLAUDE.md)

### Communication and scope
- Direct, concise; no preambles or apologies; evaluate a proposed solution against alternatives before implementing it
- Edit only `frontend/` (not `public/assets/` content); report issues elsewhere instead of fixing them
- Build only what this plan lists; no extra features, no unrelated refactors
- Contract changes: stop and ask the user (process in `.claude/rules/general.md`)

### TypeScript and React
- Vite + React 19 + TypeScript strict + Tailwind CSS 4; Vitest + Testing Library; ESLint; npm
- Function components and hooks; named exports (default export only where a tool requires it)
- No `any`, no unchecked `!`, no `@ts-ignore`; narrow `unknown` from the network with type guards
- API types live in `src/types/contract.ts` and mirror `contracts/schemas/contract.schema.json` exactly (same snake_case names, same unions)
- Imports through the `@/` alias for `src/`
- No docstrings; a comment only for a non-obvious why, one line; no TODO or FIXME
- No new UI or state library without asking; React state and context first; no Remotion
- Secrets never live in the frontend; the only env vars are `VITE_API_URL` and `VITE_USE_FIXTURES`

### Architecture
```
frontend/src/
  api/         client.ts (fetch + NDJSON stream reader, errors), fixtures.ts (VITE_USE_FIXTURES)
  player/      Stage.tsx (9:16 frame, layers)  usePlayback.ts (scene clock)  captions.ts (2–3 word chunks)  sfx.ts
  templates/   registry.ts  ParkourDuo/  SplitScreen/  FakeChat/  Top3Countdown/  MythOrFact/
  screens/     Upload.tsx  Feed.tsx  Quiz.tsx  Tutor.tsx
  pdf/         extractText.ts (pdfjs-dist)
  types/       contract.ts
  assets.ts    names of files in public/assets, matching docs/PLAN.md and the Reaction/Sfx enums
```
- A template is a component that receives the current scene, the playback time and the episode; it never hardcodes lesson text. `registry.ts` maps `TemplateId` to the component.

### Player
- One clock per scene: its `<audio>` element. Captions, speaker swaps, reactions and highlights derive from `audio.currentTime` read in `requestAnimationFrame`; no `setTimeout` chains
- Captions show 2–3 words at a time from `words`, the `highlight` word in the accent colour, and shrink to fit the width (long Russian words)
- Play scene 0 as soon as its event arrives; decode the next scene's audio ahead; if the next scene has not arrived, hold the frame with a "cooking…" sticker
- The background clip keeps looping across scenes (never restart per scene), dimmed to about 70 %
- `audio: null` → run the clock from `words` timings with sound effects only
- Missing asset file → a CSS fallback (coloured shape or emoji), never a broken image
- iOS needs a user gesture for audio: the Generate tap unlocks an `AudioContext` and the audio element

### Mobile and performance
- Phone first: 9:16 stage, check at 390×844 and on a real phone
- Background videos `muted playsInline loop preload="metadata"`, loaded per template
- First frame of scene 0 within 1 s of its event arriving
- PDF text is extracted in the browser; above 60,000 characters show "using the first part of your file" and send the first 60,000

### Config
- Dev: Vite proxy `/api` → `http://localhost:8000`. Prod: `VITE_API_URL`
- `VITE_USE_FIXTURES=1`: read `contracts/fixtures/episode-stream.ndjson`, `quiz.json`, `tutor-stream.ndjson` via `?raw` imports (allow `../contracts` in `server.fs.allow`) and replay them with 300 ms between events

### Checks (run before saying done)
```bash
npm run lint && npm run typecheck && npm run test -- --run && npm run build
```
- Unit tests: NDJSON reader (split lines across chunks), caption chunking and highlight, playback clock maths, type guards on the fixtures
- UI changes: open the app in a browser at 390×844, play the fixture, and report what you checked (screenshot if the tool allows)

## Plan

Gates and times come from `docs/PLAN.md`. Tick boxes here as you finish them.

### M0 Scaffold (Day 1, 11:30)
- [x] Vite React TS app in `frontend/` with Tailwind 4, Vitest, ESLint, `@/` alias; scripts `dev`, `build`, `lint`, `typecheck`, `test`
- [x] `src/types/contract.ts`; NDJSON stream reader with tests on the fixture
- [x] Fixture mode replays `episode-stream.ndjson`

### M1 Hello pipeline (Day 1, 13:00)
- [x] `Stage` + `ParkourDuo` play episode 0 of the fixture: background loop, picture slot, captions with highlight, mascots swapping by `speaker`, reaction sticker, sfx

### M2 End to end (Day 1, 18:00) — the key gate
- [ ] Upload screen: paste text or pick a PDF → stream from the backend → playback starts on the first `scene`; loading, error and retry states
- [ ] Deployed on Vercel; works on a phone against the deployed backend

### M3 Learning loop (Day 1 evening)
- [ ] Quiz after each episode: single choice graded in the browser with explanation and source quote; open answer through `/api/quiz/grade`; a wrong answer offers "Replay this scene" (`scene_id`)
- [ ] `SplitScreen` template (KaTeX formula, term card, picture; satisfying loop below)

### M4 MVP complete (Day 2, 12:00)
- [ ] `FakeChat` template
- [ ] Tutor chat screen streaming `/api/tutor`, showing the source quotes it used
- [ ] Swipe feed between episodes

### Should (Day 2 afternoon, only if M4 is green)
- [ ] `Top3Countdown` and `MythOrFact` templates; transitions; loading animation

## Definition of done (every milestone)
Checks pass, the browser check at 390×844 is reported, and the `reviewer` subagent ran on your diff with its findings fixed.
