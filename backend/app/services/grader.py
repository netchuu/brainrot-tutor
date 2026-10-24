import asyncio
from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import LlmUnavailableError
from app.schemas.contract import GradeRequest, GradeResponse
from app.schemas.quiz import GradeDraft
from app.services.cache import LruCache, cache_key
from app.services.grounding import defang
from app.services.script_writer import LANGUAGE_NAMES

SYSTEM_PROMPT = Template((PROMPTS_DIR / "grade.md").read_text(encoding="utf-8"))
ANSWER_PROMPT = Template((PROMPTS_DIR / "grade_answer.md").read_text(encoding="utf-8"))
PASS_SCORE = 0.6
# Vercel stops the function at 60 s; answering earlier keeps the contract error shape.
GRADE_DEADLINE_S = 50
GRADE_CACHE: LruCache[GradeResponse] = LruCache(256)


async def grade_answer(request: GradeRequest) -> GradeResponse:
    key = cache_key("grade", request.model_dump(mode="json"))
    cached = GRADE_CACHE.get(key)
    if cached is not None:
        return cached
    system = SYSTEM_PROMPT.substitute(language_name=LANGUAGE_NAMES[request.language])
    prompt = ANSWER_PROMPT.substitute(
        question=defang(request.question.prompt),
        reference=defang(request.question.reference_answer),
        quote=defang(request.question.source_quote),
        answer=defang(request.answer),
    )
    try:
        async with asyncio.timeout(GRADE_DEADLINE_S):
            draft = await generate_json(system, prompt, GradeDraft)
    except TimeoutError:
        raise LlmUnavailableError("Grading took too long. Try again.") from None
    score = round(draft.score, 2)
    result = GradeResponse(correct=score >= PASS_SCORE, score=score, feedback=draft.feedback)
    GRADE_CACHE.put(key, result)
    return result
