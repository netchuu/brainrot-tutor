import hashlib
import json
import logging
import random
from dataclasses import dataclass
from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import LlmUnavailableError, RateLimitedError
from app.schemas.contract import OpenQuestion, QuizRequest, QuizResponse, QuizSceneRef, SingleChoiceQuestion
from app.schemas.quiz import DraftQuestion, QuestionFixes, QuizDraft
from app.services.grounding import GroundedSource, normalize
from app.services.script_writer import LANGUAGE_NAMES

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = Template((PROMPTS_DIR / "quiz.md").read_text(encoding="utf-8"))
QUIZ_PROMPT = Template((PROMPTS_DIR / "quiz_episode.md").read_text(encoding="utf-8"))
REPAIR_PROMPT = Template((PROMPTS_DIR / "quiz_repair.md").read_text(encoding="utf-8"))
MIN_QUESTIONS = 3
OPTION_COUNT = 4
EXCERPT_RADIUS = 600
FALLBACK_EXCERPT_CHARS = 4000

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


def check_question(
    draft: DraftQuestion, source: GroundedSource, scene_ids: set[str], open_taken: bool
) -> QuestionCheck:
    problems: list[str] = []
    prompt = normalize(draft.prompt)
    if not prompt:
        problems.append("prompt is empty")
    quote = source.snap_quote(draft.source_quote)
    if quote is None:
        problems.append("source_quote is not a sentence copied word for word from the SOURCE EXCERPT")
    scene_id = draft.scene_id if draft.scene_id in scene_ids else None
    if draft.kind == "open":
        reference = normalize(draft.reference_answer or "")
        if not reference:
            problems.append("an open question needs a reference_answer")
        if open_taken:
            problems.append("only one open question is allowed; make this a single_choice question")
        if problems or quote is None:
            return QuestionCheck(question=None, problems=problems)
        question: AnyQuestion = OpenQuestion(
            id="q0", kind="open", prompt=prompt, reference_answer=reference, source_quote=quote, scene_id=scene_id
        )
        return QuestionCheck(question=question, problems=[])
    options = [normalize(option) for option in draft.options or []]
    explanation = normalize(draft.explanation or "")
    if (
        len(options) != OPTION_COUNT
        or not all(options)
        or len({option.casefold() for option in options}) != len(options)
    ):
        problems.append("a single_choice question needs exactly 4 different, non-empty options")
    if draft.answer_index is None or not 0 <= draft.answer_index < OPTION_COUNT:
        problems.append("answer_index must be 0, 1, 2 or 3")
    if not explanation:
        problems.append("a single_choice question needs an explanation")
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
    drafts: list[DraftQuestion], source: GroundedSource, scene_ids: set[str], open_taken: bool
) -> list[QuestionCheck]:
    checks: list[QuestionCheck] = []
    for draft in drafts:
        check = check_question(draft, source, scene_ids, open_taken)
        open_taken = open_taken or (check.question is not None and check.question.kind == "open")
        checks.append(check)
    return checks


def describe_failures(failing: list[tuple[DraftQuestion, list[str]]]) -> str:
    return "\n\n".join(
        f"Question {number}: {json.dumps(draft.model_dump(), ensure_ascii=False)}\nProblems: {'; '.join(problems)}"
        for number, (draft, problems) in enumerate(failing, start=1)
    )


async def repair_questions(
    system: str, context: dict[str, str], failing: list[tuple[DraftQuestion, list[str]]]
) -> list[DraftQuestion]:
    prompt = REPAIR_PROMPT.substitute(context, count=len(failing), problems=describe_failures(failing))
    try:
        fixes = await generate_json(system, prompt, QuestionFixes)
    except (RateLimitedError, LlmUnavailableError) as exc:
        logger.warning("quiz repair call failed (%s), dropping %d questions", exc.code, len(failing))
        return []
    return fixes.questions[: len(failing)]


async def make_quiz(request: QuizRequest) -> QuizResponse:
    source = GroundedSource(request.source_text)
    scenes = request.episode.scenes
    scene_ids = {scene.id for scene in scenes}
    system = SYSTEM_PROMPT.substitute(language_name=LANGUAGE_NAMES[request.language], count=request.question_count)
    context = {
        "title": request.episode.title,
        "scenes": "\n".join(f"- {scene.id}: {normalize(scene.text)}" for scene in scenes),
        "excerpt": excerpt_for(source, scenes),
    }
    draft = await generate_json(system, QUIZ_PROMPT.substitute(context), QuizDraft)
    checks = check_all(draft.questions, source, scene_ids, open_taken=False)
    kept = [check.question for check in checks if check.question is not None]
    failing = [
        (question, check.problems) for question, check in zip(draft.questions, checks, strict=True) if check.problems
    ]
    if failing and len(kept) < request.question_count:
        logger.info("quiz: %d of %d questions failed checks, repairing", len(failing), len(checks))
        open_taken = any(question.kind == "open" for question in kept)
        repaired = check_all(await repair_questions(system, context, failing), source, scene_ids, open_taken)
        kept += [check.question for check in repaired if check.question is not None]
    kept = sorted(kept[: request.question_count], key=lambda question: question.kind == "open")
    if len(kept) < MIN_QUESTIONS:
        raise LlmUnavailableError("The AI could not write a quiz grounded in this text. Try again.")
    questions = [question.model_copy(update={"id": f"q{number}"}) for number, question in enumerate(kept, start=1)]
    return QuizResponse(episode=request.episode.index, questions=questions)
