# Decisions

One line per decision: date · decision · why.

- 2026-10-24 · Template-based video: our clips and layouts, AI fills slots · fast (seconds, not minutes), free, no copyright risk
- 2026-10-24 · Browser plays layers live; no MP4 render to watch · first scene within 10 s; MP4 export is stretch only
- 2026-10-24 · Separate `backend/` (FastAPI) and `frontend/` (Vite React) with a shared `contracts/` · two agents work in parallel against fixtures
- 2026-10-24 · Stateless backend, no database; the client sends the source text with each call · nothing to host or migrate in 2 days
- 2026-10-24 · Episodes stream as NDJSON over POST; audio inline as base64 MP3 · no storage service, scene 1 plays before the episode finishes
- 2026-10-24 · PDF text is extracted in the browser (pdfjs-dist) · avoids Vercel's request size limit for file uploads; scanned PDFs are out of scope
- 2026-10-24 · Gemini free tier (Flash-Lite) for script, quiz and tutor; Groq free tier as fallback · $0, two providers survive one rate limit
- 2026-10-24 · Voice: edge-tts Svetlana for both characters with different pitch · Dmitry failed on some sentences in tests; no Kyrgyz voice
- 2026-10-24 · Own React player instead of Remotion · Remotion's free license covers teams of up to 3
- 2026-10-24 · Pictures from Pexels; no AI images in the live path · keyless AI images took ~9 s and allow 1 per 45 s
- 2026-10-24 · Each episode names its cast (6 original characters, each with its own edge-tts voice) and background clip in `plan`; the backend rotates them per episode · varied TikTok-style episodes without TV characters or voice cloning; replaces the single Svetlana teacher/student pair
- 2026-10-24 · Episode stream: each episode's voices start once its script is grounded; whole stream capped at 55 s with an error event · first scene sooner, and no silent cut-off at Vercel's 60 s
- 2026-10-24 · `contracts/fixtures/grade.json` added (GradeResponse for quiz q4) · lets fixture mode grade the open question without a backend
- 2026-10-24 · A source_quote must be 20–500 characters, at least 4 words and match the source at word boundaries; quiz and grade calls end at 50 s · single terms, list numbers or mid-word fragments no longer count as proof, and slow AI calls return the contract error instead of a Vercel 504
- 2026-10-24 · Grading trusts the question, reference answer and quote that the client sends · the backend is stateless; a learner can only inflate their own score
