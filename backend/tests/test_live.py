import asyncio
import json
import time
from typing import get_args

import pytest

from app.clients.llm import call_groq, generate_with
from app.config import get_settings
from app.schemas.contract import CharacterId, EpisodesRequest
from app.schemas.script import EpisodeDraft
from app.services import pipeline, script_writer
from app.services.grounding import normalize
from app.services.narrator import narrate
from app.services.pictures import find_picture
from tests.conftest import SOURCE_TEXT
from validate import check_stream_order, validator

pytestmark = pytest.mark.live


async def test_live_script_is_grounded_in_source() -> None:
    settings = get_settings()
    if settings.gemini_api_key is None and settings.groq_api_key is None:
        pytest.skip("GEMINI_API_KEY and GROQ_API_KEY are not set in backend/.env")
    started = time.perf_counter()

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    elapsed = time.perf_counter() - started
    source = normalize(SOURCE_TEXT)
    print(f"\nscript in {elapsed:.1f}s: {script.course_title!r}")
    for episode in script.episodes:
        quoted = sum(scene.source_quote is not None for scene in episode.scenes)
        print(f"  {episode.title!r}: {len(episode.scenes)} scenes, {quoted} with source quotes")
        for scene in episode.scenes:
            assert len(scene.text) <= 220
            assert scene.source_quote is None or scene.source_quote in source
            assert scene.highlight is None or scene.highlight in scene.text
    first = script.episodes[0].scenes[0]
    print(f"  first scene: {first.model_dump_json()}")


async def test_live_groq_accepts_episode_schema() -> None:
    if get_settings().groq_api_key is None:
        pytest.skip("GROQ_API_KEY is not set in backend/.env")
    fragment = script_writer.split_source(SOURCE_TEXT, 3)[0]
    system = script_writer.SYSTEM_PROMPT.substitute(language_name="Russian", scenes_min=4, scenes_max=6)
    prompt = script_writer.EPISODE_PROMPT.substitute(episode_number=1, episode_count=3, fragment=fragment)
    started = time.perf_counter()

    draft = await generate_with(call_groq, system, prompt, EpisodeDraft)

    print(f"\ngroq episode in {time.perf_counter() - started:.1f}s: {draft.title!r}, {len(draft.scenes)} scenes")


async def test_live_narration_has_word_timings() -> None:
    started = time.perf_counter()

    narration = await narrate("Представь, что у машины есть мозг. Он называется ЭБУ.", "professor", "ru")

    assert narration.audio is not None
    assert narration.words_estimated is False
    words = ", ".join(f"{w.text} {w.start_ms}-{w.end_ms}" for w in narration.words[:3])
    print(f"\nvoice in {time.perf_counter() - started:.1f}s: {narration.audio.duration_ms} ms, words: {words}")


async def test_live_every_character_speaks_russian_with_timings() -> None:
    characters = get_args(CharacterId)

    narrations = await asyncio.gather(*(narrate("Детонация разрушает поршни.", c, "ru") for c in characters))

    for character, narration in zip(characters, narrations, strict=True):
        print(f"\n{character}: audio {narration.audio is not None}, estimated {narration.words_estimated}")
        assert narration.audio is not None
        assert narration.words_estimated is False


async def test_live_pexels_finds_a_picture() -> None:
    if get_settings().pexels_api_key is None:
        pytest.skip("PEXELS_API_KEY is not set in backend/.env")

    picture = await find_picture("car engine control unit")

    assert picture is not None
    print(f"\npicture: {picture.url} ({picture.credit})")


async def test_live_pipeline_streams_a_valid_course() -> None:
    settings = get_settings()
    if settings.gemini_api_key is None and settings.groq_api_key is None:
        pytest.skip("GEMINI_API_KEY and GROQ_API_KEY are not set in backend/.env")
    started = time.perf_counter()
    first_scene_s = None
    events = []

    async for line in pipeline.stream_course(EpisodesRequest(source_text=SOURCE_TEXT, language="ru")):
        event = json.loads(line)
        events.append(event)
        if event["type"] == "scene" and first_scene_s is None:
            first_scene_s = time.perf_counter() - started

    for event in events:
        validator("StreamEvent").validate(event)
    errors: list[str] = []
    check_stream_order(errors, events)
    assert errors == []
    assert events[-1]["type"] == "done"
    print(f"\nfirst scene after {first_scene_s:.1f}s, done after {time.perf_counter() - started:.1f}s")
