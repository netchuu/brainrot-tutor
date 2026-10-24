import asyncio
from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import LlmUnavailableError
from app.schemas.contract import GradeRequest, GradeResponse
from app.schemas.quiz import GradeDraft
from app.services.grounding import defang
from app.services.script_writer import LANGUAGE_NAMES

SYSTEM_PROMPT = Template((PROMPTS_DIR / "grade.md").read_text(encoding="utf-8"))
ANSWER_PROMPT = Template((PROMPTS_DIR / "grade_answer.md").read_text(encoding="utf-8"))
PASS_SCORE = 0.6
# Vercel stops the function at 60 s; answering earlier keeps the contract error shape.
GRADE_DEADLINE_S = 50
PROMPT_FIELD_CHARS = 1000


async def grade_answer(request: GradeRequest) -> GradeResponse:
    system = SYSTEM_PROMPT.substitute(language_name=LANGUAGE_NAMES[request.language])
    prompt = ANSWER_PROMPT.substitute(
        question=defang(request.question.prompt[:PROMPT_FIELD_CHARS]),
        reference=defang(request.question.reference_answer[:PROMPT_FIELD_CHARS]),
        quote=defang(request.question.source_quote[:PROMPT_FIELD_CHARS]),
        answer=defang(request.answer),
    )
    try:
        async with asyncio.timeout(GRADE_DEADLINE_S):
            draft = await generate_json(system, prompt, GradeDraft)
    except TimeoutError:
        raise LlmUnavailableError("Grading took too long. Try again.") from None
    score = round(draft.score, 2)
    return GradeResponse(correct=score >= PASS_SCORE, score=score, feedback=draft.feedback)
