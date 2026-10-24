import asyncio
import hashlib
import json
import logging
import random
import re
import time
from dataclasses import dataclass
from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import LlmUnavailableError, RateLimitedError
from app.schemas.contract import OpenQuestion, QuizRequest, QuizResponse, QuizSceneRef, SingleChoiceQuestion
from app.schemas.quiz import DraftQuestion, QuestionFixes, QuizDraft
from app.services.grounding import GroundedSource, defang, normalize
from app.services.script_writer import LANGUAGE_NAMES

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = Template((PROMPTS_DIR / "quiz.md").read_text(encoding="utf-8"))
QUIZ_PROMPT = Template((PROMPTS_DIR / "quiz_episode.md").read_text(encoding="utf-8"))
REPAIR_PROMPT = Template((PROMPTS_DIR / "quiz_repair.md").read_text(encoding="utf-8"))
MIN_QUESTIONS = 3
OPTION_COUNT = 4
EXCERPT_RADIUS = 600
FALLBACK_EXCERPT_CHARS = 4000
OPEN_FIELD_CHARS = 500
# Scene ids have no schema limit, so the prompt forwards only a short prefix.
PROMPT_ID_CHARS = 20
# Vercel stops the function at 60 s; a repair only starts while it can still finish in time.
QUIZ_DEADLINE_S = 50
REPAIR_CUTOFF_S = 25
OPEN_NOTE = "\nAn open question is already in the quiz, so every rewritten question must be single_choice."
POSITIONAL_OPTION = re.compile(
    r"all of the above|none of the above|both of the above|all of these|none of these"
    r"|(все|оба|обе|ни один|ничего)\W+(из\W+)?(вышеперечисленн|перечисленн|вариант|выше)",
    re.IGNORECASE,
)
POSITIONAL_EXPLANATION = re.compile(r"\b(option|answer|вариант|ответ)\s+[abcdабвг1-4]\b", re.IGNORECASE)

AnyQuestion = SingleChoiceQuestion | OpenQuestion


@dataclass(frozen=True)
class QuestionCheck:
    question: AnyQuestion | None
    problems: list[str]


def excerpt_for(source: GroundedSource, scenes: list[QuizSceneRef]) -> str:
    # Only the text around the episode's quotes is sent, which keeps a 60,000-character source within token limits.
    spans: list[tuple[int, int]] = []
    for scene in scenes:
        quote = normalize(scene.source_quote or "")
        start = source.text.find(quote) if quote else -1
        if start >= 0:
            spans.append((max(0, start - EXCERPT_RADIUS), min(len(source.text), start + len(quote) + EXCERPT_RADIUS)))
    if not spans:
        return source.text[:FALLBACK_EXCERPT_CHARS]
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return " … ".join(source.text[start:end] for start, end in merged)


def shuffled(options: list[str], answer_index: int, prompt: str) -> tuple[list[str], int]:
    # Models favour one answer position, so options are reordered with a seed taken from the question.
    order = list(range(len(options)))
    random.Random(hashlib.sha256(prompt.encode("utf-8")).digest()).shuffle(order)
    return [options[index] for index in order], order.index(answer_index)


def single_choice_problems(draft: DraftQuestion, options: list[str], explanation: str) -> list[str]:
    problems: list[str] = []
    distinct = len({option.casefold() for option in options})
    if len(options) != OPTION_COUNT or not all(options) or distinct != len(options):
        problems.append("a single_choice question needs exactly 4 different, non-empty options")
    if any(POSITIONAL_OPTION.search(option) for option in options):
        problems.append("options are shuffled, so no option may refer to the others (all, both, none of the above)")
    if draft.answer_index is None or not 0 <= draft.answer_index < OPTION_COUNT:
        problems.append("answer_index must be 0, 1, 2 or 3")
    if not explanation:
        problems.append("a single_choice question needs an explanation")
    elif POSITIONAL_EXPLANATION.search(explanation):
        problems.append("options are shuffled, so the explanation must not name an option by letter or number")
    return problems


def check_question(
    draft: DraftQuestion, source: GroundedSource, scene_ids: set[str], kept: list[AnyQuestion]
) -> QuestionCheck:
    problems: list[str] = []
    prompt = normalize(draft.prompt)
    if not prompt:
        problems.append("prompt is empty")
    elif prompt.casefold() in {question.prompt.casefold() for question in kept}:
        problems.append("this question repeats another one; ask about a different fact")
    quote = source.snap_quote(draft.source_quote)
    if quote is None:
        problems.append("source_quote is not one complete sentence copied word for word from the SOURCE EXCERPT")
    scene_id = draft.scene_id if draft.scene_id in scene_ids else None
    if draft.kind == "open":
        reference = normalize(draft.reference_answer or "")
        if not reference:
            problems.append("an open question needs a reference_answer")
        if len(prompt) > OPEN_FIELD_CHARS or len(reference) > OPEN_FIELD_CHARS:
            problems.append("keep the prompt and the reference_answer of an open question under 500 characters each")
        if any(question.kind == "open" for question in kept):
            problems.append("only one open question is allowed; make this a single_choice question")
        if problems or quote is None:
            return QuestionCheck(question=None, problems=problems)
        question: AnyQuestion = OpenQuestion(
            id="q0", kind="open", prompt=prompt, reference_answer=reference, source_quote=quote, scene_id=scene_id
        )
        return QuestionCheck(question=question, problems=[])
    options = [normalize(option) for option in draft.options or []]
    explanation = normalize(draft.explanation or "")
    problems += single_choice_problems(draft, options, explanation)
    if problems or quote is None or draft.answer_index is None:
        return QuestionCheck(question=None, problems=problems)
    ordered, answer_index = shuffled(options, draft.answer_index, prompt)
    question = SingleChoiceQuestion(
        id="q0",
        kind="single_choice",
        prompt=prompt,
        options=ordered,
        answer_index=answer_index,
        explanation=explanation,
        source_quote=quote,
        scene_id=scene_id,
    )
    return QuestionCheck(question=question, problems=[])


def check_all(
    drafts: list[DraftQuestion], source: GroundedSource, scene_ids: set[str], kept: list[AnyQuestion]
) -> list[QuestionCheck]:
    checks: list[QuestionCheck] = []
    for draft in drafts:
        check = check_question(draft, source, scene_ids, kept)
        if check.question is not None:
            kept.append(check.question)
        checks.append(check)
    return checks


def describe_failures(failing: list[tuple[DraftQuestion, list[str]]]) -> str:
    return "\n\n".join(
        f"Question {number}: {json.dumps(draft.model_dump(), ensure_ascii=False)}\nProblems: {'; '.join(problems)}"
        for number, (draft, problems) in enumerate(failing, start=1)
    )


def trimmed(kept: list[AnyQuestion], count: int) -> list[AnyQuestion]:
    opens = [question for question in kept if question.kind == "open"][:1]
    singles = [question for question in kept if question.kind == "single_choice"]
    return singles[: count - len(opens)] + opens


async def write_quiz(request: QuizRequest) -> QuizResponse:
    started = time.perf_counter()
    source = GroundedSource(request.source_text)
    scenes = request.episode.scenes
    scene_ids = {scene.id for scene in scenes}
    system = SYSTEM_PROMPT.substitute(language_name=LANGUAGE_NAMES[request.language])
    context = {
        "title": defang(request.episode.title),
        "scenes": "\n".join(
            f"- {defang(scene.id[:PROMPT_ID_CHARS])}: {defang(normalize(scene.text))}" for scene in scenes
        ),
        "excerpt": defang(excerpt_for(source, scenes)),
    }
    draft = await generate_json(system, QUIZ_PROMPT.substitute(context, count=request.question_count), QuizDraft)
    kept: list[AnyQuestion] = []
    checks = check_all(draft.questions, source, scene_ids, kept)
    failing = [
        (question, check.problems) for question, check in zip(draft.questions, checks, strict=True) if check.problems
    ]
    repair_error: RateLimitedError | LlmUnavailableError | None = None
    if failing and len(kept) < request.question_count and time.perf_counter() - started < REPAIR_CUTOFF_S:
        logger.info("quiz: %d of %d questions failed checks, repairing", len(failing), len(checks))
        note = OPEN_NOTE if any(question.kind == "open" for question in kept) else ""
        prompt = REPAIR_PROMPT.substitute(context, note=note, problems=describe_failures(failing))
        try:
            fixes = await generate_json(system, prompt, QuestionFixes)
            check_all(fixes.questions[: len(failing)], source, scene_ids, kept)
        except (RateLimitedError, LlmUnavailableError) as exc:
            logger.warning("quiz repair call failed with %s", exc.code)
            repair_error = exc
    questions = trimmed(kept, request.question_count)
    if len(questions) < MIN_QUESTIONS:
        if isinstance(repair_error, RateLimitedError):
            raise repair_error
        raise LlmUnavailableError("The AI could not write a quiz grounded in this text. Try again.")
    numbered = [question.model_copy(update={"id": f"q{number}"}) for number, question in enumerate(questions, start=1)]
    return QuizResponse(episode=request.episode.index, questions=numbered)


async def make_quiz(request: QuizRequest) -> QuizResponse:
    try:
        async with asyncio.timeout(QUIZ_DEADLINE_S):
            return await write_quiz(request)
    except TimeoutError:
        raise LlmUnavailableError("Writing the quiz took too long. Try again.") from None
