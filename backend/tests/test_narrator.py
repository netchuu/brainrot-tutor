import asyncio
import base64
from collections.abc import AsyncIterator
from typing import ClassVar

import aiohttp
import edge_tts
import pytest
from edge_tts.exceptions import NoAudioReceived

from app.clients import tts
from app.services.narrator import estimate_words, narrate

LINE = "Представь, что у машины есть мозг."
AUDIO = b"\xff\xf3" * 3000
BOUNDARIES = [("Представь", 1_000_000, 5_000_000), ("что", 7_000_000, 2_000_000)]


class FakeCommunicate:
    created: ClassVar[list["FakeCommunicate"]] = []
    failures: ClassVar[list[BaseException]] = []
    boundaries: ClassVar[list[tuple[str, int, int]]] = BOUNDARIES
    delay_s: ClassVar[float] = 0.0

    def __init__(self, text: str, voice: str, *, rate: str, pitch: str, boundary: str) -> None:
        self.text, self.voice, self.rate, self.pitch, self.boundary = text, voice, rate, pitch, boundary
        FakeCommunicate.created.append(self)

    async def stream(self) -> AsyncIterator[dict[str, object]]:
        await asyncio.sleep(self.delay_s)
        if FakeCommunicate.failures:
            raise FakeCommunicate.failures.pop(0)
        yield {"type": "audio", "data": AUDIO}
        for word, offset, duration in self.boundaries:
            yield {"type": "WordBoundary", "text": word, "offset": offset, "duration": duration}


@pytest.fixture(autouse=True)
def fake_edge_tts(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeCommunicate.created = []
    FakeCommunicate.failures = []
    FakeCommunicate.boundaries = BOUNDARIES
    FakeCommunicate.delay_s = 0.0
    monkeypatch.setattr(edge_tts, "Communicate", FakeCommunicate)


async def test_voice_returns_mp3_and_word_timings_in_ms() -> None:
    narration = await narrate(LINE, "teacher", "ru")

    assert narration.audio is not None
    assert base64.b64decode(narration.audio.base64) == AUDIO
    assert narration.audio.duration_ms == 1000
    assert narration.words_estimated is False
    assert [(w.text, w.start_ms, w.end_ms) for w in narration.words] == [("Представь", 100, 600), ("что", 700, 900)]
    call = FakeCommunicate.created[0]
    assert (call.voice, call.pitch, call.rate, call.boundary) == ("ru-RU-SvetlanaNeural", "+0Hz", "+0%", "WordBoundary")


async def test_student_uses_shifted_pitch_and_english_voice() -> None:
    await narrate("Wait, what does it do?", "student", "en")

    call = FakeCommunicate.created[0]
    assert (call.voice, call.pitch, call.rate) == ("en-US-AvaNeural", "+15Hz", "+8%")


async def test_voice_failure_is_retried_once() -> None:
    FakeCommunicate.failures = [NoAudioReceived("empty")]

    narration = await narrate(LINE, "teacher", "ru")

    assert narration.audio is not None
    assert len(FakeCommunicate.created) == 2


async def test_double_failure_gives_estimated_captions() -> None:
    FakeCommunicate.failures = [aiohttp.ClientConnectionError("down"), NoAudioReceived("empty")]

    narration = await narrate(LINE, "teacher", "ru")

    assert narration.audio is None
    assert narration.words_estimated is True
    assert [word.text for word in narration.words] == ["Представь", "что", "у", "машины", "есть", "мозг"]
    assert narration.words[0].start_ms == 100
    for previous, current in zip(narration.words, narration.words[1:], strict=False):
        assert previous.end_ms <= current.start_ms <= current.end_ms


async def test_voice_timeout_counts_as_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tts, "VOICE_TIMEOUT_S", 0.01)
    FakeCommunicate.delay_s = 0.1

    narration = await narrate(LINE, "teacher", "ru")

    assert narration.audio is None
    assert len(FakeCommunicate.created) == 2


async def test_audio_without_boundaries_gets_estimated_timings() -> None:
    FakeCommunicate.boundaries = []

    narration = await narrate(LINE, "teacher", "ru")

    assert narration.audio is not None
    assert narration.words_estimated is True
    assert narration.words[-1].end_ms == narration.audio.duration_ms


def test_estimate_keeps_hyphenated_words_and_drops_punctuation() -> None:
    words = estimate_words("Ньютон-метры — это момент, а 7023 — делитель!", None)

    assert [word.text for word in words] == ["Ньютон-метры", "это", "момент", "а", "7023", "делитель"]
