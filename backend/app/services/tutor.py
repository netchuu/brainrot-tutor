import asyncio
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from string import Template

from app.clients.llm import generate_json
from app.config import PROMPTS_DIR
from app.errors import AppError, LlmUnavailableError, RateLimitedError
from app.schemas.contract import ChatMessage, ErrorEvent, Language, TutorDeltaEvent, TutorDoneEvent, TutorRequest
from app.schemas.quiz import TutorDraft
from app.services.cache import LruCache, cache_key
from app.services.grounding import GroundedSource, defang, word_stems
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
CHAT_MESSAGES = 8
CHAT_CHARS = 4000
MAX_QUOTES = 3
DELTA_WORDS = 6
SPEAKERS = {"user": "learner", "assistant": "tutor"}
QUOTE_RETRY_NOTE = (
    "\n\nNone of your source_quotes was found in the SOURCE EXCERPTS. Copy 1 to 3 complete sentences "
    "character for character that support the answer, or set covered to false if the text does not cover it."
)
# Shown instead of an answer whose support could not be found in the text.
NOT_FOUND: dict[Language, str] = {
    "ru": "Я не нашёл в тексте подтверждения для ответа. Спроси иначе или про другую часть текста.",
    "en": "I could not find support for an answer in the text. Try asking differently or about another part of it.",
}
WORD_WITH_SPACE = re.compile(r"\S+\s*")
TUTOR_CACHE: LruCache["TutorAnswer"] = LruCache(128)


@dataclass(frozen=True)
class TutorAnswer:
    answer: str
    source_quotes: list[str]


def wrapped(sentence: str) -> list[str]:
    # Notes and slides often lack full stops, so an overlong "sentence" is cut at word boundaries.
    pieces: list[str] = []
    current = ""
    for word in sentence.split(" "):
        if current and len(current) + len(word) + 1 > CHUNK_CHARS:
            pieces.append(current)
            current = ""
        current = f"{current} {word}".strip()
    if current:
        pieces.append(current)
    return pieces


def chunks_of(source: GroundedSource) -> list[str]:
    chunks: list[str] = []
    current = ""
    for part in (piece for sentence in source.sentences for piece in wrapped(sentence)):
        if current and len(current) + len(part) + 1 > CHUNK_CHARS:
            chunks.append(current)
            current = ""
        current = f"{current} {part}".strip()
    if current:
        chunks.append(current)
    return chunks


def excerpts_for(source: GroundedSource, question: str) -> str:
    if len(source.text) <= EXCERPT_BUDGET_CHARS:
        return source.text
    wanted = word_stems(question)
    chunks = chunks_of(source)
    ranked = sorted(range(len(chunks)), key=lambda index: (-len(wanted & word_stems(chunks[index])), index))
    picked: list[int] = []
    total = 0
    for index in ranked:
        if total + len(chunks[index]) <= EXCERPT_BUDGET_CHARS:
            picked.append(index)
            total += len(chunks[index])
    return " … ".join(chunks[index] for index in sorted(picked))


def chat_text(messages: list[ChatMessage]) -> str:
    lines: list[str] = []
    total = 0
    for message in reversed(messages[-CHAT_MESSAGES:]):
        line = f"{SPEAKERS[message.role]}: {defang(message.content)}"
        if lines and total + len(line) > CHAT_CHARS:
            break
        lines.append(line[:CHAT_CHARS])
        total += len(line)
    return "\n".join(reversed(lines))


def grounded_quotes(source: GroundedSource, quotes: list[str]) -> list[str]:
    grounded: list[str] = []
    for quote in quotes:
        snapped = source.snap_quote(quote)
        if snapped is not None and snapped not in grounded:
            grounded.append(snapped)
    return grounded


async def answer_question(request: TutorRequest) -> TutorAnswer:
    key = cache_key("tutor", request.model_dump(mode="json"))
    cached = TUTOR_CACHE.get(key)
    if cached is not None:
        logger.info("tutor answer served from cache")
        return cached
    answer = await ask_model(request)
    # Only answers backed by quotes are kept; a fallback reply may succeed when asked again.
    if answer.source_quotes:
        TUTOR_CACHE.put(key, answer)
    return answer


async def ask_model(request: TutorRequest) -> TutorAnswer:
    source = GroundedSource(request.source_text)
    question = " ".join(message.content for message in request.messages[-3:] if message.role == "user")
    system = SYSTEM_PROMPT.substitute(language_name=LANGUAGE_NAMES[request.language])
    prompt = QUESTION_PROMPT.substitute(
        chat=chat_text(request.messages), excerpts=defang(excerpts_for(source, question))
    )
    started = time.perf_counter()
    draft = await generate_json(system, prompt, TutorDraft)
    quotes = grounded_quotes(source, draft.source_quotes)
    if draft.covered and not quotes:
        logger.info("tutor quotes were not in the source after %d ms, asking once more", elapsed_ms(started))
        try:
            draft = await generate_json(system, prompt + QUOTE_RETRY_NOTE, TutorDraft)
        except (RateLimitedError, LlmUnavailableError) as exc:
            logger.warning("tutor quote retry failed with %s", exc.code)
            return TutorAnswer(answer=NOT_FOUND[request.language], source_quotes=[])
        quotes = grounded_quotes(source, draft.source_quotes)
    logger.info("tutor model answered after %d ms", elapsed_ms(started))
    if not draft.covered:
        return TutorAnswer(answer=draft.answer, source_quotes=[])
    if not quotes:
        return TutorAnswer(answer=NOT_FOUND[request.language], source_quotes=[])
    return TutorAnswer(answer=draft.answer, source_quotes=quotes[:MAX_QUOTES])


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
