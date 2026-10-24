from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.schemas.contract import GradeRequest, GradeResponse
from app.schemas.quiz import GradeDraft
from app.services.script_writer import LANGUAGE_NAMES

SYSTEM_PROMPT = Template((PROMPTS_DIR / "grade.md").read_text(encoding="utf-8"))
ANSWER_PROMPT = Template((PROMPTS_DIR / "grade_answer.md").read_text(encoding="utf-8"))
PASS_SCORE = 0.6


async def grade_answer(request: GradeRequest) -> GradeResponse:
    system = SYSTEM_PROMPT.substitute(language_name=LANGUAGE_NAMES[request.language])
    prompt = ANSWER_PROMPT.substitute(
        question=request.question.prompt,
        reference=request.question.reference_answer,
        quote=request.question.source_quote,
        answer=request.answer,
    )
    draft = await generate_json(system, prompt, GradeDraft)
    score = round(draft.score, 2)
    return GradeResponse(correct=score >= PASS_SCORE, score=score, feedback=draft.feedback)
