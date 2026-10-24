import asyncio
import json
import time
from typing import Any

import httpx
import pytest

from app.errors import RateLimitedError
from app.schemas.contract import Audio, CharacterId, EpisodesRequest, Language, Picture, TemplateId, Word
from app.schemas.script import CourseScript, EpisodeScript
from app.services import pipeline
from app.services.narrator import Narration
from tests.conftest import FIXTURE_SCRIPT, SOURCE_TEXT, fixture_drafts
from validate import check_stream_order, validator

AUDIO = Audio(mime="audio/mpeg", base64="SUQz", duration_ms=1200)
PICTURE = Picture(query="engine", url="https://images.pexels.com/photos/1/a.jpeg", credit="Photo by A on Pexels")
REQUEST = EpisodesRequest(source_text=SOURCE_TEXT, language="ru", episode_count=3, template=None)


def fixture_course() -> CourseScript:
    episodes = [
        EpisodeScript(title=draft.title, template=episode["template"], scenes=draft.scenes)
        for draft, episode in zip(fixture_drafts(), FIXTURE_SCRIPT["episodes"], strict=True)
    ]
    return CourseScript(course_title=FIXTURE_SCRIPT["course_title"], language="ru", episodes=episodes)


class FakeMedia:
    def __init__(self, delays: dict[str, float] | None = None, fail_on: str | None = None) -> None:
        self.delays = delays or {}
        self.fail_on = fail_on
        self.voices: list[tuple[str, CharacterId]] = []

    async def narrate(self, text: str, character: CharacterId, language: Language) -> Narration:
        self.voices.append((text, character))
        await asyncio.sleep(self.delays.get(text, 0))
        if text == self.fail_on:
            raise RuntimeError("unexpected bug")
        return Narration(audio=AUDIO, words=[Word(text="слово", start_ms=100, end_ms=500)], words_estimated=False)

    async def find_picture(self, query: str | None) -> Picture | None:
        return PICTURE if query else None


def install(monkeypatch: pytest.MonkeyPatch, media: FakeMedia, course: CourseScript | None = None) -> None:
    async def write_script(
        source_text: str, language: Language, episode_count: int, template: TemplateId | None
    ) -> CourseScript:
        return course or fixture_course()

    monkeypatch.setattr(pipeline, "write_script", write_script)
    monkeypatch.setattr(pipeline, "narrate", media.narrate)
    monkeypatch.setattr(pipeline, "find_picture", media.find_picture)


async def collect(request: EpisodesRequest = REQUEST) -> list[dict[str, Any]]:
    return [json.loads(line) async for line in pipeline.stream_course(request)]


def assert_valid_stream(events: list[dict[str, Any]]) -> None:
    for event in events:
        validator("StreamEvent").validate(event)
    errors: list[str] = []
    check_stream_order(errors, events)
    assert errors == []


async def test_stream_follows_contract_with_cast_and_background(monkeypatch: pytest.MonkeyPatch) -> None:
    media = FakeMedia()
    install(monkeypatch, media)

    events = await collect()

    assert_valid_stream(events)
    assert events[-1]["type"] == "done"
    plan = events[0]
    assert [episode["scene_count"] for episode in plan["episodes"]] == [4, 3, 3]
    assert len({(e["cast"]["teacher"], e["cast"]["student"]) for e in plan["episodes"]}) == 3
    assert plan["episodes"][1]["background"] == "satisfying"
    assert plan["episodes"][0]["background"] != plan["episodes"][2]["background"]
    scenes = [event for event in events if event["type"] == "scene"]
    assert [scene["scene"]["id"] for scene in scenes[:2]] == ["e0s0", "e0s1"]
    for event in scenes:
        cast = plan["episodes"][event["episode"]]["cast"]
        speaker = event["scene"]["speaker"]
        assert (event["scene"]["text"], cast[speaker]) in media.voices


async def test_scenes_keep_index_order_while_media_runs_concurrently(monkeypatch: pytest.MonkeyPatch) -> None:
    course = fixture_course()
    texts = [scene.text for scene in course.episodes[0].scenes]
    media = FakeMedia(delays={texts[0]: 0.3, texts[1]: 0.2, texts[2]: 0.1, texts[3]: 0.0})
    install(monkeypatch, media, course)
    started = time.perf_counter()

    events = await collect()

    assert time.perf_counter() - started < 0.5
    assert [event["scene"]["text"] for event in events if event.get("episode") == 0 and "scene" in event] == texts


async def test_voice_and_picture_failures_still_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    media = FakeMedia()

    async def silent(text: str, character: CharacterId, language: Language) -> Narration:
        return Narration(audio=None, words=[Word(text="слово", start_ms=100, end_ms=500)], words_estimated=True)

    async def no_picture(query: str | None) -> Picture | None:
        return None

    install(monkeypatch, media)
    monkeypatch.setattr(pipeline, "narrate", silent)
    monkeypatch.setattr(pipeline, "find_picture", no_picture)

    events = await collect()

    assert_valid_stream(events)
    scene = events[1]["scene"]
    assert (scene["audio"], scene["picture"], scene["words_estimated"]) == (None, None, True)
    assert events[-1]["type"] == "done"


async def test_script_failure_is_a_single_error_event(monkeypatch: pytest.MonkeyPatch) -> None:
    async def busy(source_text: str, language: Language, episode_count: int, template: TemplateId | None) -> None:
        raise RateLimitedError("The AI providers are busy right now. Try again in a minute.")

    monkeypatch.setattr(pipeline, "write_script", busy)

    events = await collect()

    assert events == [
        {
            "type": "error",
            "code": "rate_limited",
            "message": "The AI providers are busy right now. Try again in a minute.",
            "retryable": True,
        }
    ]


async def test_slow_script_hits_the_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow(source_text: str, language: Language, episode_count: int, template: TemplateId | None) -> None:
        await asyncio.sleep(1)

    monkeypatch.setattr(pipeline, "write_script", slow)
    monkeypatch.setattr(pipeline, "SCRIPT_DEADLINE_S", 0.05)

    events = await collect()

    assert [(event["type"], event["code"], event["retryable"]) for event in events] == [
        ("error", "llm_unavailable", True)
    ]


async def test_unexpected_failure_mid_stream_ends_with_internal_error(monkeypatch: pytest.MonkeyPatch) -> None:
    course = fixture_course()
    media = FakeMedia(fail_on=course.episodes[0].scenes[2].text)
    install(monkeypatch, media, course)

    events = await collect()

    for event in events:
        validator("StreamEvent").validate(event)
    assert [event["type"] for event in events] == ["plan", "scene", "scene", "error"]
    assert events[-1]["code"] == "internal"


async def test_route_streams_the_real_pipeline(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, FakeMedia())

    response = await client.post("/api/episodes/stream", json=REQUEST.model_dump())

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/x-ndjson"
    events = [json.loads(line) for line in response.text.splitlines()]
    assert_valid_stream(events)


async def test_whitespace_only_source_is_bad_input(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/episodes/stream", json={**REQUEST.model_dump(), "source_text": " \n" * 150})

    assert response.status_code == 422
    validator("ErrorResponse").validate(response.json())
    assert response.json()["error"]["code"] == "bad_input"
