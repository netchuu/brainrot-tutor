# Build plan (summary)

Full version with the demo script: https://claude.ai/artifact/UmSgcqcC8vrieeyFrsuX7w

## Done means

On a phone, a juror uploads a real PDF, scene 1 plays within about 10 s, they swipe through 3 short episodes, take a quiz, and ask the tutor one question, all on a public URL.

## Scope

**Must (by Day 2 noon):** paste text or upload a text PDF · AI script of 3 episodes × 4–6 scenes · Russian and English voice with word timings · templates Parkour Duo, Split Screen, Fake Chat · word-by-word captions with one highlighted word · Pexels picture, reaction sticker and sound per scene · streaming playback · quiz per episode with source quotes · tutor chat grounded in the source · deployed on Vercel, tested on two phones.

**Should (Day 2 afternoon, only if must is green):** Top 3 Countdown and Myth or Fact templates · AI picks the template per episode · swipe feed · wrong answer replays its scene · cached demo videos.

**Won't:** AI video or AI images in the live path · accounts, payments, history · voice cloning or TV characters · MP4 download (stretch only) · Kyrgyz voice (test KaniTTS only with spare time).

## Templates

| Template id | Layout and slots | Priority |
|---|---|---|
| `parkour_duo` | Dimmed parkour loop; picture on top; 2–3 word caption in the middle; teacher and student mascots at the bottom, swapping by `speaker`; reaction sticker | MVP |
| `split_screen` | Top half: `formula` (KaTeX), else `term` card, else `picture`; bottom half: satisfying loop | MVP |
| `fake_chat` | Chat bubbles between Student and Brain over gameplay; `picture` arrives as an image message | MVP |
| `top3_countdown` | Big `rank` 3-2-1 with picture and one caption line | Should |
| `myth_or_fact` | Statement, pause, `verdict` reveal (red X / green check), explanation; ends on a question | Should |

## Asset kit (content lead, ready Day 1 13:00)

File names match the contract enums, so the player loads them by name. All files are ours or from Pexels/Pixabay; no TV-show material.

```
frontend/public/assets/
  backgrounds/parkour-1.mp4 … parkour-3.mp4      Luanti recordings, 720×1280 H.264, ≤ 5 MB each
  backgrounds/satisfying-1.mp4 … satisfying-3.mp4 Pexels/Pixabay, vertical, ≤ 5 MB each
  mascots/teacher-neutral.png teacher-shocked.png teacher-pointing.png
  mascots/student-neutral.png student-shocked.png student-pointing.png   transparent PNG, ~600 px tall
  stickers/mind_blown.png shocked.png laugh.png thinking.png fire.png check.png cross.png
  sfx/whoosh.mp3 pop.mp3 boom.mp3 drumroll.mp3 ding.mp3 buzzer.mp3
  fonts/  one bold font with Cyrillic (Montserrat Black or Rubik)
```

## Milestones and gates

| Milestone | When | Gate |
|---|---|---|
| Kickoff | Day 1 10:00 | Roles named; contract read by both agents; Vercel projects and keys exist |
| M0 Scaffold | Day 1 11:30 | Backend serves `/api/health` and the mock stream; frontend scaffold reads the fixture stream |
| M1 Hello pipeline | Day 1 13:00 | Sample PDF gives valid episode JSON; one scene has voice and timings; Parkour Duo plays the fixture; asset kit ready |
| **M2 End to end** | **Day 1 18:00** | **A PDF uploaded on the live URL plays as a Parkour Duo episode on a phone; scene 1 within 10 s** |
| M3 Learning loop | Day 1 end | Quiz after each episode with source quotes; Split Screen works |
| M4 MVP complete | Day 2 12:00 | All must-haves green; tested on two phones by people outside the team |
| M5 Feature freeze | Pitch − 3 h | Demo PDFs generated and cached; 60 s backup recording; bug fixes only |

If M2 is not green at 18:00, stop adding features and fix the pipeline.

**Cut order when behind** (never cut the quiz, the live URL or the cached demo): 1. Myth or Fact and Top 3 · 2. swipe feed · 3. Split Screen · 4. AI grading of the open answer.
