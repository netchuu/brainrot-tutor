from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

QuestionKind = Literal["single_choice", "open"]


class QuizModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftQuestion(QuizModel):
    kind: QuestionKind
    prompt: str
    options: list[str] | None
    answer_index: int | None
    explanation: str | None
    reference_answer: str | None
    source_quote: str
    scene_id: str | None


class QuizDraft(QuizModel):
    questions: list[DraftQuestion] = Field(min_length=1, max_length=6)


class QuestionFixes(QuizModel):
    questions: list[DraftQuestion] = Field(min_length=1, max_length=6)


class GradeDraft(QuizModel):
    score: float = Field(ge=0, le=1)
    feedback: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class TutorDraft(QuizModel):
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    covered: bool
    source_quotes: list[str]
