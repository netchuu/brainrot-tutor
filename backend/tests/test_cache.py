import edge_tts
import httpx
import pytest
import respx
from pydantic import BaseModel

from app.config import get_settings
from app.errors import RateLimitedError
from app.schemas.contract import GradeRequest, OpenQuestion
from app.schemas.quiz import GradeDraft, QuizDraft, TutorDraft
from app.services import grader, quiz_maker, script_writer, tutor
from app.services.cache import LruCache, cache_key
from app.services.narrator import narrate
from app.services.pictures import find_picture
from tests.conftest import SOURCE_TEXT, fixture_drafts
from tests.test_narrator import FakeCommunicate
from tests.test_quiz import FIXTURE_QUIZ
from tests.test_quiz import REQUEST as QUIZ_REQUEST
from tests.test_quiz import fixture_drafts as quiz_drafts
from tests.test_tutor import FIXTURE_ANSWER, FIXTURE_QUOTES
from tests.test_tutor import REQUEST as TUTOR_REQUEST


class CountingLlm:
    def __init__(self, reply: BaseModel) -> None:
        self.reply = reply
        self.calls = 0

    async def __call__(self, system: str, prompt: str, model: type[BaseModel]) -> BaseModel:
        self.calls += 1
        return self.reply


def test_lru_cache_drops_the_least_recently_used_entry() -> None:
    cache: LruCache[int] = LruCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1

    cache.put("c", 3)

    assert (cache.get("a"), cache.get("b"), cache.get("c")) == (1, None, 3)


def test_cache_key_depends_on_every_part() -> None:
    assert cache_key("quiz", {"a": 1, "b": 2}) == cache_key("quiz", {"b": 2, "a": 1})
    assert cache_key("quiz", "текст") != cache_key("quiz", "текст ")
    assert cache_key("quiz", "x") != cache_key("grade", "x")


async def test_script_is_reused_and_still_starts_early_voices(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = iter(fixture_drafts() * 2)
    calls = 0

    async def fake(system: str, prompt: str, model: type[BaseModel]) -> BaseModel:
        nonlocal calls
        calls += 1
        return next(drafts)

    monkeypatch.setattr(script_writer, "generate_json", fake)
    ready: list[int] = []

    first = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)
    second = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None, lambda number, scenes: ready.append(number))

    assert second == first
    assert calls == 3
    assert ready == [0, 1, 2]


async def test_course_missing_an_episode_is_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    calls = 0

    async def flaky(system: str, prompt: str, model: type[BaseModel]) -> BaseModel:
        nonlocal calls
        calls += 1
        if "Episode 3 of 3." in prompt:
            raise RateLimitedError("busy")
        return drafts[int(prompt.split("Episode ", 1)[1][0]) - 1]

    monkeypatch.setattr(script_writer, "generate_json", flaky)

    await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)
    await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert calls == 6


async def test_voice_is_reused_but_estimated_captions_are_not(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeCommunicate.created = []
    FakeCommunicate.failures = []
    FakeCommunicate.boundaries = [("Привет", 1_000_000, 5_000_000)]
    FakeCommunicate.delay_s = 0.0
    monkeypatch.setattr(edge_tts, "Communicate", FakeCommunicate)

    first = await narrate("Привет.", "kid", "ru")
    second = await narrate("Привет.", "kid", "ru")
    FakeCommunicate.boundaries = []
    await narrate("Пока.", "kid", "ru")
    await narrate("Пока.", "kid", "ru")

    assert second == first
    assert len(FakeCommunicate.created) == 3


async def test_found_picture_is_reused_and_misses_are_retried(
    respx_mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PEXELS_API_KEY", "test-pexels-key")
    get_settings.cache_clear()
    photo = {"photographer": "A", "src": {"large": "https://images.pexels.com/photos/1/a.jpeg"}}
    route = respx_mock.get(host="api.pexels.com", path="/v1/search").mock(
        side_effect=[
            httpx.Response(200, json={"photos": [photo]}),
            httpx.Response(200, json={"photos": []}),
            httpx.Response(200, json={"photos": []}),
        ]
    )

    assert await find_picture("engine") == await find_picture("engine")
    assert await find_picture("nothing") is None
    assert await find_picture("nothing") is None
    assert route.call_count == 3


async def test_quiz_grade_and_tutor_answers_are_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    quiz_llm = CountingLlm(QuizDraft(questions=quiz_drafts()))
    grade_llm = CountingLlm(GradeDraft(score=0.9, feedback="Верно."))
    tutor_llm = CountingLlm(TutorDraft(answer=FIXTURE_ANSWER, source_quotes=FIXTURE_QUOTES))
    monkeypatch.setattr(quiz_maker, "generate_json", quiz_llm)
    monkeypatch.setattr(grader, "generate_json", grade_llm)
    monkeypatch.setattr(tutor, "generate_json", tutor_llm)
    grade_request = GradeRequest(
        language="ru", question=OpenQuestion.model_validate(FIXTURE_QUIZ["questions"][3]), answer="Топливо и зажигание"
    )

    for _ in range(2):
        await quiz_maker.make_quiz(QUIZ_REQUEST)
        await grader.grade_answer(grade_request)
        await tutor.answer_question(TUTOR_REQUEST)

    assert (quiz_llm.calls, grade_llm.calls, tutor_llm.calls) == (1, 1, 1)
