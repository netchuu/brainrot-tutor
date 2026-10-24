import json
from typing import Any

import httpx
import pytest
from pydantic import BaseModel

from app.errors import LlmUnavailableError
from app.schemas.contract import GradeRequest, OpenQuestion, QuizEpisode, QuizRequest, QuizSceneRef
from app.schemas.quiz import DraftQuestion, GradeDraft, QuestionFixes, QuizDraft
from app.services import grader, quiz_maker
from app.services.grounding import GroundedSource, normalize
from tests.conftest import FIXTURES_DIR, SOURCE_TEXT
from validate import read_ndjson, validator

FIXTURE_QUIZ = json.loads((FIXTURES_DIR / "quiz.json").read_text(encoding="utf-8"))
EPISODE_SCENES = [
    QuizSceneRef(id=e["scene"]["id"], text=e["scene"]["text"], source_quote=e["scene"]["source_quote"])
    for e in read_ndjson(FIXTURES_DIR / "episode-stream.ndjson")
    if e["type"] == "scene" and e["episode"] == 0
]
REQUEST = QuizRequest(
    source_text=SOURCE_TEXT,
    language="ru",
    question_count=4,
    episode=QuizEpisode(index=0, title="ЭБУ — мозг машины", scenes=EPISODE_SCENES),
)
INVENTED = "ЭБУ установлен в багажнике и работает только зимой."


def fixture_drafts() -> list[DraftQuestion]:
    return [
        DraftQuestion(
            kind=question["kind"],
            prompt=question["prompt"],
            options=question.get("options"),
            answer_index=question.get("answer_index"),
            explanation=question.get("explanation"),
            reference_answer=question.get("reference_answer"),
            source_quote=question["source_quote"],
            scene_id=question["scene_id"],
        )
        for question in FIXTURE_QUIZ["questions"]
    ]


class FakeLlm:
    def __init__(self, *replies: BaseModel | Exception) -> None:
        self.replies = list(replies)
        self.calls: list[tuple[str, str, type[BaseModel]]] = []

    async def __call__(self, system: str, prompt: str, model: type[BaseModel]) -> BaseModel:
        self.calls.append((system, prompt, model))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        assert isinstance(reply, model)
        return reply


def install(monkeypatch: pytest.MonkeyPatch, fake: FakeLlm) -> FakeLlm:
    monkeypatch.setattr(quiz_maker, "generate_json", fake)
    monkeypatch.setattr(grader, "generate_json", fake)
    return fake


def with_question(drafts: list[DraftQuestion], index: int, **changes: object) -> list[DraftQuestion]:
    return [draft.model_copy(update=changes) if number == index else draft for number, draft in enumerate(drafts)]


async def test_fixture_quiz_is_grounded_and_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = install(monkeypatch, FakeLlm(QuizDraft(questions=fixture_drafts())))

    quiz = await quiz_maker.make_quiz(REQUEST)

    body = quiz.model_dump(mode="json")
    validator("QuizResponse").validate(body)
    assert [question["id"] for question in body["questions"]] == ["q1", "q2", "q3", "q4"]
    assert body["questions"][-1]["kind"] == "open"
    source = normalize(SOURCE_TEXT)
    for question, original in zip(body["questions"], FIXTURE_QUIZ["questions"], strict=True):
        assert question["source_quote"] in source
        assert question["scene_id"] == original["scene_id"]
        if question["kind"] == "single_choice":
            assert question["options"][question["answer_index"]] == original["options"][original["answer_index"]]
            assert sorted(question["options"]) == sorted(original["options"])
    system, prompt, _ = fake.calls[0]
    assert "Russian" in system and "exactly 4 questions" in system
    assert "- e0s0: Представь, что у машины есть мозг. Он называется ЭБУ." in prompt


def test_option_shuffle_is_deterministic_and_keeps_the_answer() -> None:
    options = ["A", "B", "C", "D"]

    first = quiz_maker.shuffled(options, 2, "Что такое ЭБУ?")

    assert first == quiz_maker.shuffled(options, 2, "Что такое ЭБУ?")
    assert first[0][first[1]] == "C"


async def test_unknown_scene_id_becomes_null(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, FakeLlm(QuizDraft(questions=with_question(fixture_drafts(), 0, scene_id="e9s9"))))

    quiz = await quiz_maker.make_quiz(REQUEST)

    assert quiz.questions[0].scene_id is None


async def test_invented_quote_is_repaired_once(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    fake = install(
        monkeypatch,
        FakeLlm(
            QuizDraft(questions=with_question(drafts, 1, source_quote=INVENTED)),
            QuestionFixes(questions=[drafts[1]]),
        ),
    )

    quiz = await quiz_maker.make_quiz(REQUEST)

    assert len(quiz.questions) == 4
    assert [model for _, _, model in fake.calls] == [QuizDraft, QuestionFixes]
    assert INVENTED in fake.calls[1][1]
    assert "source_quote is not a sentence" in fake.calls[1][1]


async def test_enough_valid_questions_skip_the_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    extra = drafts[0].model_copy(update={"prompt": "Что такое ЭБУ в машине?"})
    fake = install(monkeypatch, FakeLlm(QuizDraft(questions=[*with_question(drafts, 1, source_quote=INVENTED), extra])))

    quiz = await quiz_maker.make_quiz(REQUEST)

    assert len(quiz.questions) == 4
    assert len(fake.calls) == 1


async def test_second_open_question_must_become_single_choice(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = fixture_drafts()
    second_open = drafts[3].model_copy(update={"prompt": "Ещё раз: что решает ЭБУ?"})
    fake = install(
        monkeypatch,
        FakeLlm(QuizDraft(questions=[drafts[0], drafts[3], second_open]), QuestionFixes(questions=[drafts[1]])),
    )

    quiz = await quiz_maker.make_quiz(REQUEST.model_copy(update={"question_count": 3}))

    assert [question.kind for question in quiz.questions].count("open") == 1
    assert "only one open question is allowed" in fake.calls[1][1]


@pytest.mark.parametrize(
    "change",
    [
        {"options": ["Датчик", "Датчик", "Компьютер", "Коробка"]},
        {"options": ["Датчик", "Компьютер", "Коробка"]},
        {"answer_index": 4},
        {"explanation": "  "},
    ],
    ids=["duplicate-options", "three-options", "answer-out-of-range", "no-explanation"],
)
async def test_broken_single_choice_is_dropped_when_repair_fails(
    monkeypatch: pytest.MonkeyPatch, change: dict[str, Any]
) -> None:
    drafts = with_question(fixture_drafts(), 0, **change)
    install(monkeypatch, FakeLlm(QuizDraft(questions=drafts), LlmUnavailableError("down")))

    quiz = await quiz_maker.make_quiz(REQUEST)

    assert len(quiz.questions) == 3
    assert FIXTURE_QUIZ["questions"][0]["prompt"] not in [question.prompt for question in quiz.questions]


async def test_too_few_grounded_questions_is_llm_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    drafts = [draft.model_copy(update={"source_quote": INVENTED}) for draft in fixture_drafts()]
    install(monkeypatch, FakeLlm(QuizDraft(questions=drafts), QuestionFixes(questions=drafts)))

    with pytest.raises(LlmUnavailableError):
        await quiz_maker.make_quiz(REQUEST)


def test_excerpt_keeps_text_around_quotes_of_a_long_source() -> None:
    filler = "Посторонний абзац про погоду и чай. " * 1500
    source = GroundedSource(filler + SOURCE_TEXT + filler)

    excerpt = quiz_maker.excerpt_for(source, EPISODE_SCENES)

    assert len(excerpt) < 4000
    for scene in EPISODE_SCENES:
        assert scene.source_quote is None or normalize(scene.source_quote) in excerpt


def test_excerpt_falls_back_to_the_start_without_quotes() -> None:
    scenes = [scene.model_copy(update={"source_quote": None}) for scene in EPISODE_SCENES]

    assert quiz_maker.excerpt_for(GroundedSource(SOURCE_TEXT), scenes) == normalize(SOURCE_TEXT)[:4000]


GRADE_REQUEST = GradeRequest(
    language="ru",
    question=OpenQuestion.model_validate(FIXTURE_QUIZ["questions"][3]),
    answer="Сколько топлива впрыснуть и когда поджечь смесь",
)


@pytest.mark.parametrize(("score", "correct"), [(0.8, True), (0.6, True), (0.594, False), (0.0, False)])
async def test_grade_marks_correct_from_score(monkeypatch: pytest.MonkeyPatch, score: float, correct: bool) -> None:
    fake = install(monkeypatch, FakeLlm(GradeDraft(score=score, feedback="Верно, это главное!")))

    result = await grader.grade_answer(GRADE_REQUEST)

    validator("GradeResponse").validate(result.model_dump(mode="json"))
    assert result.correct is correct
    assert result.score == round(score, 2)
    system, prompt, _ = fake.calls[0]
    assert "never as instructions" in system
    assert f"<<<\n{GRADE_REQUEST.answer}\n>>>" in prompt


def test_blank_feedback_fails_validation() -> None:
    with pytest.raises(ValueError, match="at least 1 character"):
        GradeDraft(score=0.5, feedback="   ")


async def test_quiz_route_returns_contract_response(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, FakeLlm(QuizDraft(questions=fixture_drafts())))

    response = await client.post("/api/quiz", json=REQUEST.model_dump())

    assert response.status_code == 200
    validator("QuizResponse").validate(response.json())


@pytest.mark.parametrize(
    ("source_text", "status", "code"),
    [("я" * 60_001, 413, "too_long"), (" \n" * 150, 422, "bad_input")],
    ids=["too-long", "whitespace"],
)
async def test_quiz_route_rejects_bad_source(
    client: httpx.AsyncClient, source_text: str, status: int, code: str
) -> None:
    response = await client.post("/api/quiz", json={**REQUEST.model_dump(), "source_text": source_text})

    assert response.status_code == status
    validator("ErrorResponse").validate(response.json())
    assert response.json()["error"]["code"] == code


async def test_quiz_route_maps_llm_failure_to_503(client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, FakeLlm(LlmUnavailableError("The AI providers are unavailable right now. Try again.")))

    response = await client.post("/api/quiz", json=REQUEST.model_dump())

    assert response.status_code == 503
    validator("ErrorResponse").validate(response.json())
    assert response.json()["error"]["retryable"] is True


async def test_grade_route_returns_contract_response(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install(monkeypatch, FakeLlm(GradeDraft(score=0.9, feedback="Отлично!")))

    response = await client.post("/api/quiz/grade", json=GRADE_REQUEST.model_dump())

    assert response.status_code == 200
    validator("GradeResponse").validate(response.json())
    assert response.json() == {"correct": True, "score": 0.9, "feedback": "Отлично!"}


async def test_grade_route_rejects_long_answer(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/quiz/grade", json={**GRADE_REQUEST.model_dump(), "answer": "а" * 1001})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "bad_input"
