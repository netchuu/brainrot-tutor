from fastapi import APIRouter

from app.schemas.contract import GradeRequest, GradeResponse, QuizRequest, QuizResponse
from app.services.grader import grade_answer
from app.services.grounding import require_usable_source
from app.services.quiz_maker import make_quiz

router = APIRouter(prefix="/api")


@router.post("/quiz")
async def quiz(body: QuizRequest) -> QuizResponse:
    require_usable_source(body.source_text)
    return await make_quiz(body)


@router.post("/quiz/grade")
async def grade(body: GradeRequest) -> GradeResponse:
    return await grade_answer(body)
