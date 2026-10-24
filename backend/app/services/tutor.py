import asyncio
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import AppError, LlmUnavailableError
from app.schemas.contract import ChatMessage, ErrorEvent, TutorDeltaEvent, TutorDoneEvent, TutorRequest
from app.schemas.quiz import TutorDraft
from app.services.grounding import SPOKEN_WORD, GroundedSource, defang
from app.services.pipeline import elapsed_ms, ndjson
from app.services.script_writer import LANGUAGE_NAMES

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = Template((PROMPTS_DIR / "tutor.md").read_text(encoding="utf-8"))
QUESTION_PROMPT = Template((PROMPTS_DIR / "tutor_question.md").read_text(encoding="utf-8"))
# Vercel stops the function at 60 s; answering earlier keeps the contract error event.
TUTOR_DEADLINE_S = 50
# Long sources are cut to the passages that share the most word stems with the question (Groq allows 8K tokens/min).
EXCERPT_BUDGET_CHARS = 6000
CHUNK_CHARS = 600
STEM_CHARS = 5
CHAT_MESSAGES = 8
DELTA_WORDS = 6
SPEAKERS = {"user": "learner", "assistant": "tutor"}
QUOTE_RETRY_NOTE = (
    "\n\nNone of your source_quotes was found in the SOURCE EXCERPTS. "
    "Copy 1 to 3 complete sentences character for character, or return an empty list."
)
WORD_WITH_SPACE = re.compile(r"\S+\s*")


@dataclass(frozen=True)
class TutorAnswer:
    answer: str
    source_quotes: list[str]


def stems(text: str) -> set[str]:
    return {word.casefold()[:STEM_CHARS] for word in SPOKEN_WORD.findall(text) if len(word) > 2}


def chunks_of(source: GroundedSource) -> list[str]:
    chunks: list[str] = []
    current = ""
    for sentence in source.sentences:
        if current and len(current) + len(sentence) > CHUNK_CHARS:
            chunks.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks


def excerpts_for(source: GroundedSource, question: str) -> str:
    if len(source.text) <= EXCERPT_BUDGET_CHARS:
        return source.text
    wanted = stems(question)
    chunks = chunks_of(source)
    ranked = sorted(range(len(chunks)), key=lambda index: (-len(wanted & stems(chunks[index])), index))
    picked: list[int] = []
    total = 0
    for index in ranked:
        if total + len(chunks[index]) <= EXCERPT_BUDGET_CHARS:
            picked.append(index)
            total += len(chunks[index])
    return " … ".join(chunks[index] for index in sorted(picked))


def chat_text(messages: list[ChatMessage]) -> str:
    return "\n".join(f"{SPEAKERS[message.role]}: {defang(message.content)}" for message in messages[-CHAT_MESSAGES:])


def grounded_quotes(source: GroundedSource, quotes: list[str]) -> list[str]:
    grounded: list[str] = []
    for quote in quotes:
        snapped = source.snap_quote(quote)
        if snapped is not None and snapped not in grounded:
            grounded.append(snapped)
    return grounded


async def answer_question(request: TutorRequest) -> TutorAnswer:
    source = GroundedSource(request.source_text)
    question = " ".join(message.content for message in request.messages[-3:] if message.role == "user")
    system = SYSTEM_PROMPT.substitute(language_name=LANGUAGE_NAMES[request.language])
    prompt = QUESTION_PROMPT.substitute(
        chat=chat_text(request.messages), excerpts=defang(excerpts_for(source, question))
    )
    draft = await generate_json(system, prompt, TutorDraft)
    quotes = grounded_quotes(source, draft.source_quotes)
    if draft.source_quotes and not quotes:
        logger.info("tutor quotes were not in the source, asking once more")
        draft = await generate_json(system, prompt + QUOTE_RETRY_NOTE, TutorDraft)
        quotes = grounded_quotes(source, draft.source_quotes)
    return TutorAnswer(answer=draft.answer, source_quotes=quotes[:3])


def pieces(answer: str) -> list[str]:
    words = WORD_WITH_SPACE.findall(answer)
    return ["".join(words[start : start + DELTA_WORDS]) for start in range(0, len(words), DELTA_WORDS)]


async def stream_tutor(request: TutorRequest) -> AsyncIterator[str]:
    started = time.perf_counter()
    try:
        try:
            async with asyncio.timeout(TUTOR_DEADLINE_S):
                answer = await answer_question(request)
        except TimeoutError:
            raise LlmUnavailableError("The tutor took too long. Try again.") from None
        logger.info("tutor answer after %d ms", elapsed_ms(started))
        for piece in pieces(answer.answer):
            yield ndjson(TutorDeltaEvent(type="delta", text=piece))
        yield ndjson(TutorDoneEvent(type="done", source_quotes=answer.source_quotes))
    except AppError as exc:
        logger.warning("tutor stream ended with %s after %d ms", exc.code, elapsed_ms(started))
        yield ndjson(exc.to_event())
    except Exception:
        # Once streaming has started the status is already 200, so the contract's error event is the only signal left.
        logger.exception("tutor stream failed after %d ms", elapsed_ms(started))
        message = "Something went wrong while answering. Try again."
        yield ndjson(ErrorEvent(type="error", code="internal", message=message, retryable=False))
