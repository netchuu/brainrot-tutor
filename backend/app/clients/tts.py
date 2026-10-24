import asyncio
from dataclasses import dataclass

import aiohttp
import edge_tts
from edge_tts.exceptions import EdgeTTSException

from app.errors import VoiceError

VOICE_TIMEOUT_S = 8
TICKS_PER_MS = 10_000


@dataclass(frozen=True)
class Boundary:
    text: str
    start_ms: int
    end_ms: int


async def synthesize(text: str, voice: str, *, rate: str, pitch: str) -> tuple[bytes, list[Boundary]]:
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    audio = bytearray()
    boundaries: list[Boundary] = []
    try:
        async with asyncio.timeout(VOICE_TIMEOUT_S):
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio.extend(chunk["data"])
                elif chunk["type"] == "WordBoundary":
                    start = round(chunk["offset"] / TICKS_PER_MS)
                    end = round((chunk["offset"] + chunk["duration"]) / TICKS_PER_MS)
                    boundaries.append(Boundary(chunk["text"], start, end))
    except (EdgeTTSException, aiohttp.ClientError, TimeoutError) as exc:
        raise VoiceError(f"edge-tts failed with {type(exc).__name__}") from exc
    if not audio:
        raise VoiceError("edge-tts returned no audio")
    return bytes(audio), boundaries
