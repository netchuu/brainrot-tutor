import re

import pytest
from pydantic import BaseModel

from app.errors import LlmUnavailableError, RateLimitedError
from app.schemas.script import EpisodeDraft, SceneFixes
from app.services import script_writer
from app.services.grounding import normalize
from tests.conftest import FIXTURE_SCRIPT, SOURCE_TEXT, fixture_drafts

EPISODE_NUMBER = re.compile(r"^Episode (\d+) of (\d+)\.", re.MULTILINE)


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
    assert [episode.template for episode in script.episodes] == [e["template"] for e in FIXTURE_SCRIPT["episodes"]]
    assert script.episodes[1].scenes[1].formula == "P = \\frac{M \\times n}{7023}"
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


async def test_one_failed_episode_keeps_the_others(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeLlm(fixture_drafts())

    async def flaky(system: str, prompt: str, model: type[BaseModel]) -> BaseModel:
        if "Episode 2 of 3." in prompt:
            raise RateLimitedError("busy")
        return await fake(system, prompt, model)

    monkeypatch.setattr(script_writer, "generate_json", flaky)

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert [episode.number for episode in script.episodes] == [0, 2]


async def test_ready_callback_gets_each_episode_final_scenes(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    drafts[1] = with_scene(drafts[1], 0, source_quote="Прошивка всегда безопасна и удваивает мощность.")
    install(monkeypatch, FakeLlm(drafts, fixes=[LlmUnavailableError("down")]))
    ready: dict[int, list[str]] = {}

    script = await script_writer.write_script(
        SOURCE_TEXT, "ru", 3, None, lambda number, scenes: ready.update({number: [s.text for s in scenes]})
    )

    assert ready == {episode.number: [scene.text for scene in episode.scenes] for episode in script.episodes}
    assert len(ready[1]) == 2


async def test_ai_cannot_choose_a_template_the_player_lacks(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = [draft.model_copy(update={"template": "top3_countdown"}) for draft in fixture_drafts()]
    fake = install(monkeypatch, FakeLlm(drafts))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert {episode.template for episode in script.episodes} == {"parkour_duo"}
    assert "Choose the template that fits" in fake.calls[0][0]


async def test_forced_template_is_named_in_the_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = install(monkeypatch, FakeLlm(fixture_drafts()))

    await script_writer.write_script(SOURCE_TEXT, "ru", 3, "myth_or_fact")

    assert 'The template is fixed: put "myth_or_fact" in template' in fake.calls[0][0]


def test_slots_are_cleared_outside_their_template() -> None:
    scene = fixture_drafts()[1].scenes[1].model_copy(update={"rank": 2, "verdict": "fact"})

    parkour = script_writer.fit_template(scene, "parkour_duo", SOURCE_TEXT)
    split = script_writer.fit_template(scene, "split_screen", SOURCE_TEXT)
    top3 = script_writer.fit_template(scene, "top3_countdown", SOURCE_TEXT)
    myth = script_writer.fit_template(scene, "myth_or_fact", SOURCE_TEXT)

    assert (parkour.formula, parkour.term, parkour.rank, parkour.verdict) == (None, None, None, None)
    assert (split.formula, split.rank, split.verdict) == (scene.formula, None, None)
    assert (top3.rank, top3.formula) == (2, None)
    assert (myth.verdict, myth.rank) == ("fact", None)


@pytest.mark.parametrize(
    ("formula", "term", "expected"),
    [
        ("$P = M \\times n$", None, ("P = M \\times n", None)),
        (None, "Чип-тюнинг = изменение карт ЭБУ", (None, "Чип-тюнинг = изменение карт ЭБУ")),
        (None, "т" * 81, (None, None)),
        ("x" * 201, "  ", (None, None)),
    ],
    ids=["dollar-signs", "term", "long-term", "long-formula"],
)
def test_split_screen_slots_are_cleaned(
    formula: str | None, term: str | None, expected: tuple[str | None, ...]
) -> None:
    scene = fixture_drafts()[1].scenes[0].model_copy(update={"formula": formula, "term": term})

    fitted = script_writer.fit_template(scene, "split_screen", SOURCE_TEXT)

    assert (fitted.formula, fitted.term) == expected


def test_out_of_range_rank_is_cleared() -> None:
    scene = fixture_drafts()[0].scenes[0].model_copy(update={"rank": 4})

    assert script_writer.fit_template(scene, "top3_countdown", SOURCE_TEXT).rank is None


@pytest.mark.parametrize(
    ("formula", "expected"),
    [
        ("$P$ = $M$", "P = M"),
        ("\\(P = \\frac{M \\times n}{7023}\\)", "P = \\frac{M \\times n}{7023}"),
        ("E = m c^2", None),
        ("P = \\frac{200 \\times 5000}{7023} \\approx 142", "P = \\frac{200 \\times 5000}{7023} \\approx 142"),
    ],
    ids=["inner-dollars", "paren-delimiters", "foreign-formula", "worked-example-from-line"],
)
def test_formula_must_come_from_fragment_or_line(formula: str, expected: str | None) -> None:
    scene = fixture_drafts()[1].scenes[2].model_copy(update={"formula": formula})

    assert script_writer.fit_template(scene, "split_screen", SOURCE_TEXT.split("\n\n")[1]).formula == expected


def test_term_must_share_words_with_its_line() -> None:
    scene = fixture_drafts()[1].scenes[0]
    foreign = scene.model_copy(update={"term": "Фотосинтез = свет в сахар"})

    assert script_writer.fit_template(scene, "split_screen", SOURCE_TEXT).term == scene.term
    assert script_writer.fit_template(foreign, "split_screen", SOURCE_TEXT).term is None


@pytest.mark.parametrize(("chosen", "expected"), [("fake_chat", "fake_chat"), ("myth_or_fact", "parkour_duo")])
async def test_unforced_template_choice(monkeypatch: pytest.MonkeyPatch, chosen: str, expected: str) -> None:
    drafts = [draft.model_copy(update={"template": chosen}) for draft in fixture_drafts()]
    install(monkeypatch, FakeLlm(drafts))

    script = await script_writer.write_script(SOURCE_TEXT, "ru", 3, None)

    assert {episode.template for episode in script.episodes} == {expected}
