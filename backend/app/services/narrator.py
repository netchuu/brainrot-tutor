import asyncio
import base64
import logging
from dataclasses import dataclass

from app.clients.tts import Boundary, synthesize
from app.errors import VoiceError
from app.schemas.contract import Audio, CharacterId, Language, Word
from app.services.cache import LruCache, cache_key
from app.services.cast import voice_for
from app.services.grounding import SPOKEN_WORD

logger = logging.getLogger(__name__)

VOICE_ATTEMPTS = 2
VOICE_SCENE_TIMEOUT_S = 15
# edge-tts streams 48 kbit/s mono MP3, so the byte count gives the duration.
MP3_BYTES_PER_MS = 48_000 / 8 / 1000
LEAD_IN_MS = 100
ESTIMATED_CHARS_PER_S = 14
MIN_WORD_MS = 120
# A 220-character line is up to about 125 KB of base64 MP3, so 200 lines stay under 25 MB.
VOICE_CACHE: LruCache["Narration"] = LruCache(200)


@dataclass(frozen=True)
class Narration:
    audio: Audio | None
    words: list[Word]
    words_estimated: bool


def words_from_boundaries(boundaries: list[Boundary]) -> list[Word]:
    words: list[Word] = []
    for boundary in boundaries:
        # edge-tts sometimes reports two spoken words ("5000 оборотах") as one boundary; split it by length.
        tokens = SPOKEN_WORD.findall(boundary.text)
        span = boundary.end_ms - boundary.start_ms
        total = sum(len(token) for token in tokens)
        cursor = float(boundary.start_ms)
        for token in tokens:
            start = round(cursor)
            cursor += span * len(token) / total
            words.append(Word(text=token, start_ms=start, end_ms=round(cursor)))
    return words


def estimate_words(text: str, duration_ms: int | None) -> list[Word]:
    tokens = SPOKEN_WORD.findall(text)
    weights = [len(token) + 2 for token in tokens]
    spoken_ms = round(sum(len(token) for token in tokens) / ESTIMATED_CHARS_PER_S * 1000)
    if duration_ms is not None:
        spoken_ms = duration_ms - LEAD_IN_MS
    spoken_ms = max(spoken_ms, MIN_WORD_MS * len(tokens))
    words: list[Word] = []
    cursor = float(LEAD_IN_MS)
    for token, weight in zip(tokens, weights, strict=True):
        start = round(cursor)
        cursor += spoken_ms * weight / sum(weights)
        words.append(Word(text=token, start_ms=start, end_ms=round(cursor)))
    return words


async def narrate(text: str, character: CharacterId, language: Language) -> Narration:
    key = cache_key("voice", text, character, language)
    cached = VOICE_CACHE.get(key)
    if cached is not None:
        return cached
    narration = await speak(text, character, language)
    # Only a narration whose timings cover every spoken word is kept; a cut-off one may succeed next time.
    if not narration.words_estimated and len(narration.words) == len(SPOKEN_WORD.findall(text)):
        VOICE_CACHE.put(key, narration)
    return narration


async def speak(text: str, character: CharacterId, language: Language) -> Narration:
    voice, pitch, rate = voice_for(character, language)
    try:
        async with asyncio.timeout(VOICE_SCENE_TIMEOUT_S):
            for attempt in range(1, VOICE_ATTEMPTS + 1):
                try:
                    mp3, boundaries = await synthesize(text, voice, rate=rate, pitch=pitch)
                except VoiceError as exc:
                    logger.warning("voice attempt %d of %d failed: %s", attempt, VOICE_ATTEMPTS, exc)
                    continue
                duration_ms = max(1, round(len(mp3) / MP3_BYTES_PER_MS))
                audio = Audio(mime="audio/mpeg", base64=base64.b64encode(mp3).decode("ascii"), duration_ms=duration_ms)
                words = words_from_boundaries(boundaries)
                if words:
                    return Narration(audio=audio, words=words, words_estimated=False)
                return Narration(audio=audio, words=estimate_words(text, duration_ms), words_estimated=True)
    except TimeoutError:
        logger.warning("voice gave up after %d s for this scene", VOICE_SCENE_TIMEOUT_S)
    return Narration(audio=None, words=estimate_words(text, None), words_estimated=True)
