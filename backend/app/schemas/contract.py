from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, WithJsonSchema

Language = Literal["ru", "en"]
TemplateId = Literal["parkour_duo", "split_screen", "fake_chat", "top3_countdown", "myth_or_fact"]
Speaker = Literal["teacher", "student"]
CharacterId = Literal["professor", "mechanic", "robot", "kid", "gamer", "cat"]
BackgroundId = Literal["parkour", "surf", "runner", "satisfying"]
Reaction = Literal["none", "mind_blown", "shocked", "laugh", "thinking", "fire", "check", "cross"]
Sfx = Literal["none", "whoosh", "pop", "boom", "drumroll", "ding", "buzzer"]
ErrorCode = Literal["bad_input", "too_long", "rate_limited", "llm_unavailable", "internal"]
Verdict = Literal["myth", "fact"]
ChatRole = Literal["user", "assistant"]
SourceText = Annotated[str, Field(min_length=200, max_length=60_000)]


def require_absolute_uri(value: str) -> str:
    parts = urlsplit(value)
    if not parts.scheme or not parts.netloc:
        raise ValueError("must be an absolute URI")
    return value


UriString = Annotated[str, AfterValidator(require_absolute_uri), WithJsonSchema({"type": "string", "format": "uri"})]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Word(ContractModel):
    text: str = Field(min_length=1)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class Audio(ContractModel):
    mime: Literal["audio/mpeg"]
    base64: str = Field(min_length=1)
    duration_ms: int = Field(ge=1)


class Picture(ContractModel):
    query: str = Field(min_length=1)
    url: UriString
    credit: str


class Scene(ContractModel):
    id: str = Field(pattern=r"^e[0-9]+s[0-9]+$")
    speaker: Speaker
    text: str = Field(min_length=1, max_length=220)
    highlight: str | None
    words: list[Word] = Field(min_length=1)
    words_estimated: bool
    audio: Audio | None
    picture: Picture | None
    formula: str | None
    term: str | None
    rank: Annotated[int, Field(ge=1, le=3)] | None
    verdict: Verdict | None
    reaction: Reaction
    sfx: Sfx
    source_quote: str | None


class Cast(ContractModel):
    teacher: CharacterId
    student: CharacterId


class EpisodeOutline(ContractModel):
    index: int = Field(ge=0)
    title: str = Field(min_length=1)
    template: TemplateId
    scene_count: int = Field(ge=1, le=8)
    cast: Cast
    background: BackgroundId


class PlanEvent(ContractModel):
    type: Literal["plan"]
    course_title: str = Field(min_length=1)
    language: Language
    episodes: list[EpisodeOutline] = Field(min_length=1, max_length=3)


class SceneEvent(ContractModel):
    type: Literal["scene"]
    episode: int = Field(ge=0)
    index: int = Field(ge=0)
    scene: Scene


class EpisodeDoneEvent(ContractModel):
    type: Literal["episode_done"]
    episode: int = Field(ge=0)


class DoneEvent(ContractModel):
    type: Literal["done"]
    elapsed_ms: int = Field(ge=0)


class ErrorEvent(ContractModel):
    type: Literal["error"]
    code: ErrorCode
    message: str
    retryable: bool


StreamEvent = Annotated[PlanEvent | SceneEvent | EpisodeDoneEvent | DoneEvent | ErrorEvent, Field(discriminator="type")]


class EpisodesRequest(ContractModel):
    source_text: SourceText
    language: Language
    episode_count: int = Field(default=3, ge=1, le=3)
    template: TemplateId | None = None


class QuizSceneRef(ContractModel):
    id: str
    text: str
    source_quote: str | None


class QuizEpisode(ContractModel):
    index: int = Field(ge=0)
    title: str
    scenes: list[QuizSceneRef] = Field(min_length=1)


class QuizRequest(ContractModel):
    source_text: SourceText
    language: Language
    question_count: int = Field(default=4, ge=3, le=5)
    episode: QuizEpisode


class SingleChoiceQuestion(ContractModel):
    id: str
    kind: Literal["single_choice"]
    prompt: str = Field(min_length=1)
    options: list[Annotated[str, Field(min_length=1)]] = Field(min_length=4, max_length=4)
    answer_index: int = Field(ge=0, le=3)
    explanation: str = Field(min_length=1)
    source_quote: str = Field(min_length=1)
    scene_id: str | None


class OpenQuestion(ContractModel):
    id: str
    kind: Literal["open"]
    prompt: str = Field(min_length=1)
    reference_answer: str = Field(min_length=1)
    source_quote: str = Field(min_length=1)
    scene_id: str | None


Question = Annotated[SingleChoiceQuestion | OpenQuestion, Field(discriminator="kind")]


class QuizResponse(ContractModel):
    episode: int = Field(ge=0)
    questions: list[Question] = Field(min_length=3, max_length=5)


class GradeRequest(ContractModel):
    language: Language
    question: OpenQuestion
    answer: str = Field(min_length=1, max_length=1000)


class GradeResponse(ContractModel):
    correct: bool
    score: float = Field(ge=0, le=1)
    feedback: str = Field(min_length=1)


class ChatMessage(ContractModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=2000)


class TutorRequest(ContractModel):
    source_text: SourceText
    language: Language
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)


class TutorDeltaEvent(ContractModel):
    type: Literal["delta"]
    text: str


class TutorDoneEvent(ContractModel):
    type: Literal["done"]
    source_quotes: list[str]


TutorEvent = Annotated[TutorDeltaEvent | TutorDoneEvent | ErrorEvent, Field(discriminator="type")]


class ErrorBody(ContractModel):
    code: ErrorCode
    message: str
    retryable: bool


class ErrorResponse(ContractModel):
    error: ErrorBody


class HealthResponse(ContractModel):
    status: Literal["ok"]
