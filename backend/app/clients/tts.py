import asyncio

import aiohttp
import edge_tts
from edge_tts.exceptions import EdgeTTSException

from app.errors import VoiceError
from app.schemas.contract import Word

VOICE_TIMEOUT_S = 8
TICKS_PER_MS = 10_000


async def synthesize(text: str, voice: str, *, rate: str, pitch: str) -> tuple[bytes, list[Word]]:
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    audio = bytearray()
    words: list[Word] = []
    try:
        async with asyncio.timeout(VOICE_TIMEOUT_S):
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    start = round(chunk["offset"] / TICKS_PER_MS)
                    end = round((chunk["offset"] + chunk["duration"]) / TICKS_PER_MS)
                    words.append(Word(text=chunk["text"], start_ms=start, end_ms=end))
    except (EdgeTTSException, aiohttp.ClientError, TimeoutError) as exc:
        raise VoiceError(f"edge-tts failed with {type(exc).__name__}") from exc
    if not audio:
        raise VoiceError("edge-tts returned no audio")
    return bytes(audio), words
