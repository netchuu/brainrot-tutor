import json
import re

import pytest
from pydantic import BaseModel

from app.config import CONTRACTS_DIR
from app.errors import LlmUnavailableError, RateLimitedError
from app.schemas.script import EpisodeDraft, SceneFixes, ScriptScene
from app.services import script_writer
from app.services.grounding import normalize
from tests.conftest import SOURCE_TEXT

FIXTURE_SCRIPT = json.loads((CONTRACTS_DIR / "tools" / "fixture_script.json").read_text(encoding="utf-8"))
EPISODE_NUMBER = re.compile(r"^Episode (\d+) of (\d+)\.", re.MULTILINE)


def fixture_drafts() -> list[EpisodeDraft]:
    return [
        EpisodeDraft(
            course_title=FIXTURE_SCRIPT["course_title"],
            title=episode["title"],
            scenes=[
                ScriptScene(
                    speaker=spec["speaker"],
                    text=spec["text"],
                    highlight=spec["highlight"],
                    picture_query=spec.get("picture_query"),
                    reaction=spec["reaction"],
                    sfx=spec["sfx"],
                    source_quote=spec["source_quote"],
                )
                for spec in episode["scenes"]
            ],
        )
        for episode in FIXTURE_SCRIPT["episodes"]
    ]


class FakeLlm:
    def __init__(self, drafts: list[EpisodeDraft], fixes: list[SceneFixes | Exception] | None = None) -> None:
        self.drafts = drafts
        self.fixes = fixes or []
        self.calls: list[tuple[str, str, type[BaseModel]]] = []

    async def __call__(self, system: str, prompt: str, model: type[BaseModel]) -> BaseModel:
        self.calls.append((system, prompt, model))
        if model is SceneFixes:
            fix = self.fixes.pop(0)
            if isinstance(fix, Exception):
                raise fix
            return fix
        match = EPISODE_NUMBER.search(prompt)
        assert match is not None
        return self.drafts[int(match.group(1)) - 1]


def install(monkeypatch: pytest.MonkeyPatch, fake: FakeLlm) -> FakeLlm:
    monkeypatch.setattr(script_writer, "generate_json", fake)
    return fake


def with_scene(draft: EpisodeDraft, index: int, **changes: object) -> EpisodeDraft:
    scenes = list(draft.scenes)
    scenes[index] = scenes[index].model_copy(update=changes)
    return draft.model_copy(update={"scenes": scenes})


def test_split_source_uses_paragraphs() -> None:
    assert script_writer.split_source(SOURCE_TEXT, 3) == [p.strip() for p in SOURCE_TEXT.split("\n\n")]


def test_split_source_falls_back_to_sentences() -> None:
    one_paragraph = normalize(SOURCE_TEXT)

    chunks = script_writer.split_source(one_paragraph, 3)

    assert len(chunks) == 3
    assert " ".join(chunks) == one_paragraph


def test_split_source_never_returns_empty_chunks() -> None:
    assert script_writer.split_source("Одно длинное предложение без точки в конце" * 6, 3) == [
        "Одно длинное предложение без точки в конце" * 6
    ]


async def test_fixture_script_is_written_in_parallel_and_grounded(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = install(monkeypatch, FakeLlm(fixture_drafts()))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert len(fake.calls) == 3
    assert all(model is EpisodeDraft and "Russian" in system for system, _, model in fake.calls)
    assert script.course_title == FIXTURE_SCRIPT["course_title"]
    assert [episode.title for episode in script.episodes] == [e["title"] for e in FIXTURE_SCRIPT["episodes"]]
    assert {episode.template for episode in script.episodes} == {"parkour_duo"}
    source = normalize(SOURCE_TEXT)
    for episode in script.episodes:
        for scene in episode.scenes:
            assert scene.source_quote is None or scene.source_quote in source
            assert scene.highlight is None or scene.highlight in scene.text


async def test_forced_template_applies_to_every_episode(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, FakeLlm(fixture_drafts()))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, "fake_chat")

    assert {episode.template for episode in script.episodes} == {"fake_chat"}


async def test_near_verbatim_quote_needs_no_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    quote = drafts[2].scenes[1].source_quote
    assert quote is not None
    drafts[2] = with_scene(drafts[2], 1, source_quote=f"«{quote.rstrip('.').replace(':', ' -')}»")
    fake = install(monkeypatch, FakeLlm(drafts))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert len(fake.calls) == 3
    assert script.episodes[2].scenes[1].source_quote == normalize(quote)


async def test_invented_quote_is_repaired_once(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    original = drafts[1].scenes[0]
    drafts[1] = with_scene(drafts[1], 0, source_quote="Прошивка всегда безопасна.")
    fake = install(monkeypatch, FakeLlm(drafts, fixes=[SceneFixes(scenes=[original])]))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    repairs = [prompt for _, prompt, model in fake.calls if model is SceneFixes]
    assert len(repairs) == 1
    assert "Прошивка всегда безопасна." in repairs[0]
    assert "source_quote is not a sentence" in repairs[0]
    assert script.episodes[1].scenes[0].source_quote == original.source_quote
    assert len(script.episodes[1].scenes) == 3


async def test_scene_still_wrong_after_repair_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    bad = drafts[1].scenes[0].model_copy(update={"source_quote": "Прошивка всегда безопасна."})
    drafts[1] = with_scene(drafts[1], 0, source_quote=bad.source_quote)
    install(monkeypatch, FakeLlm(drafts, fixes=[SceneFixes(scenes=[bad])]))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert len(script.episodes[1].scenes) == 2
    assert script.episodes[1].scenes[0].text == drafts[1].scenes[1].text


async def test_failed_repair_call_drops_only_the_bad_scenes(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    drafts[0] = with_scene(drafts[0], 2, text="слово " * 50)
    install(monkeypatch, FakeLlm(drafts, fixes=[LlmUnavailableError("down")]))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert len(script.episodes[0].scenes) == 3
    assert len(script.episodes) == 3


async def test_episode_without_grounded_scenes_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    for index in range(len(drafts[2].scenes)):
        drafts[2] = with_scene(drafts[2], index, source_quote="Этого нет в тексте.")
    install(monkeypatch, FakeLlm(drafts, fixes=[LlmUnavailableError("down")]))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert [episode.title for episode in script.episodes] == [e["title"] for e in FIXTURE_SCRIPT["episodes"][:2]]


async def test_no_grounded_episode_is_llm_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = [
        draft.model_copy(update={"scenes": [s.model_copy(update={"source_quote": "Выдумка."}) for s in draft.scenes]})
        for draft in fixture_drafts()
    ]
    install(monkeypatch, FakeLlm(drafts, fixes=[LlmUnavailableError("down")] * 3))

    with pytest.raises(LlmUnavailableError):
        await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)


async def test_provider_error_surfaces_as_app_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def rate_limited(system: str, prompt: str, model: type[BaseModel]) -> BaseModel:
        raise RateLimitedError("busy")

    monkeypatch.setattr(script_writer, "generate_json", rate_limited)

    with pytest.raises(RateLimitedError):
        await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)


async def test_teacher_line_without_quote_is_repaired(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    original = drafts[0].scenes[2]
    drafts[0] = with_scene(drafts[0], 2, source_quote=None)
    fake = install(monkeypatch, FakeLlm(drafts, fixes=[SceneFixes(scenes=[original])]))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert sum(model is SceneFixes for _, _, model in fake.calls) == 1
    assert script.episodes[0].scenes[2].source_quote == original.source_quote


async def test_repair_that_drops_the_quote_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    invented = "Чем агрессивнее прошивка, тем дольше живёт двигатель."
    student = drafts[2].scenes[0].model_copy(update={"text": "Агрессивная прошивка продлевает жизнь мотору!"})
    drafts[2] = with_scene(drafts[2], 0, text=student.text, source_quote=invented)
    install(
        monkeypatch, FakeLlm(drafts, fixes=[SceneFixes(scenes=[student.model_copy(update={"source_quote": None})])])
    )

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert student.text not in [scene.text for scene in script.episodes[2].scenes]


async def test_repair_that_switches_speaker_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    teacher = drafts[1].scenes[0]
    drafts[1] = with_scene(drafts[1], 0, source_quote="Прошивка всегда безопасна и удваивает мощность.")
    as_student = teacher.model_copy(update={"speaker": "student", "source_quote": None})
    install(monkeypatch, FakeLlm(drafts, fixes=[SceneFixes(scenes=[as_student])]))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert teacher.text not in [scene.text for scene in script.episodes[1].scenes]
